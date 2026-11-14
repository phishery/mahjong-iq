/**
 * One game room: a lobby of up to four people, bots in the empty seats, and the
 * authoritative table state. Transport-agnostic: the room talks to people through a
 * `send(playerId, message)` callback, and timers go through an injectable clock so the
 * room can be tested without sockets or real time.
 */

import type { LoadedCard } from '../src/engine/card/schema';
import { randomSeed } from '../src/engine/rng';
import type { OpponentProfile } from '../src/engine/opponents';
import { applyAction, createTable, nextBotMove, pendingSeats, SEATS, TableError, viewFor, type SeatConfig, type TableAction, type TableState } from '../src/engine/table';
import type { LobbySeat, RoomInfo, ServerMessage } from '../src/net/protocol';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface RoomTiming {
  /** Pause before each bot move, so people can follow the play. */
  botDelayMs: number;
  /** How long people get to call a discard before they are passed automatically. */
  callWindowMs: number;
  /** A disconnected person's seat is played by a bot after this long. */
  standInAfterMs: number;
}

export const DEFAULT_TIMING: RoomTiming = { botDelayMs: 700, callWindowMs: 12000, standInAfterMs: 45000 };

const BOT_NAMES = ['Mei', 'Rosa', 'Ada', 'June', 'Pearl', 'Iris'];

type SeatSlot = { kind: 'human'; playerId: string } | { kind: 'bot'; profile: OpponentProfile; name: string } | null;

interface Member {
  name: string;
  seat: number | null;
  connected: boolean;
  disconnectedAt: number | null;
}

export class Room {
  readonly members = new Map<string, Member>();
  seats: SeatSlot[] = [null, null, null, null];
  table: TableState | null = null;
  hands = 0;
  scores = [0, 0, 0, 0];
  lastActivity: number;
  private botTimer: unknown = null;
  private callTimer: unknown = null;
  private callDeadline: number | null = null;
  private standInTimer: unknown = null;

  constructor(
    readonly code: string,
    readonly card: LoadedCard,
    readonly cardJson: unknown,
    readonly official: boolean,
    readonly hostId: string,
    readonly settings: { botProfile: OpponentProfile; courtesy: boolean },
    private readonly send: (playerId: string, msg: ServerMessage) => void,
    private readonly clock: Clock = realClock,
    private readonly timing: RoomTiming = DEFAULT_TIMING,
  ) {
    this.lastActivity = clock.now();
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  /** Add or reconnect a person. Returns an error message if they cannot join. */
  join(playerId: string, name: string): string | null {
    this.lastActivity = this.clock.now();
    const existing = this.members.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.name = name || existing.name;
    } else {
      if (this.table) return 'This game has already started.';
      // Take a free seat, or replace a bot the host placed.
      let seat = this.seats.findIndex((x) => x === null);
      if (seat < 0) seat = this.seats.findIndex((x) => x?.kind === 'bot');
      if (seat < 0) return 'This table is full.';
      this.members.set(playerId, { name, seat, connected: true, disconnectedAt: null });
      this.seats[seat] = { kind: 'human', playerId };
    }
    this.send(playerId, { t: 'joined', code: this.code });
    this.send(playerId, { t: 'card', json: this.cardJson });
    this.broadcast();
    return null;
  }

  disconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = false;
    m.disconnectedAt = this.clock.now();
    this.broadcastRoom();
    this.scheduleStandIn();
  }

  leave(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    if (!this.table) {
      if (m.seat !== null) this.seats[m.seat] = null;
      this.members.delete(playerId);
    } else {
      // Mid-game: a bot takes the seat for good.
      if (m.seat !== null) this.seats[m.seat] = { kind: 'bot', profile: this.settings.botProfile, name: `${m.name} (bot)` };
      this.members.delete(playerId);
      this.scheduleBots();
    }
    this.send(playerId, { t: 'left' });
    this.broadcast();
  }

  get connectedCount(): number {
    return [...this.members.values()].filter((m) => m.connected).length;
  }

  takeSeat(playerId: string, seat: number): string | null {
    const m = this.members.get(playerId);
    if (!m) return 'Join the room first.';
    if (this.table) return 'Seats are fixed once the game starts.';
    const slot = this.seats[seat];
    if (slot?.kind === 'human' && slot.playerId !== playerId) return 'That seat is taken.';
    if (m.seat !== null) this.seats[m.seat] = null;
    this.seats[seat] = { kind: 'human', playerId };
    m.seat = seat;
    this.broadcast();
    return null;
  }

  setBot(playerId: string, seat: number, bot: OpponentProfile | null): string | null {
    if (playerId !== this.hostId) return 'Only the host can change bots.';
    if (this.table) return 'Seats are fixed once the game starts.';
    const slot = this.seats[seat];
    if (slot?.kind === 'human') return 'A person is sitting there.';
    this.seats[seat] = bot ? { kind: 'bot', profile: bot, name: this.botName(seat) } : null;
    this.broadcast();
    return null;
  }

  private botName(seat: number): string {
    return BOT_NAMES[(seat + this.hands) % BOT_NAMES.length];
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  start(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can start the game.';
    if (this.table && this.table.phase.name !== 'ended') return 'A hand is already in progress.';
    for (const s of SEATS) if (!this.seats[s]) this.seats[s] = { kind: 'bot', profile: this.settings.botProfile, name: this.botName(s) };
    const seats: SeatConfig[] = this.seats.map((slot) =>
      slot!.kind === 'bot' ? { name: slot!.name, bot: slot!.profile } : { name: this.members.get(slot!.playerId)?.name ?? 'Player', bot: null },
    );
    this.table = createTable(this.card, { seed: randomSeed(), seats, charleston: true, courtesy: this.settings.courtesy });
    this.hands++;
    this.afterChange();
    return null;
  }

  /** After a hand ends: the dealer passes to the right (everyone shifts one seat) and a new hand starts. */
  newHand(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can deal the next hand.';
    if (!this.table || this.table.phase.name !== 'ended') return 'The current hand is not over yet.';
    // Seat s becomes seat s−1 (South deals next).
    this.seats = SEATS.map((s) => this.seats[(s + 1) % 4]);
    this.scores = SEATS.map((s) => this.scores[(s + 1) % 4]);
    for (const [, m] of this.members) if (m.seat !== null) m.seat = (m.seat + 3) % 4;
    this.table = null;
    return this.start(playerId);
  }

  act(playerId: string, action: TableAction): string | null {
    this.lastActivity = this.clock.now();
    const m = this.members.get(playerId);
    if (!this.table || !m || m.seat === null) return 'You are not playing at this table.';
    return this.apply(m.seat, action);
  }

  private apply(seat: number, action: TableAction): string | null {
    if (!this.table) return 'No game is running.';
    try {
      this.table = applyAction(this.card, this.table, seat, action);
    } catch (e) {
      if (e instanceof TableError) return e.message;
      throw e;
    }
    if (this.table.phase.name === 'ended' && this.table.phase.result.payments) {
      this.scores = this.scores.map((x, s) => x + (this.table!.phase as { result: { payments: number[] } }).result.payments[s]);
    }
    this.afterChange();
    return null;
  }

  /** Who plays a seat right now: its bot, a stand-in for an absent person, or nobody (a person). */
  private profileOf(seat: number): OpponentProfile | null {
    const slot = this.seats[seat];
    if (!slot) return this.settings.botProfile;
    if (slot.kind === 'bot') return slot.profile;
    const m = this.members.get(slot.playerId);
    if (!m) return this.settings.botProfile;
    if (!m.connected && m.disconnectedAt !== null && this.clock.now() - m.disconnectedAt >= this.timing.standInAfterMs) {
      return this.settings.botProfile;
    }
    return null;
  }

  private afterChange(): void {
    this.scheduleCallWindow();
    this.scheduleBots();
    this.broadcast();
  }

  private scheduleBots(): void {
    if (this.botTimer !== null || !this.table || this.table.phase.name === 'ended') return;
    const move = nextBotMove(this.card, this.table, (s) => this.profileOf(s));
    if (!move) return;
    const delay = this.table.phase.name === 'calls' ? Math.round(this.timing.botDelayMs / 2) : this.timing.botDelayMs;
    this.botTimer = this.clock.setTimeout(() => {
      this.botTimer = null;
      if (!this.table) return;
      // Recompute: the state may have moved on while waiting.
      const m = nextBotMove(this.card, this.table, (s) => this.profileOf(s));
      if (m) this.apply(m.seat, m.action);
    }, delay);
  }

  private scheduleCallWindow(): void {
    const t = this.table;
    const humanPending = t && t.phase.name === 'calls' && pendingSeats(t).some((s) => this.profileOf(s) === null);
    if (!humanPending) {
      if (this.callTimer !== null) this.clock.clearTimeout(this.callTimer);
      this.callTimer = null;
      this.callDeadline = null;
      return;
    }
    if (this.callTimer !== null) return; // one window per discard
    this.callDeadline = this.clock.now() + this.timing.callWindowMs;
    this.callTimer = this.clock.setTimeout(() => {
      this.callTimer = null;
      this.callDeadline = null;
      const tt = this.table;
      if (!tt || tt.phase.name !== 'calls') return;
      for (const s of pendingSeats(tt)) {
        if (this.table?.phase.name !== 'calls') break;
        if (this.profileOf(s) === null) this.apply(s, { type: 'call', response: { type: 'pass' } });
      }
    }, this.timing.callWindowMs);
  }

  private scheduleStandIn(): void {
    if (this.standInTimer !== null) this.clock.clearTimeout(this.standInTimer);
    this.standInTimer = this.clock.setTimeout(() => {
      this.standInTimer = null;
      this.afterChange();
    }, this.timing.standInAfterMs + 10);
  }

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  info(playerId: string): RoomInfo {
    const me = this.members.get(playerId);
    const seats: LobbySeat[] = this.seats.map((slot) => {
      if (!slot) return { kind: 'empty' };
      if (slot.kind === 'bot') return { kind: 'bot', profile: slot.profile, name: slot.name };
      const m = this.members.get(slot.playerId);
      return { kind: 'human', name: m?.name ?? 'Player', connected: !!m?.connected, you: slot.playerId === playerId, host: slot.playerId === this.hostId };
    });
    return {
      code: this.code,
      started: !!this.table,
      seats,
      youAreHost: playerId === this.hostId,
      yourSeat: me?.seat ?? null,
      cardTitle: this.card.def.title,
      officialCard: this.official,
      botProfile: this.settings.botProfile,
      courtesy: this.settings.courtesy,
      hands: this.hands,
      scores: [...this.scores],
    };
  }

  private broadcastRoom(): void {
    for (const [id, m] of this.members) if (m.connected) this.send(id, { t: 'room', room: this.info(id) });
  }

  broadcast(): void {
    this.broadcastRoom();
    if (!this.table) return;
    for (const [id, m] of this.members) {
      if (!m.connected || m.seat === null) continue;
      this.send(id, { t: 'view', view: viewFor(this.card, this.table, m.seat), callDeadline: this.callDeadline });
    }
  }

  dispose(): void {
    for (const t of [this.botTimer, this.callTimer, this.standInTimer]) if (t !== null) this.clock.clearTimeout(t);
    this.botTimer = this.callTimer = this.standInTimer = null;
  }
}
