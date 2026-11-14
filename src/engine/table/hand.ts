/**
 * Hand rules for live play: which card hands are still possible given a player's exposures,
 * and whether a concealed rack plus exposures is a complete Mahjong.
 *
 * An exposure is always a group of 3–6 identical tiles (naturals of one kind plus Jokers), so
 * it can only stand for a joker-eligible group of the same kind and size on the card.
 * Concealed (C) hands may never have exposures.
 */

import type { HandVariant, LoadedCard } from '../card/schema';
import { HAND_SIZE } from '../card/parser';
import { JOKER_INDEX, KIND_INDEX, KIND_OF_ID, NUM_KINDS, type TileId } from '../tiles';

export interface Exposure {
  /** Kind index the group represents (the called tile's kind). */
  kind: number;
  /** Physical tiles in the group: naturals of `kind` and Jokers. */
  tiles: TileId[];
  /** Seat whose discard was called to make the group. */
  calledFrom: number;
  /** The called discard. */
  calledTile: TileId;
}

export type GroupKey = `${number}x${number}`; // kind x count

const groupKey = (kind: number, count: number): GroupKey => `${kind}x${count}`;

/** The joker-eligible groups of a variant as kind×count keys (a multiset). */
function flexGroupKeys(v: HandVariant): GroupKey[] {
  return v.groups.filter((g) => g.jokerable).map((g) => groupKey(KIND_INDEX[g.kind], g.count));
}

/** True if every exposure can be matched to a distinct joker-eligible group of the variant. */
export function variantAccepts(v: HandVariant, exposures: readonly { kind: number; size: number }[]): boolean {
  if (exposures.length === 0) return true;
  const pool = flexGroupKeys(v);
  for (const e of exposures) {
    const i = pool.indexOf(groupKey(e.kind, e.size));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

const shapeOf = (exposures: readonly Exposure[]) => exposures.map((e) => ({ kind: e.kind, size: e.tiles.length }));

const compatCache = new Map<string, HandVariant[]>();

/**
 * Variants a player can still make with these exposures. With no exposures every variant is
 * possible; with any exposure, concealed hands drop out.
 */
export function compatibleVariants(card: LoadedCard, exposures: readonly { kind: number; size: number }[]): HandVariant[] {
  if (exposures.length === 0) return card.variants;
  const key = `${card.def.id}|${card.variants.length}|${exposures
    .map((e) => groupKey(e.kind, e.size))
    .sort()
    .join(',')}`;
  let hit = compatCache.get(key);
  if (!hit) {
    hit = card.variants.filter((v) => !card.lineById.get(v.lineId)!.concealed && variantAccepts(v, exposures));
    if (compatCache.size > 500) compatCache.clear();
    compatCache.set(key, hit);
  }
  return hit;
}

export function compatibleWithExposures(card: LoadedCard, exposures: readonly Exposure[]): HandVariant[] {
  return compatibleVariants(card, shapeOf(exposures));
}

/**
 * Tiles still missing for variant v, given the concealed counts and exposures (which are
 * assumed to match v's groups — check variantAccepts first). 0 means the hand is complete.
 */
export function concealedDistance(concealed: readonly number[], exposures: readonly { kind: number; size: number }[], v: HandVariant): number {
  const needJ = Array.from(v.needJ);
  let exposed = 0;
  for (const e of exposures) {
    needJ[e.kind] -= e.size;
    exposed += e.size;
  }
  let naturals = 0;
  let flexMissing = 0;
  for (let i = 0; i < v.kinds.length; i++) {
    const k = v.kinds[i];
    const h = concealed[k];
    const nj = v.needNJ[k];
    const j = needJ[k];
    const a = h < nj ? h : nj;
    const rem = h - a;
    const b = rem < j ? rem : j;
    naturals += a + b;
    flexMissing += j - b;
  }
  const jk = concealed[JOKER_INDEX];
  return HAND_SIZE - exposed - naturals - (jk < flexMissing ? jk : flexMissing);
}

export interface MahjongMatch {
  variant: HandVariant;
  value: number;
  jokerless: boolean;
  /** Payment basis: card value, doubled when jokerless (and the hand allows jokers at all). */
  basis: number;
}

export function lineValue(card: LoadedCard, v: HandVariant): number {
  return card.lineById.get(v.lineId)!.value ?? 25;
}

/**
 * The best-paying card hand that the concealed tiles plus exposures complete exactly, or
 * null if they are not a Mahjong. `concealed` must make the total 14 tiles.
 */
export function findMahjong(card: LoadedCard, concealedIds: readonly TileId[], exposures: readonly Exposure[]): MahjongMatch | null {
  const total = concealedIds.length + exposures.reduce((s, e) => s + e.tiles.length, 0);
  if (total !== HAND_SIZE) return null;
  const counts = new Array<number>(NUM_KINDS).fill(0);
  for (const id of concealedIds) counts[KIND_OF_ID[id]]++;
  const shape = shapeOf(exposures);
  const jokers = counts[JOKER_INDEX] + exposures.reduce((s, e) => s + e.tiles.filter((t) => KIND_OF_ID[t] === JOKER_INDEX).length, 0);
  let best: MahjongMatch | null = null;
  for (const v of compatibleVariants(card, shape)) {
    if (concealedDistance(counts, shape, v) !== 0) continue;
    const value = lineValue(card, v);
    const jokerless = jokers === 0 && v.groups.some((g) => g.jokerable);
    const basis = jokerless ? value * 2 : value;
    if (!best || basis > best.basis) best = { variant: v, value, jokerless, basis };
  }
  return best;
}

/** Concealed tile counts (kind index → count). */
export function countsOf(ids: readonly TileId[]): number[] {
  const c = new Array<number>(NUM_KINDS).fill(0);
  for (const id of ids) c[KIND_OF_ID[id]]++;
  return c;
}

/** Counts used to judge a hand's prospects: concealed tiles plus exposed groups (Jokers in a group count as its kind). */
export function holdingCounts(concealedIds: readonly TileId[], exposures: readonly Exposure[]): number[] {
  const c = countsOf(concealedIds);
  for (const e of exposures) c[e.kind] += e.tiles.length;
  return c;
}
