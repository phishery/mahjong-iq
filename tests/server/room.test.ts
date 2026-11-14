import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DEMO_CARD_JSON, getDemoCard } from '../../src/engine/cards';
import { JOKER_INDEX, KIND_OF_ID } from '../../src/engine/tiles';
import { viewFor, type TableAction } from '../../src/engine/table';
import type { TableView } from '../../src/engine/table/view';
import type { ServerMessage } from '../../src/net/protocol';
import { Room, type Clock } from '../../server/room';
import { startServer } from '../../server/server';

const card = getDemoCard();
const viewOf = (room: Room, seat: number) => viewFor(card, room.table!, seat);

/** A manual clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { clock, advance, pending: () => timers.size };
}

const timing = { botDelayMs: 10, callWindowMs: 1000, standInAfterMs: 5000 };

function makeRoom(clock: Clock) {
  const inbox = new Map<string, ServerMessage[]>();
  /** Every other seat's concealed tiles at the moment each view was sent. */
  const hiddenAtSend = new Map<ServerMessage, number[]>();
  const send = (pid: string, m: ServerMessage) => {
    if (!inbox.has(pid)) inbox.set(pid, []);
    inbox.get(pid)!.push(m);
    if (m.t === 'view') hiddenAtSend.set(m, room.table!.concealed.filter((_, s) => s !== m.view.you).flat());
  };
  const room = new Room('ABCDE', card, DEMO_CARD_JSON, false, 'host-player-1', { botProfile: 'competent', courtesy: true }, send, clock, timing);
  const lastView = (pid: string) => [...(inbox.get(pid) ?? [])].reverse().find((m) => m.t === 'view') as Extract<ServerMessage, { t: 'view' }> | undefined;
  return { room, inbox, lastView, hiddenAtSend };
}

/** A simple, always-legal policy for a person. */
function humanMove(v: TableView): TableAction | null {
  if (!v.legal.toAct) return null;
  const plain = v.hand.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX);
  switch (v.phase.name) {
    case 'charleston':
      return { type: 'pass-tiles', tiles: plain.slice(0, 3) };
    case 'vote':
      return { type: 'vote', proceed: false };
    case 'courtesy-request':
      return { type: 'courtesy-request', count: 1 };
    case 'courtesy-select':
      return { type: 'courtesy-tiles', tiles: plain.slice(0, v.phase.agreed) };
    case 'turn':
      return v.legal.mahjong ? { type: 'mahjong' } : { type: 'discard', tile: v.hand[v.hand.length - 1] };
    case 'calls':
      return { type: 'call', response: v.legal.calls.some((c) => c.type === 'mahjong') ? { type: 'mahjong' } : { type: 'pass' } };
    default:
      return null;
  }
}

describe('Game room', () => {
  it('plays a full hand with one person and three bots; the person only ever sees their own rack', () => {
    const { clock, advance } = fakeClock();
    const { room, inbox, lastView, hiddenAtSend } = makeRoom(clock);
    expect(room.join('host-player-1', 'Ryn')).toBeNull();
    expect(room.start('host-player-1')).toBeNull();
    for (let i = 0; i < 5000 && room.table!.phase.name !== 'ended'; i++) {
      const v = lastView('host-player-1')!.view;
      const a = humanMove(v);
      if (a && v.seq === room.table!.seq) expect(room.act('host-player-1', a)).toBeNull();
      else advance(20);
    }
    expect(room.table!.phase.name).toBe('ended');
    let views = 0;
    for (const m of inbox.get('host-player-1')!) {
      if (m.t !== 'view') continue;
      views++;
      const hidden = new Set(hiddenAtSend.get(m)!);
      expect(m.view.hand.some((id) => hidden.has(id))).toBe(false);
      if (!m.view.revealed) expect(JSON.stringify(m.view.seats)).not.toMatch(/"hand"/);
    }
    expect(views).toBeGreaterThan(20);
    expect(room.scores.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('passes a person automatically when the call window closes', () => {
    const { clock, advance } = fakeClock();
    const { room } = makeRoom(clock);
    room.join('host-player-1', 'Ryn');
    room.start('host-player-1');
    let sawWindow = false;
    for (let hand = 0; hand < 6 && !sawWindow; hand++) {
      if (hand > 0) room.newHand('host-player-1');
      for (let i = 0; i < 5000 && room.table!.phase.name !== 'ended'; i++) {
        const t = room.table!;
        const me = room.info('host-player-1').yourSeat!;
        if (t.phase.name === 'calls' && t.phase.responses[me] === null) {
          sawWindow = true;
          const seq = t.seq;
          advance(timing.callWindowMs - 50);
          expect(room.table!.seq === seq || room.table!.phase.name !== 'calls' || room.table!.phase.responses[me] === null).toBe(true);
          advance(100);
          const after = room.table!;
          expect(after.seq).toBeGreaterThan(seq);
          if (after.phase.name === 'calls' && after.phase.tile === t.phase.tile) expect(after.phase.responses[me]).not.toBeNull();
          break;
        }
        const v = humanMove(room.info('host-player-1') && viewOf(room, me));
        if (v && t.phase.name !== 'calls') room.act('host-player-1', v);
        else advance(20);
      }
    }
    expect(sawWindow).toBe(true);
  });

  it('lets a bot stand in for a disconnected person so the table keeps moving', () => {
    const { clock, advance } = fakeClock();
    const { room } = makeRoom(clock);
    room.join('host-player-1', 'Ryn');
    room.start('host-player-1');
    const seq = room.table!.seq;
    room.disconnect('host-player-1');
    advance(1000);
    expect(room.table!.seq).toBeLessThanOrEqual(seq + 3); // bots pass, the person's seat waits
    advance(timing.standInAfterMs + 2000);
    expect(room.table!.seq).toBeGreaterThan(seq + 3);
  });

  it('keeps two people apart: each acts only for their own seat', () => {
    const { clock } = fakeClock();
    const { room, lastView } = makeRoom(clock);
    room.join('host-player-1', 'A');
    room.join('guest-player-2', 'B');
    expect(room.start('guest-player-2')).toMatch(/host/);
    room.start('host-player-1');
    const a = lastView('host-player-1')!.view;
    const b = lastView('guest-player-2')!.view;
    expect(a.you).not.toBe(b.you);
    expect(a.hand.some((id) => b.hand.includes(id))).toBe(false);
    // B tries to pass A's tiles.
    const err = room.act('guest-player-2', { type: 'pass-tiles', tiles: a.hand.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX).slice(0, 3) });
    expect(err).toMatch(/own rack/);
  });

  it('rotates the deal after a hand', () => {
    const { clock, advance } = fakeClock();
    const { room } = makeRoom(clock);
    room.join('host-player-1', 'Ryn');
    room.setBot('host-player-1', 1, 'random');
    expect(room.info('host-player-1').yourSeat).toBe(0);
    room.start('host-player-1');
    room.disconnect('host-player-1');
    for (let i = 0; i < 4000 && room.table!.phase.name !== 'ended'; i++) advance(6000);
    room.join('host-player-1', 'Ryn');
    expect(room.newHand('host-player-1')).toBeNull();
    expect(room.info('host-player-1').yourSeat).toBe(3);
    expect(room.hands).toBe(2);
  });
});

describe('Game server over WebSocket', () => {
  function client(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: ServerMessage[] = [];
    const waiters: ((m: ServerMessage) => void)[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      msgs.push(m);
      waiters.splice(0).forEach((w) => w(m));
    });
    const until = (pred: (m: ServerMessage) => boolean) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const hit = msgs.find(pred);
        if (hit) return resolve(hit);
        const timer = setTimeout(() => reject(new Error('timeout')), 4000);
        const check = (m: ServerMessage) => {
          if (pred(m)) {
            clearTimeout(timer);
            resolve(m);
          } else waiters.push(check);
        };
        waiters.push(check);
      });
    const open = new Promise<void>((r) => ws.on('open', () => r()));
    return { ws, msgs, until, open, send: (m: unknown) => ws.send(JSON.stringify(m)) };
  }

  it('creates a room, lets a second person join by code, and deals each their own view', async () => {
    const custom = { ...(DEMO_CARD_JSON as object), id: 'private-test', title: 'Private test card' };
    const srv = await startServer({ port: 0, timing, cardJson: JSON.stringify(custom), cardPasscode: 'open sesame' });
    try {
      const a = client(srv.port);
      await a.open;
      a.send({ t: 'create', name: 'Host', playerId: 'player-aaaa-1', passcode: 'wrong' });
      expect(await a.until((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/passcode/) });
      a.send({ t: 'create', name: 'Host', playerId: 'player-aaaa-1', passcode: 'open sesame' });
      const joined = (await a.until((m) => m.t === 'joined')) as { code: string };
      const room = (await a.until((m) => m.t === 'room')) as Extract<ServerMessage, { t: 'room' }>;
      expect(room.room.officialCard).toBe(true);
      expect(room.room.cardTitle).toBe('Private test card');

      const b = client(srv.port);
      await b.open;
      b.send({ t: 'join', code: joined.code.toLowerCase(), name: 'Guest', playerId: 'player-bbbb-2' });
      await b.until((m) => m.t === 'joined');
      a.send({ t: 'start' });
      const va = (await a.until((m) => m.t === 'view')) as Extract<ServerMessage, { t: 'view' }>;
      const vb = (await b.until((m) => m.t === 'view')) as Extract<ServerMessage, { t: 'view' }>;
      expect(va.view.you).not.toBe(vb.view.you);
      expect(va.view.hand.some((id) => vb.view.hand.includes(id))).toBe(false);

      b.send({ t: 'act', action: { type: 'discard', tile: vb.view.hand[0] } });
      expect(await b.until((m) => m.t === 'error')).toMatchObject({ t: 'error' });
      a.send({ t: 'nonsense' });
      expect(await a.until((m) => m.t === 'error' && /Malformed/.test(m.message))).toBeTruthy();
      a.ws.close();
      b.ws.close();
    } finally {
      await srv.close();
    }
  });
});
