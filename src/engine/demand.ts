/**
 * Tile demand: how strongly a typical player holds on to each tile kind, for a given card.
 *
 * Measured, not assumed: deal many random 13-tile racks, let each "player" aim at their
 * top three heuristic targets (keeping options open, as in the early game), and record how
 * often a held copy of each kind is used by one of those targets. That fraction is the
 * kind's *keep rate*; 1 − keep rate is how readily it is thrown away.
 *
 * Suits are interchangeable on the card, so number tiles are pooled by rank (all 6s share
 * one rate), Green and Red Dragons are pooled, and the White Dragon is kept separate because
 * it doubles as zero in year hands. Jokers are never discarded (keep rate 1).
 *
 * The simulator uses these rates to weight opponents' discards (see simulate.ts), so a hand
 * that needs Flowers can no longer count on Flowers being thrown as often as Winds.
 */

import type { LoadedCard } from './card/schema';
import { evaluateOpportunity, unseenCount } from './heuristic';
import { createRng, shuffle } from './rng';
import { allTileIds, countsFromIds, JOKER_INDEX, KINDS, NUM_KINDS } from './tiles';

export const DEMAND_RACKS = 600;
export const DEMAND_SEED = 90000;
/** How many top targets a player keeps tiles for. */
export const DEMAND_TARGETS = 3;

/** Suit-symmetric class of a tile kind (e.g. "n6" for any 6, "GR" for Green/Red Dragon). */
function classOf(kind: string): string {
  if (/^\d[BCD]$/.test(kind)) return 'n' + kind[0];
  if (kind === 'GD' || kind === 'RD') return 'GR';
  return kind;
}

export interface TileDemand {
  /** Keep rate per kind index, 0–1. Jokers are 1. */
  keep: Float64Array;
  /** Racks sampled to measure it. */
  racks: number;
}

/** Measure tile demand for a card. Deterministic for a given card, rack count and seed. */
export function measureDemand(card: LoadedCard, racks = DEMAND_RACKS, seed = DEMAND_SEED): TileDemand {
  const held = new Float64Array(NUM_KINDS);
  const kept = new Float64Array(NUM_KINDS);
  const concealed = card.variants.map((v) => card.lineById.get(v.lineId)!.concealed);
  const scores = new Float64Array(card.variants.length);
  const away = new Array(NUM_KINDS).fill(0);

  for (let s = 0; s < racks; s++) {
    const rack = countsFromIds(shuffle(allTileIds(), createRng(seed + s)).slice(0, 13));
    const know = { rack, knownElsewhere: away };
    const U = unseenCount(know);
    for (let i = 0; i < card.variants.length; i++) scores[i] = evaluateOpportunity(know, card.variants[i], concealed[i], U).score;
    // Indices of the top DEMAND_TARGETS variants.
    const top: number[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (top.length < DEMAND_TARGETS) {
        top.push(i);
        top.sort((a, b) => scores[b] - scores[a]);
      } else if (scores[i] > scores[top[top.length - 1]]) {
        top[top.length - 1] = i;
        top.sort((a, b) => scores[b] - scores[a]);
      }
    }
    for (let k = 0; k < NUM_KINDS; k++) {
      if (!rack[k] || k === JOKER_INDEX) continue;
      let use = 0;
      for (const i of top) {
        const v = card.variants[i];
        const need = v.needNJ[k] + v.needJ[k];
        if (need > use) use = need;
      }
      held[k] += rack[k];
      kept[k] += Math.min(rack[k], use);
    }
  }

  // Pool by suit-symmetric class.
  const classHeld = new Map<string, number>();
  const classKept = new Map<string, number>();
  KINDS.forEach((kind, k) => {
    const c = classOf(kind);
    classHeld.set(c, (classHeld.get(c) ?? 0) + held[k]);
    classKept.set(c, (classKept.get(c) ?? 0) + kept[k]);
  });
  const keep = new Float64Array(NUM_KINDS);
  KINDS.forEach((kind, k) => {
    if (k === JOKER_INDEX) {
      keep[k] = 1;
      return;
    }
    const c = classOf(kind);
    const h = classHeld.get(c) ?? 0;
    // Unseen in the sample (practically impossible): treat as average demand.
    keep[k] = h > 0 ? (classKept.get(c) ?? 0) / h : 0.5;
  });
  return { keep, racks };
}

const cache = new Map<string, TileDemand>();

/** Tile demand for a card, measured once and cached by card id and contents. */
export function cardDemand(card: LoadedCard): TileDemand {
  const key = `${card.def.id}|${card.variants.length}|${card.lines.length}`;
  let d = cache.get(key);
  if (!d) {
    d = measureDemand(card);
    if (cache.size > 8) cache.clear();
    cache.set(key, d);
  }
  return d;
}

/** Relative discard weight of a kind: 1 − keep rate (Jokers 0). */
export function discardWeights(d: TileDemand): Float64Array {
  const w = new Float64Array(NUM_KINDS);
  for (let k = 0; k < NUM_KINDS; k++) w[k] = k === JOKER_INDEX ? 0 : Math.max(0, 1 - d.keep[k]);
  return w;
}

