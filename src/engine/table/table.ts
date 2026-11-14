/**
 * Full-game table state machine for one to four players (pure, serialisable, React-free).
 *
 * Seats are absolute: 0 = East (dealer), then 1 South, 2 West, 3 North in turn order.
 * Play passes to the right, so a seat's "right" is the next seat in turn order.
 *
 *   charleston (R, A, L) ─▶ vote ─▶ [charleston (L, A, R)] ─▶ [courtesy-request ─▶ courtesy-select]
 *     ─▶ turn ─discard─▶ calls ─(no call)─▶ next seat draws ─▶ turn …
 *                              └(exposure)─▶ caller's turn (no draw)
 *                              └(Mahjong)──▶ ended
 *
 * Every seat acts through applyAction(); a seat is never asked for an action out of turn.
 * Bots choose actions with bot.ts using only what their seat can see. Tile ownership is
 * tracked by physical id and every transition preserves all 152 tiles.
 */

import type { LoadedCard } from '../card/schema';
import { COURTESY_STEP, FIRST_CHARLESTON, RULES, SECOND_CHARLESTON, type Direction, type PassStep } from '../charleston';
import type { RoundState } from '../game';
import type { OpponentProfile } from '../opponents';
import { createRng, mixSeed, sample, shuffle, type Rng } from '../rng';
import { allTileIds, JOKER_INDEX, KIND_OF_ID, TOTAL_TILES, type TileId } from '../tiles';
import { compatibleVariants, countsOf, findMahjong, type Exposure } from './hand';

export type SeatIndex = number; // 0..3
export const SEATS = [0, 1, 2, 3] as const;
export const SEAT_WINDS = ['E', 'S', 'W', 'N'] as const;
export const SEAT_WIND_NAMES = ['East', 'South', 'West', 'North'] as const;

export class TableError extends Error {}

export interface SeatConfig {
  name: string;
  /** null = a person controls this seat. */
  bot: OpponentProfile | null;
}

export interface TableConfig {
  seed: number;
  seats: SeatConfig[];
  /** Play the Charleston at the table (false = start play straight after the deal). */
  charleston: boolean;
  /** Offer the optional courtesy pass after the Charleston. */
  courtesy: boolean;
}

export interface PassSubmission {
  tiles: TileId[];
  blind: number;
}

export type CallResponse = { type: 'pass' } | { type: 'mahjong' } | { type: 'expose'; tiles: TileId[] };

export type TableAction =
  | { type: 'pass-tiles'; tiles: TileId[]; blind?: number }
  | { type: 'vote'; proceed: boolean }
  | { type: 'courtesy-request'; count: number }
  | { type: 'courtesy-tiles'; tiles: TileId[] }
  | { type: 'discard'; tile: TileId }
  | { type: 'mahjong' }
  | { type: 'joker-swap'; give: TileId; seat: SeatIndex; exposure: number }
  | { type: 'call'; response: CallResponse };

export type TablePhase =
  | { name: 'charleston'; step: PassStep; stepIndex: number; subs: (PassSubmission | null)[] }
  | { name: 'vote'; votes: (boolean | null)[] }
  | { name: 'courtesy-request'; requests: (number | null)[] }
  | { name: 'courtesy-select'; agreed: number[]; subs: (TileId[] | null)[] }
  | { name: 'turn'; seat: SeatIndex; drawn: TileId | null; called: boolean }
  | { name: 'calls'; tile: TileId; by: SeatIndex; responses: (CallResponse | null)[] }
  | { name: 'ended'; result: GameResult };

export interface GameResult {
  type: 'mahjong' | 'wall';
  winner?: SeatIndex;
  selfDrawn?: boolean;
  /** Seat whose discard completed the hand. */
  from?: SeatIndex;
  variantId?: string;
  lineId?: string;
  value?: number;
  jokerless?: boolean;
  /** Net payment per seat (winner positive). */
  payments: number[];
}

export interface Discard {
  tile: TileId;
  by: SeatIndex;
  /** True once called into an exposure or for Mahjong (no longer on the floor). */
  called: boolean;
}

export type TableEvent = { n: number } & (
  | { type: 'deal' }
  | { type: 'pass'; label: string; blind: number[] }
  | { type: 'vote'; proceed: boolean; stoppedBy: SeatIndex[] }
  | { type: 'courtesy'; counts: number[] }
  | { type: 'play-start' }
  | { type: 'draw'; seat: SeatIndex; tile: TileId }
  | { type: 'discard'; seat: SeatIndex; tile: TileId }
  | { type: 'expose'; seat: SeatIndex; from: SeatIndex; tile: TileId; size: number }
  | { type: 'joker-swap'; seat: SeatIndex; target: SeatIndex; give: TileId }
  | { type: 'mahjong'; seat: SeatIndex; selfDrawn: boolean; from?: SeatIndex }
  | { type: 'wall-game' }
);

export interface TableState {
  config: TableConfig;
  cardId: string;
  /** Increments on every applied action (drives bot randomness and client sync). */
  seq: number;
  concealed: TileId[][];
  exposures: Exposure[][];
  wall: TileId[];
  discards: Discard[];
  /** Own tiles each seat passed during the Charleston (their private knowledge). */
  passHistory: TileId[][];
  secondCharleston: 'pending' | 'yes' | 'no';
  phase: TablePhase;
  log: TableEvent[];
}

const OFFSET: Record<Direction, number> = { right: 1, across: 2, left: 3 };
export const targetSeat = (from: SeatIndex, dir: Direction) => (from + OFFSET[dir]) % 4;
export const giverSeat = (to: SeatIndex, dir: Direction) => (to - OFFSET[dir] + 4) % 4;
export const nextSeat = (s: SeatIndex) => (s + 1) % 4;

const isJokerTile = (id: TileId) => KIND_OF_ID[id] === JOKER_INDEX;
const four = <T>(v: T): T[] => [v, v, v, v];

type EventBody = TableEvent extends infer E ? (E extends unknown ? Omit<E, 'n'> : never) : never;

function log(state: TableState, e: EventBody): void {
  state.log.push({ ...e, n: state.log.length } as TableEvent);
}

/** A deep-enough copy for immutable updates. */
function clone(s: TableState): TableState {
  return {
    ...s,
    concealed: s.concealed.map((r) => [...r]),
    exposures: s.exposures.map((es) => es.map((e) => ({ ...e, tiles: [...e.tiles] }))),
    wall: [...s.wall],
    discards: s.discards.map((d) => ({ ...d })),
    passHistory: s.passHistory.map((r) => [...r]),
    phase: JSON.parse(JSON.stringify(s.phase)) as TablePhase,
    log: [...s.log],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createTable(card: LoadedCard, config: TableConfig): TableState {
  if (config.seats.length !== 4) throw new TableError('A table has exactly four seats.');
  const ids = shuffle(allTileIds(), createRng(mixSeed(config.seed, 1)));
  const concealed: TileId[][] = [];
  let p = 0;
  for (const s of SEATS) {
    const n = s === 0 ? RULES.dealerTiles : RULES.playerTiles;
    concealed.push(ids.slice(p, p + n));
    p += n;
  }
  const state: TableState = {
    config,
    cardId: card.def.id,
    seq: 0,
    concealed,
    exposures: [[], [], [], []],
    wall: ids.slice(p),
    discards: [],
    passHistory: [[], [], [], []],
    secondCharleston: 'pending',
    phase: { name: 'turn', seat: 0, drawn: null, called: false },
    log: [],
  };
  log(state, { type: 'deal' });
  if (config.charleston) state.phase = charlestonPhase(FIRST_CHARLESTON[0], 0);
  else startPlay(state);
  assertTableConservation(state);
  return state;
}

/**
 * Continue a finished trainer round as a live game. The trainer's seats are relative to the
 * player ('you', 'right', 'across', 'left' in turn order); the dealer there becomes East.
 */
export function tableFromRound(
  card: LoadedCard,
  round: RoundState,
  opts: { playerName: string; profile: OpponentProfile; botNames?: string[] },
): { state: TableState; you: SeatIndex } {
  if (round.phase !== 'done') throw new TableError('The Charleston is not finished yet.');
  const rel = ['you', 'right', 'across', 'left'] as const;
  const dealerRel = rel.indexOf(round.dealer);
  const absOf = (r: number) => (r - dealerRel + 4) % 4;
  const you = absOf(0);
  const concealed: TileId[][] = [[], [], [], []];
  const passHistory: TileId[][] = [[], [], [], []];
  rel.forEach((name, r) => {
    concealed[absOf(r)] = [...round.racks[name]];
    passHistory[absOf(r)] = [...round.passHistory[name]];
  });
  const names = opts.botNames ?? ['Bot', 'Bot', 'Bot'];
  let b = 0;
  const seats: SeatConfig[] = SEATS.map((s) =>
    s === you ? { name: opts.playerName, bot: null } : { name: names[b++ % names.length], bot: opts.profile },
  );
  const state: TableState = {
    config: { seed: mixSeed(round.config.seed, 0x706c6179), seats, charleston: false, courtesy: false },
    cardId: card.def.id,
    seq: 0,
    concealed,
    exposures: [[], [], [], []],
    wall: [...round.wall],
    discards: [],
    passHistory,
    secondCharleston: round.secondCharleston === 'yes' ? 'yes' : 'no',
    phase: { name: 'turn', seat: 0, drawn: null, called: false },
    log: [],
  };
  log(state, { type: 'deal' });
  startPlay(state);
  assertTableConservation(state);
  return { state, you };
}

function charlestonPhase(step: PassStep, stepIndex: number): TablePhase {
  return { name: 'charleston', step, stepIndex, subs: four(null) };
}

function startPlay(state: TableState): void {
  state.phase = { name: 'turn', seat: 0, drawn: null, called: false };
  log(state, { type: 'play-start' });
}

// ---------------------------------------------------------------------------
// Charleston
// ---------------------------------------------------------------------------

function validateOwnTiles(rack: readonly TileId[], tiles: readonly TileId[], required: number): void {
  if (new Set(tiles).size !== tiles.length) throw new TableError('The same tile was selected twice.');
  if (tiles.length !== required) throw new TableError(`Select exactly ${required} tile${required === 1 ? '' : 's'}.`);
  for (const id of tiles) {
    if (!rack.includes(id)) throw new TableError('You can only pass tiles from your own rack.');
    if (isJokerTile(id)) throw new TableError('Jokers can never be passed.');
  }
}

/**
 * Resolve one simultaneous Charleston pass with blind passes. Each seat sends three slots:
 * its own tiles plus `blind` slots that forward (unseen) a random choice of the tiles
 * arriving to it. A forwarded slot carries whatever its source slot carries; if forwards
 * chain all the way around the table, that slot carries nothing (every seat in the loop
 * then sends and receives one tile fewer, so rack sizes are unchanged).
 */
export function resolveCharlestonPass(
  racks: readonly TileId[][],
  subs: readonly PassSubmission[],
  dir: Direction,
  rng: Rng,
): { racks: TileId[][]; received: TileId[][] } {
  type Slot = { own: TileId } | { fwd: number };
  const outgoing: Slot[][] = [];
  const forwarded: Set<number>[] = [];
  for (const s of SEATS) {
    const sub = subs[s];
    const fwdIdx = sample([0, 1, 2], sub.blind, rng);
    forwarded.push(new Set(fwdIdx));
    outgoing.push([...sub.tiles.map((own) => ({ own })), ...fwdIdx.map((fwd) => ({ fwd }))]);
  }
  const resolve = (seat: number, slot: number): TileId | null => {
    const seen = new Set<string>();
    let s = seat;
    let i = slot;
    for (;;) {
      const key = `${s}:${i}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const sl = outgoing[s][i];
      if ('own' in sl) return sl.own;
      i = sl.fwd;
      s = giverSeat(s, dir);
    }
  };
  const out = racks.map((r, s) => r.filter((id) => !subs[s].tiles.includes(id)));
  const received: TileId[][] = [[], [], [], []];
  for (const s of SEATS) {
    const g = giverSeat(s, dir);
    for (let i = 0; i < 3; i++) {
      if (forwarded[s].has(i)) continue;
      const t = resolve(g, i);
      if (t !== null) received[s].push(t);
    }
    out[s].push(...received[s]);
  }
  return { racks: out, received };
}

function afterFirstOrSecond(state: TableState): void {
  if (state.secondCharleston === 'pending') {
    state.phase = { name: 'vote', votes: four(null) };
    return;
  }
  afterCharlestons(state);
}

function afterCharlestons(state: TableState): void {
  if (state.config.courtesy) state.phase = { name: 'courtesy-request', requests: four(null) };
  else startPlay(state);
}

function completePass(state: TableState, phase: Extract<TablePhase, { name: 'charleston' }>): void {
  const subs = phase.subs as PassSubmission[];
  const rng = createRng(mixSeed(state.config.seed, 0x7061, phase.stepIndex));
  const res = resolveCharlestonPass(state.concealed, subs, phase.step.direction, rng);
  state.concealed = res.racks;
  for (const s of SEATS) state.passHistory[s].push(...subs[s].tiles);
  log(state, { type: 'pass', label: phase.step.label, blind: subs.map((x) => x.blind) });
  const schedule = state.secondCharleston === 'yes' ? [...FIRST_CHARLESTON, ...SECOND_CHARLESTON] : [...FIRST_CHARLESTON];
  const next = phase.stepIndex + 1;
  if (next < schedule.length) state.phase = charlestonPhase(schedule[next], next);
  else afterFirstOrSecond(state);
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

/** Total tiles a seat holds (concealed + exposed). */
export function handSize(state: TableState, seat: SeatIndex): number {
  return state.concealed[seat].length + state.exposures[seat].reduce((n, e) => n + e.tiles.length, 0);
}

export type CallOption = { type: 'mahjong' } | { type: 'expose'; size: number; tiles: TileId[] };

/** Every call `seat` may make on the current discard (empty outside a call window). */
export function callOptions(card: LoadedCard, state: TableState, seat: SeatIndex): CallOption[] {
  const ph = state.phase;
  if (ph.name !== 'calls' || seat === ph.by) return [];
  const tile = ph.tile;
  if (isJokerTile(tile)) return []; // a discarded Joker can't be claimed
  const own = state.concealed[seat];
  const exps = state.exposures[seat];
  const out: CallOption[] = [];
  if (findMahjong(card, [...own, tile], exps)) out.push({ type: 'mahjong' });
  const kind = KIND_OF_ID[tile];
  const naturals = own.filter((id) => KIND_OF_ID[id] === kind);
  const jokers = own.filter(isJokerTile);
  const shape = exps.map((e) => ({ kind: e.kind, size: e.tiles.length }));
  for (let size = 3; size <= 6; size++) {
    const need = size - 1;
    if (naturals.length + jokers.length < need) break;
    if (own.length - need < 1) break; // must still hold a tile to discard
    const variants = compatibleVariants(card, [...shape, { kind, size }]);
    if (variants.length === 0) continue;
    const useN = Math.min(naturals.length, need);
    const tiles = [...naturals.slice(0, useN), ...jokers.slice(0, need - useN)];
    out.push({ type: 'expose', size, tiles });
  }
  return out;
}

function validExposeTiles(state: TableState, seat: SeatIndex, tiles: readonly TileId[], discard: TileId): boolean {
  if (new Set(tiles).size !== tiles.length || tiles.length < 2 || tiles.length > 5) return false;
  const kind = KIND_OF_ID[discard];
  return tiles.every((id) => state.concealed[seat].includes(id) && (KIND_OF_ID[id] === kind || isJokerTile(id)));
}

/** Joker swaps available to the seat on turn: give a matching natural, take an exposed Joker. */
export function jokerSwaps(state: TableState, seat: SeatIndex): { give: TileId; seat: SeatIndex; exposure: number }[] {
  const ph = state.phase;
  if (ph.name !== 'turn' || ph.seat !== seat) return [];
  const out: { give: TileId; seat: SeatIndex; exposure: number }[] = [];
  for (const t of SEATS) {
    state.exposures[t].forEach((e, i) => {
      if (!e.tiles.some(isJokerTile)) return;
      const give = state.concealed[seat].find((id) => KIND_OF_ID[id] === e.kind);
      if (give !== undefined) out.push({ give, seat: t, exposure: i });
    });
  }
  return out;
}

function settle(card: LoadedCard, state: TableState, winner: SeatIndex, from: SeatIndex | null): void {
  const m = findMahjong(card, state.concealed[winner], state.exposures[winner]);
  if (!m) throw new TableError('That is not a complete hand on the card.');
  const payments = [0, 0, 0, 0];
  for (const s of SEATS) {
    if (s === winner) continue;
    const pay = from === null ? 2 * m.basis : s === from ? 2 * m.basis : m.basis;
    payments[s] -= pay;
    payments[winner] += pay;
  }
  log(state, { type: 'mahjong', seat: winner, selfDrawn: from === null, ...(from !== null ? { from } : {}) });
  state.phase = {
    name: 'ended',
    result: {
      type: 'mahjong',
      winner,
      selfDrawn: from === null,
      ...(from !== null ? { from } : {}),
      variantId: m.variant.id,
      lineId: m.variant.lineId,
      value: m.value,
      jokerless: m.jokerless,
      payments,
    },
  };
}

function drawFor(state: TableState, seat: SeatIndex): void {
  const tile = state.wall.shift();
  if (tile === undefined) {
    log(state, { type: 'wall-game' });
    state.phase = { name: 'ended', result: { type: 'wall', payments: [0, 0, 0, 0] } };
    return;
  }
  state.concealed[seat].push(tile);
  log(state, { type: 'draw', seat, tile });
  state.phase = { name: 'turn', seat, drawn: tile, called: false };
}

function openCalls(card: LoadedCard, state: TableState, tile: TileId, by: SeatIndex): void {
  state.phase = { name: 'calls', tile, by, responses: four(null) };
  const ph = state.phase;
  for (const s of SEATS) {
    if (s === by || callOptions(card, state, s).length === 0) ph.responses[s] = { type: 'pass' };
  }
  maybeResolveCalls(card, state);
}

function maybeResolveCalls(card: LoadedCard, state: TableState): void {
  const ph = state.phase;
  if (ph.name !== 'calls' || ph.responses.some((r) => r === null)) return;
  const order = [1, 2, 3].map((d) => (ph.by + d) % 4); // priority: next in turn order first
  const discard = state.discards[state.discards.length - 1];
  const mj = order.find((s) => ph.responses[s]!.type === 'mahjong');
  if (mj !== undefined) {
    discard.called = true;
    state.concealed[mj].push(ph.tile);
    settle(card, state, mj, ph.by);
    return;
  }
  const ex = order.find((s) => ph.responses[s]!.type === 'expose');
  if (ex !== undefined) {
    const r = ph.responses[ex] as { type: 'expose'; tiles: TileId[] };
    discard.called = true;
    state.concealed[ex] = state.concealed[ex].filter((id) => !r.tiles.includes(id));
    const exposure: Exposure = { kind: KIND_OF_ID[ph.tile], tiles: [ph.tile, ...r.tiles], calledFrom: ph.by, calledTile: ph.tile };
    state.exposures[ex].push(exposure);
    log(state, { type: 'expose', seat: ex, from: ph.by, tile: ph.tile, size: exposure.tiles.length });
    state.phase = { name: 'turn', seat: ex, drawn: null, called: true };
    return;
  }
  drawFor(state, nextSeat(ph.by));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Seats that currently owe an action. */
export function pendingSeats(state: TableState): SeatIndex[] {
  const ph = state.phase;
  switch (ph.name) {
    case 'charleston':
    case 'courtesy-select':
      return SEATS.filter((s) => ph.subs[s] === null);
    case 'vote':
      return SEATS.filter((s) => ph.votes[s] === null);
    case 'courtesy-request':
      return SEATS.filter((s) => ph.requests[s] === null);
    case 'turn':
      return [ph.seat];
    case 'calls':
      return SEATS.filter((s) => ph.responses[s] === null);
    case 'ended':
      return [];
  }
}

/**
 * Apply one seat's action and return the new state. Throws TableError for anything the
 * rules do not allow (wrong phase, out of turn, tiles the seat does not hold, …).
 */
export function applyAction(card: LoadedCard, prev: TableState, seat: SeatIndex, action: TableAction): TableState {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new TableError('Unknown seat.');
  if (!pendingSeats(prev).includes(seat)) throw new TableError('It is not your move.');
  const state = clone(prev);
  state.seq++;
  const ph = state.phase;

  switch (action.type) {
    case 'pass-tiles': {
      if (ph.name !== 'charleston') throw new TableError('There is no Charleston pass now.');
      const blind = action.blind ?? 0;
      if (!Number.isInteger(blind) || blind < 0 || blind > RULES.maxBlind) throw new TableError('A blind pass is 0–3 tiles.');
      if (blind > 0 && !ph.step.blindAllowed) throw new TableError(`A blind pass is not allowed on the ${ph.step.label}.`);
      validateOwnTiles(state.concealed[seat], action.tiles, RULES.tilesPerPass - blind);
      ph.subs = [...ph.subs];
      ph.subs[seat] = { tiles: [...action.tiles], blind };
      if (ph.subs.every(Boolean)) completePass(state, ph);
      break;
    }
    case 'vote': {
      if (ph.name !== 'vote') throw new TableError('No vote is open.');
      ph.votes = [...ph.votes];
      ph.votes[seat] = !!action.proceed;
      if (ph.votes.every((v) => v !== null)) {
        const stoppedBy = SEATS.filter((s) => !ph.votes[s]);
        const proceed = stoppedBy.length === 0;
        log(state, { type: 'vote', proceed, stoppedBy });
        state.secondCharleston = proceed ? 'yes' : 'no';
        if (proceed) state.phase = charlestonPhase(SECOND_CHARLESTON[0], FIRST_CHARLESTON.length);
        else afterCharlestons(state);
      }
      break;
    }
    case 'courtesy-request': {
      if (ph.name !== 'courtesy-request') throw new TableError('No courtesy pass is being arranged.');
      const n = action.count;
      if (!Number.isInteger(n) || n < 0 || n > RULES.courtesyMax) throw new TableError('Ask for 0–3 tiles.');
      ph.requests = [...ph.requests];
      ph.requests[seat] = n;
      if (ph.requests.every((r) => r !== null)) {
        const r = ph.requests as number[];
        const agreed = SEATS.map((s) => Math.min(r[s], r[targetSeat(s, 'across')]));
        log(state, { type: 'courtesy', counts: agreed });
        if (agreed.every((a) => a === 0)) startPlay(state);
        else {
          const subs: (TileId[] | null)[] = agreed.map((a) => (a === 0 ? [] : null));
          state.phase = { name: 'courtesy-select', agreed, subs };
        }
      }
      break;
    }
    case 'courtesy-tiles': {
      if (ph.name !== 'courtesy-select') throw new TableError('No courtesy tiles are being chosen.');
      validateOwnTiles(state.concealed[seat], action.tiles, ph.agreed[seat]);
      ph.subs = [...ph.subs];
      ph.subs[seat] = [...action.tiles];
      if (ph.subs.every(Boolean)) {
        const subs = ph.subs as TileId[][];
        const next = state.concealed.map((r, s) => r.filter((id) => !subs[s].includes(id)).concat(subs[targetSeat(s, 'across')]));
        state.concealed = next;
        for (const s of SEATS) state.passHistory[s].push(...subs[s]);
        log(state, { type: 'pass', label: COURTESY_STEP.label, blind: [0, 0, 0, 0] });
        startPlay(state);
      }
      break;
    }
    case 'discard': {
      if (ph.name !== 'turn') throw new TableError('You can only discard on your turn.');
      const i = state.concealed[seat].indexOf(action.tile);
      if (i < 0) throw new TableError('You can only discard a tile from your rack.');
      state.concealed[seat].splice(i, 1);
      state.discards.push({ tile: action.tile, by: seat, called: false });
      log(state, { type: 'discard', seat, tile: action.tile });
      openCalls(card, state, action.tile, seat);
      break;
    }
    case 'mahjong': {
      if (ph.name !== 'turn') throw new TableError('You can only declare Mahjong on your turn, or by calling a discard.');
      if (!findMahjong(card, state.concealed[seat], state.exposures[seat])) throw new TableError('Your tiles do not make a hand on the card yet.');
      settle(card, state, seat, null);
      break;
    }
    case 'joker-swap': {
      if (ph.name !== 'turn') throw new TableError('Joker swaps happen on your turn, before you discard.');
      const exp = state.exposures[action.seat]?.[action.exposure];
      if (!exp) throw new TableError('That exposure does not exist.');
      const j = exp.tiles.findIndex(isJokerTile);
      if (j < 0) throw new TableError('That exposure has no Joker.');
      const gi = state.concealed[seat].indexOf(action.give);
      if (gi < 0 || KIND_OF_ID[action.give] !== exp.kind) throw new TableError('Give the exact tile the Joker stands for.');
      const joker = exp.tiles[j];
      exp.tiles[j] = action.give;
      state.concealed[seat][gi] = joker;
      log(state, { type: 'joker-swap', seat, target: action.seat, give: action.give });
      break;
    }
    case 'call': {
      if (ph.name !== 'calls') throw new TableError('There is no discard to call.');
      const r = action.response;
      if (r.type === 'mahjong') {
        if (!findMahjong(card, [...state.concealed[seat], ph.tile], state.exposures[seat])) {
          throw new TableError('That discard does not complete a hand on the card.');
        }
      } else if (r.type === 'expose') {
        if (!validExposeTiles(state, seat, r.tiles, ph.tile)) throw new TableError('Expose matching tiles or Jokers from your rack.');
        const size = r.tiles.length + 1;
        const opts = callOptions(card, prev, seat);
        if (!opts.some((o) => o.type === 'expose' && o.size === size)) throw new TableError('That exposure cannot make any hand on the card.');
      } else if (r.type !== 'pass') throw new TableError('Unknown call.');
      ph.responses = [...ph.responses];
      ph.responses[seat] = r.type === 'expose' ? { type: 'expose', tiles: [...r.tiles] } : { type: r.type };
      maybeResolveCalls(card, state);
      break;
    }
    default:
      throw new TableError('Unknown action.');
  }
  assertTableConservation(state);
  return state;
}

/** Throws if any tile was created, duplicated or lost, or a hand has an illegal size. */
export function assertTableConservation(state: TableState): void {
  const floor = state.discards.filter((d) => !d.called).map((d) => d.tile);
  const all = [...state.wall, ...floor, ...state.concealed.flat(), ...state.exposures.flat().flatMap((e) => e.tiles)];
  if (all.length !== TOTAL_TILES) throw new Error(`Tile count ${all.length} ≠ ${TOTAL_TILES}`);
  if (new Set(all).size !== TOTAL_TILES) throw new Error('Duplicate tile detected');
  const ph = state.phase;
  for (const s of SEATS) {
    let expected: number = RULES.playerTiles;
    if (ph.name === 'turn' && ph.seat === s) expected = 14;
    else if (ph.name === 'ended' && ph.result.winner === s) expected = 14;
    else if (ph.name !== 'turn' && ph.name !== 'calls' && ph.name !== 'ended' && s === 0) expected = RULES.dealerTiles;
    if (handSize(state, s) !== expected) throw new Error(`Seat ${s} holds ${handSize(state, s)} tiles, expected ${expected}`);
  }
}

export { countsOf };
