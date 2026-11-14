/**
 * Computer players for live play. A bot decides using ONLY what its seat can see: its own
 * concealed tiles and exposures, every exposure on the table, the discard floor, and the
 * tiles it passed during the Charleston. It never looks at other racks or the wall.
 *
 * Profiles (same names as the Charleston opponents):
 *  - competent ("Strategic"): discards the tile that keeps its best hand strongest, calls an
 *    exposure only when it clearly helps, swaps for exposed Jokers whenever that helps.
 *  - casual: similar but with human-like slips and eager calls.
 *  - random: random legal discards; only ever calls Mahjong.
 *
 * A complete hand is always declared (self-drawn or on a discard).
 */

import type { HandVariant, LoadedCard } from '../card/schema';
import { evaluateOpportunity, potentialFromScores, unseenCount, type PlayerKnowledge } from '../heuristic';
import { choosePass, courtesyRequest, wantsSecondCharleston, type OpponentProfile } from '../opponents';
import { createRng, mixSeed, type Rng } from '../rng';
import { JOKER_INDEX, KIND_OF_ID, NUM_KINDS, type TileId } from '../tiles';
import { compatibleVariants, findMahjong, holdingCounts, type Exposure } from './hand';
import { callOptions, jokerSwaps, pendingSeats, SEATS, type SeatIndex, type TableAction, type TableState } from './table';

/** How many of the best variants a decision is evaluated over. */
const SHORTLIST = 40;

type Shape = { kind: number; size: number }[];
const shapeOf = (es: readonly Exposure[]): Shape => es.map((e) => ({ kind: e.kind, size: e.tiles.length }));

/** Tiles this seat knows are out of play or in another rack (by kind). */
export function seatKnowledgeElsewhere(state: TableState, seat: SeatIndex): number[] {
  const ids = new Set<TileId>();
  for (const d of state.discards) if (!d.called) ids.add(d.tile);
  for (const s of SEATS) if (s !== seat) for (const e of state.exposures[s]) for (const t of e.tiles) ids.add(t);
  const own = new Set(state.concealed[seat]);
  for (const t of state.passHistory[seat]) if (!own.has(t)) ids.add(t);
  const c = new Array<number>(NUM_KINDS).fill(0);
  for (const id of ids) c[KIND_OF_ID[id]]++;
  return c;
}

/** Score a holding over a variant set: the best hand late in the game, a blend of lines early. */
function holdingValue(card: LoadedCard, know: PlayerKnowledge, variants: readonly HandVariant[], focus: boolean): number {
  const U = unseenCount(know);
  const byLine = new Map<string, number>();
  let best = 0;
  for (const v of variants) {
    const s = evaluateOpportunity(know, v, card.lineById.get(v.lineId)!.concealed, U).score;
    if (s > best) best = s;
    if (!focus && (byLine.get(v.lineId) ?? -1) < s) byLine.set(v.lineId, s);
  }
  return focus ? best : potentialFromScores([...byLine.values()]);
}

function shortlist(card: LoadedCard, know: PlayerKnowledge, shape: Shape): HandVariant[] {
  const vs = compatibleVariants(card, shape);
  if (vs.length <= SHORTLIST) return vs;
  const U = unseenCount(know);
  return vs
    .map((v) => ({ v, s: evaluateOpportunity(know, v, card.lineById.get(v.lineId)!.concealed, U).score }))
    .sort((a, b) => b.s - a.s)
    .slice(0, SHORTLIST)
    .map((x) => x.v);
}

interface Holding {
  concealed: TileId[];
  exposures: Exposure[];
}

/** Rank discards from a 14-tile holding: best (keeps the most value) first. */
function rankDiscards(card: LoadedCard, state: TableState, seat: SeatIndex, h: Holding): { tile: TileId; value: number }[] {
  const elsewhere = seatKnowledgeElsewhere(state, seat);
  const counts = holdingCounts(h.concealed, h.exposures);
  const shape = shapeOf(h.exposures);
  const know = { rack: counts, knownElsewhere: elsewhere };
  const vs = shortlist(card, know, shape);
  const focus = h.exposures.length > 0 || state.wall.length < 50;
  const floor = new Array<number>(NUM_KINDS).fill(0);
  for (const d of state.discards) if (!d.called) floor[KIND_OF_ID[d.tile]]++;
  const seen = new Set<number>();
  const out: { tile: TileId; value: number }[] = [];
  const onlyJokers = h.concealed.every((id) => KIND_OF_ID[id] === JOKER_INDEX);
  for (const id of h.concealed) {
    const k = KIND_OF_ID[id];
    if (seen.has(k) || (k === JOKER_INDEX && !onlyJokers)) continue;
    seen.add(k);
    const rack = counts.slice();
    rack[k]--;
    // Small tie-break toward tiles already on the floor (less useful and safer to throw).
    const value = holdingValue(card, { rack, knownElsewhere: elsewhere }, vs, focus) + floor[k] * 0.01;
    out.push({ tile: id, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

function bestDiscardValue(card: LoadedCard, state: TableState, seat: SeatIndex, h: Holding): number {
  return rankDiscards(card, state, seat, h)[0]?.value ?? 0;
}

/** Value of a 13-tile holding (no discard owed). */
function restingValue(card: LoadedCard, state: TableState, seat: SeatIndex, h: Holding): number {
  const know = { rack: holdingCounts(h.concealed, h.exposures), knownElsewhere: seatKnowledgeElsewhere(state, seat) };
  return holdingValue(card, know, shortlist(card, know, shapeOf(h.exposures)), true);
}

function chooseDiscard(card: LoadedCard, state: TableState, seat: SeatIndex, profile: OpponentProfile, rng: Rng): TileId {
  const own = state.concealed[seat];
  if (profile === 'random') {
    const legal = own.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX);
    return (legal.length ? legal : own)[rng.int(legal.length || own.length)];
  }
  const ranked = rankDiscards(card, state, seat, { concealed: own, exposures: state.exposures[seat] });
  const slip = profile === 'casual' ? 0.25 : 0.04;
  if (ranked.length > 1 && rng.next() < slip) return ranked[1].tile;
  return ranked[0].tile;
}

function exposeAfter(state: TableState, seat: SeatIndex, tile: TileId, tiles: TileId[]): Holding {
  return {
    concealed: state.concealed[seat].filter((id) => !tiles.includes(id)),
    exposures: [...state.exposures[seat], { kind: KIND_OF_ID[tile], tiles: [tile, ...tiles], calledFrom: -1, calledTile: tile }],
  };
}

function swapAfter(state: TableState, seat: SeatIndex, give: TileId): Holding {
  // Only this seat's holding changes in value terms: it gives a natural and gains a Joker.
  return { concealed: [...state.concealed[seat].filter((id) => id !== give), findJokerId(state)], exposures: state.exposures[seat] };
}

/** Any Joker id for valuation (all Jokers are identical). */
function findJokerId(state: TableState): TileId {
  for (const es of state.exposures) for (const e of es) for (const t of e.tiles) if (KIND_OF_ID[t] === JOKER_INDEX) return t;
  throw new Error('No exposed Joker');
}

export function botRng(state: TableState, seat: SeatIndex): Rng {
  return createRng(mixSeed(state.config.seed, 0x626f74, state.seq, seat));
}

/** The action a bot takes in the current phase, or null if it owes none. */
export function botAction(card: LoadedCard, state: TableState, seat: SeatIndex, profile: OpponentProfile): TableAction | null {
  const ph = state.phase;
  const rng = botRng(state, seat);
  const own = state.concealed[seat];
  const view = { rack: own, passedAway: state.passHistory[seat].filter((id) => !own.includes(id)) };
  switch (ph.name) {
    case 'charleston':
      if (ph.subs[seat]) return null;
      return { type: 'pass-tiles', tiles: choosePass(card, view, 3, profile, rng), blind: 0 };
    case 'vote':
      if (ph.votes[seat] !== null) return null;
      return { type: 'vote', proceed: wantsSecondCharleston(card, view, profile, rng) };
    case 'courtesy-request':
      if (ph.requests[seat] !== null) return null;
      return { type: 'courtesy-request', count: courtesyRequest(card, view, profile, rng) };
    case 'courtesy-select':
      if (ph.subs[seat]) return null;
      return { type: 'courtesy-tiles', tiles: choosePass(card, view, ph.agreed[seat], profile, rng) };
    case 'turn': {
      if (ph.seat !== seat) return null;
      if (findMahjong(card, own, state.exposures[seat])) return { type: 'mahjong' };
      if (profile !== 'random') {
        const swaps = jokerSwaps(state, seat);
        if (swaps.length && (profile === 'competent' || rng.next() < 0.6)) {
          const here = { concealed: own, exposures: state.exposures[seat] };
          const before = bestDiscardValue(card, state, seat, here);
          for (const s of swaps) {
            if (bestDiscardValue(card, state, seat, swapAfter(state, seat, s.give)) >= before) {
              return { type: 'joker-swap', give: s.give, seat: s.seat, exposure: s.exposure };
            }
          }
        }
      }
      return { type: 'discard', tile: chooseDiscard(card, state, seat, profile, rng) };
    }
    case 'calls': {
      if (ph.responses[seat] !== null) return null;
      const opts = callOptions(card, state, seat);
      if (opts.some((o) => o.type === 'mahjong')) return { type: 'call', response: { type: 'mahjong' } };
      const exposes = opts.filter((o): o is Extract<typeof o, { type: 'expose' }> => o.type === 'expose');
      if (exposes.length === 0) return { type: 'call', response: { type: 'pass' } };
      if (profile === 'random') {
        return rng.next() < 0.3
          ? { type: 'call', response: { type: 'expose', tiles: exposes[0].tiles } }
          : { type: 'call', response: { type: 'pass' } };
      }
      const before = restingValue(card, state, seat, { concealed: own, exposures: state.exposures[seat] });
      const margin = profile === 'competent' ? 3 : -1;
      let best: { tiles: TileId[]; value: number } | null = null;
      for (const o of exposes) {
        const value = bestDiscardValue(card, state, seat, exposeAfter(state, seat, ph.tile, o.tiles));
        if (value > before + margin && (!best || value > best.value)) best = { tiles: o.tiles, value };
      }
      return best ? { type: 'call', response: { type: 'expose', tiles: best.tiles } } : { type: 'call', response: { type: 'pass' } };
    }
    case 'ended':
      return null;
  }
}

/** Suggested discard for a person (used by the solo table's hint). */
export function suggestDiscard(card: LoadedCard, state: TableState, seat: SeatIndex): TileId | null {
  const ph = state.phase;
  if (ph.name !== 'turn' || ph.seat !== seat) return null;
  return rankDiscards(card, state, seat, { concealed: state.concealed[seat], exposures: state.exposures[seat] })[0]?.tile ?? null;
}

/**
 * The next move any bot-controlled seat owes, or null. `profileOf` decides who is a bot
 * (by default the table's seat config; the server also lets a bot stand in for an absent
 * person).
 */
export function nextBotMove(
  card: LoadedCard,
  state: TableState,
  profileOf: (seat: SeatIndex) => OpponentProfile | null = (s) => state.config.seats[s].bot,
): { seat: SeatIndex; action: TableAction } | null {
  for (const seat of pendingSeats(state)) {
    const profile = profileOf(seat);
    if (!profile) continue;
    const action = botAction(card, state, seat, profile);
    if (action) return { seat, action };
  }
  return null;
}
