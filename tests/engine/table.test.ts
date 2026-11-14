import { describe, expect, it } from 'vitest';
import type { HandVariant } from '../../src/engine/card/schema';
import { createRng } from '../../src/engine/rng';
import {
  applyAction,
  assertTableConservation,
  callOptions,
  createTable,
  findMahjong,
  nextBotMove,
  resolveCharlestonPass,
  tableFromRound,
  TableError,
  viewFor,
  type SeatConfig,
  type TableState,
} from '../../src/engine/table';
import { allTileIds, idsForKinds, JOKER_INDEX, KIND_INDEX, KIND_OF_ID, KINDS, type TileId, type TileKind } from '../../src/engine/tiles';
import { card, playRound } from './helpers';

const bots = (p: 'competent' | 'casual' | 'random' = 'competent'): SeatConfig[] => [0, 1, 2, 3].map((i) => ({ name: `Bot ${i}`, bot: p }));

function playOut(s: TableState, limit = 3000): TableState {
  for (let i = 0; i < limit && s.phase.name !== 'ended'; i++) {
    const m = nextBotMove(card, s);
    if (!m) throw new Error(`No bot move in phase ${s.phase.name}`);
    s = applyAction(card, s, m.seat, m.action);
  }
  return s;
}

/** Kinds of a variant's tiles, one per tile. */
function kindsOf(v: HandVariant): TileKind[] {
  return v.groups.flatMap((g) => Array.from({ length: g.count }, () => g.kind));
}

/**
 * A table in play with chosen hands. `hands[s]` lists kinds for seat s; the rest of each rack
 * is filled with filler tiles (never Jokers or the `avoid` kinds). Seat `turn` holds 14.
 */
function rig(hands: TileKind[][], turn: number, avoid: TileKind[] = []): TableState {
  const s = createTable(card, { seed: 7, seats: bots(), charleston: false, courtesy: false });
  const used = new Set<TileId>();
  const concealed = hands.map((h) => {
    const ids = idsForKinds(h, used);
    ids.forEach((id) => used.add(id));
    return ids;
  });
  const avoidK = new Set([JOKER_INDEX, ...avoid.map((k) => KIND_INDEX[k])]);
  const filler = allTileIds().filter((id) => !used.has(id) && !avoidK.has(KIND_OF_ID[id]));
  // Spread filler so no seat gets several copies of a kind by accident.
  filler.sort((a, b) => (a % 4) - (b % 4) || a - b);
  concealed.forEach((r, seat) => {
    const want = seat === turn ? 14 : 13;
    while (r.length < want) {
      const id = filler.shift()!;
      used.add(id);
      r.push(id);
    }
  });
  const wall = allTileIds().filter((id) => !used.has(id));
  const state: TableState = { ...s, concealed, wall, phase: { name: 'turn', seat: turn, drawn: null, called: false } };
  assertTableConservation(state);
  return state;
}

const exposedVariant = card.variants.find(
  (v) => !card.lineById.get(v.lineId)!.concealed && v.groups.some((g) => g.jokerable && g.count === 3 && !['F', 'J'].includes(g.kind)),
)!;
const pung = exposedVariant.groups.find((g) => g.jokerable && g.count === 3 && g.kind !== 'F')!.kind;

describe('Mahjong validation', () => {
  it('accepts an exact hand from the card and rejects 13 tiles', () => {
    const ids = idsForKinds(kindsOf(exposedVariant));
    expect(findMahjong(card, ids, [])?.variant.lineId).toBe(exposedVariant.lineId);
    expect(findMahjong(card, ids.slice(1), [])).toBeNull();
  });

  it('allows Jokers in groups of 3+ but never in pairs or singles', () => {
    const kinds = kindsOf(exposedVariant);
    const flex = kinds.indexOf(pung);
    const withJ = [...kinds];
    withJ[flex] = 'J';
    const m = findMahjong(card, idsForKinds(withJ), []);
    expect(m).not.toBeNull();
    expect(m!.jokerless).toBe(false);
    expect(findMahjong(card, idsForKinds(kinds), [])!.jokerless).toBe(true);
    const exact = exposedVariant.groups.find((g) => !g.jokerable);
    if (exact) {
      const bad = [...kinds];
      bad[kinds.indexOf(exact.kind)] = 'J';
      const m2 = findMahjong(card, idsForKinds(bad), []);
      // Only valid if some other hand happens to fit; never via a Joker in that pair.
      if (m2) expect(m2.variant.groups.find((g) => g.kind === exact.kind)?.jokerable).toBe(true);
    }
  });
});

describe('Charleston at the table', () => {
  it('moves tiles with blind passes and conserves every tile', () => {
    const racks = [0, 1, 2, 3].map((s) => allTileIds().slice(s * 13, s * 13 + 13));
    const subs = racks.map((r, s) => ({ tiles: r.slice(0, 3 - (s % 3)), blind: s % 3 }));
    const res = resolveCharlestonPass(racks, subs, 'left', createRng(1));
    res.racks.forEach((r) => expect(r).toHaveLength(13));
    expect(new Set(res.racks.flat()).size).toBe(52);
  });

  it('moves nothing when every seat passes all three blind', () => {
    const racks = [0, 1, 2, 3].map((s) => allTileIds().slice(s * 13, s * 13 + 13));
    const res = resolveCharlestonPass(racks, racks.map(() => ({ tiles: [], blind: 3 })), 'right', createRng(2));
    expect(res.racks).toEqual(racks);
  });

  it('rejects passing a Joker or the wrong count', () => {
    const s = createTable(card, { seed: 3, seats: bots(), charleston: true, courtesy: false });
    const own = s.concealed[1];
    expect(() => applyAction(card, s, 1, { type: 'pass-tiles', tiles: own.slice(0, 2) })).toThrow(TableError);
    const joker = idsForKinds(['J'])[0];
    const s2: TableState = { ...s, concealed: s.concealed.map((r, i) => (i === 1 ? [joker, ...r.filter((x) => x !== joker).slice(1)] : r.filter((x) => x !== joker))) };
    expect(() => applyAction(card, s2, 1, { type: 'pass-tiles', tiles: [joker, own[1], own[2]] })).toThrow(TableError);
  });

  it('runs both Charlestons and the courtesy pass to the first turn', () => {
    let s = createTable(card, { seed: 11, seats: bots('random'), charleston: true, courtesy: true });
    while (s.phase.name !== 'turn') {
      const m = nextBotMove(card, s)!;
      s = applyAction(card, s, m.seat, m.action);
    }
    expect(s.log.some((e) => e.type === 'pass')).toBe(true);
    expect(s.concealed[0]).toHaveLength(14);
  });
});

describe('Live play', () => {
  it('plays complete four-bot games: every game ends and payments balance', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const profile = (['competent', 'casual', 'random'] as const)[seed % 3];
      const end = playOut(createTable(card, { seed, seats: bots(profile), charleston: seed % 2 === 0, courtesy: true }));
      expect(end.phase.name).toBe('ended');
      if (end.phase.name !== 'ended') continue;
      const r = end.phase.result;
      expect(r.payments.reduce((a, b) => a + b, 0)).toBe(0);
      if (r.type === 'mahjong') {
        expect(r.payments[r.winner!]).toBeGreaterThan(0);
        expect(findMahjong(card, end.concealed[r.winner!], end.exposures[r.winner!])).not.toBeNull();
      }
    }
  });

  it('only lets the seat on turn discard, and only its own tiles', () => {
    const s = createTable(card, { seed: 5, seats: bots(), charleston: false, courtesy: false });
    expect(() => applyAction(card, s, 1, { type: 'discard', tile: s.concealed[1][0] })).toThrow(TableError);
    expect(() => applyAction(card, s, 0, { type: 'discard', tile: s.concealed[1][0] })).toThrow(TableError);
    const next = applyAction(card, s, 0, { type: 'discard', tile: s.concealed[0][0] });
    expect(next.discards).toHaveLength(1);
  });

  it('gives a Mahjong call priority over an exposure call, and pays the discarder double', () => {
    const kinds = kindsOf(exposedVariant);
    // Seat 3 needs one more `pung` tile to win; seat 1 can expose a pung with one natural + a Joker.
    const winner = [...kinds];
    winner.splice(winner.indexOf(pung), 1);
    const s = rig([[pung], [pung, 'J'], [], winner], 0, [pung]);
    const discard = s.concealed[0].find((id) => KINDS[KIND_OF_ID[id]] === pung)!;
    let t = applyAction(card, s, 0, { type: 'discard', tile: discard });
    expect(t.phase.name).toBe('calls');
    expect(callOptions(card, t, 1).some((o) => o.type === 'expose')).toBe(true);
    expect(callOptions(card, t, 3).some((o) => o.type === 'mahjong')).toBe(true);
    const expose = callOptions(card, t, 1).find((o) => o.type === 'expose')!;
    t = applyAction(card, t, 1, { type: 'call', response: { type: 'expose', tiles: (expose as { tiles: TileId[] }).tiles } });
    t = applyAction(card, t, 3, { type: 'call', response: { type: 'mahjong' } });
    expect(t.phase.name).toBe('ended');
    if (t.phase.name !== 'ended') return;
    expect(t.phase.result.winner).toBe(3);
    const basis = t.phase.result.payments[3] / 4; // discarder 2×, two others 1× each
    expect(t.phase.result.payments[0]).toBe(-2 * basis);
    expect(t.phase.result.payments[1]).toBe(-basis);
  });

  it('exposes a called group and gives the caller the turn; Joker swaps return the Joker', () => {
    const s = rig([[pung], [pung, 'J'], [pung], []], 0, [pung]);
    const discard = s.concealed[0].find((id) => KINDS[KIND_OF_ID[id]] === pung)!;
    let t = applyAction(card, s, 0, { type: 'discard', tile: discard });
    const opt = callOptions(card, t, 1).find((o) => o.type === 'expose') as { tiles: TileId[] };
    t = applyAction(card, t, 1, { type: 'call', response: { type: 'expose', tiles: opt.tiles } });
    for (const seat of [2, 3]) if (t.phase.name === 'calls' && t.phase.responses[seat] === null) t = applyAction(card, t, seat, { type: 'call', response: { type: 'pass' } });
    expect(t.phase).toMatchObject({ name: 'turn', seat: 1, called: true });
    expect(t.exposures[1][0].tiles).toHaveLength(3);
    expect(t.exposures[1][0].tiles.some((id) => KIND_OF_ID[id] === JOKER_INDEX)).toBe(true);
    // Seat 1 discards; seat 2 draws and may swap its natural for the exposed Joker.
    t = applyAction(card, t, 1, { type: 'discard', tile: t.concealed[1].find((id) => KINDS[KIND_OF_ID[id]] !== pung)! });
    while (t.phase.name === 'calls') {
      const seat = t.phase.responses.findIndex((r) => r === null);
      t = applyAction(card, t, seat, { type: 'call', response: { type: 'pass' } });
    }
    expect(t.phase).toMatchObject({ name: 'turn', seat: 2 });
    const give = t.concealed[2].find((id) => KINDS[KIND_OF_ID[id]] === pung)!;
    const u = applyAction(card, t, 2, { type: 'joker-swap', give, seat: 1, exposure: 0 });
    expect(u.concealed[2].some((id) => KIND_OF_ID[id] === JOKER_INDEX)).toBe(true);
    expect(u.exposures[1][0].tiles.every((id) => KINDS[KIND_OF_ID[id]] === pung)).toBe(true);
  });

  it('refuses an exposure that no hand on the card can use', () => {
    const s = createTable(card, { seed: 9, seats: bots(), charleston: false, courtesy: false });
    const t = applyAction(card, s, 0, { type: 'discard', tile: s.concealed[0][0] });
    if (t.phase.name !== 'calls') return; // someone could not call; nothing to test on this seed
    for (const seat of [1, 2, 3]) {
      if (t.phase.responses[seat] !== null) continue;
      expect(() => applyAction(card, t, seat, { type: 'call', response: { type: 'expose', tiles: t.concealed[seat].slice(0, 2) } })).toThrow();
    }
  });
});

describe('Hidden information', () => {
  it('a seat sees only its own rack, and other seats’ draws are hidden', () => {
    let s = createTable(card, { seed: 21, seats: bots(), charleston: false, courtesy: false });
    for (let i = 0; i < 12; i++) {
      const m = nextBotMove(card, s)!;
      s = applyAction(card, s, m.seat, m.action);
    }
    const v = viewFor(card, s, 2);
    expect(v.hand).toEqual(s.concealed[2]);
    const json = JSON.stringify({ ...v, hand: [] });
    for (const seat of [0, 1, 3]) {
      for (const id of s.concealed[seat]) {
        // Other seats' concealed tiles can only appear if they were public (floor/exposure/own draws never).
        const publicIds = new Set([...v.floor.map((f) => f.tile), ...v.seats.flatMap((x) => x.exposures.flatMap((e) => e.tiles))]);
        if (!publicIds.has(id)) expect(json.includes(`"tile":${id}}`)).toBe(false);
      }
    }
    expect(v.events.filter((e) => e.type === 'draw' && e.seat !== 2).every((e) => (e as { tile: unknown }).tile === null)).toBe(true);
    expect(v.revealed).toBeNull();
  });
});

describe('Continuing a trainer round', () => {
  it('turns a finished Charleston into a live game with the player in the right seat', () => {
    const round = playRound({ length: 'full', seed: 77 }).final;
    const { state, you } = tableFromRound(card, round, { playerName: 'You', profile: 'competent' });
    expect(state.concealed[you].sort()).toEqual([...round.racks.you].sort());
    expect(state.concealed[0]).toHaveLength(14); // the dealer is East and opens play
    expect(state.config.seats[you].bot).toBeNull();
    expect(state.phase).toMatchObject({ name: 'turn', seat: 0 });
    // Everyone but the player is a bot; play it out with a bot standing in for the player too.
    let s = state;
    for (let i = 0; i < 3000 && s.phase.name !== 'ended'; i++) {
      const m = nextBotMove(card, s, () => 'competent')!;
      s = applyAction(card, s, m.seat, m.action);
    }
    expect(s.phase.name).toBe('ended');
  });
});
