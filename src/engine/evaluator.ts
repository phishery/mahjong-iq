/**
 * Exact hand evaluator: how a rack (count vector) lines up against one concrete hand
 * variant, respecting joker eligibility (jokers only in groups of 3+).
 */

import { HAND_SIZE } from './card/parser';
import type { HandVariant } from './card/schema';
import { JOKER_INDEX, KINDS, NUM_KINDS, type Counts, type TileKind } from './tiles';

export interface GroupFill {
  kind: TileKind;
  count: number;
  jokerable: boolean;
  naturals: number;
  jokers: number;
  missing: number;
}

export interface VariantMatch {
  /** Natural (non-joker) tiles from the rack used by the hand. */
  naturals: number;
  /** Jokers from the rack used in eligible groups. */
  jokersUsed: number;
  /** Tiles still needed to complete the hand (14 − naturals − jokers). */
  distance: number;
  /** Missing tiles in singles/pairs (must be the exact tile — no jokers). */
  missingExact: number;
  /** Missing tiles in groups of 3+ (after placing the rack's jokers). */
  missingFlexible: number;
  complete: boolean;
  groups: GroupFill[];
}

/** Fast distance-only computation (hot loop for simulation and pass search). */
export function variantDistance(rack: Counts, v: HandVariant): number {
  let naturals = 0;
  let flexMissing = 0;
  const kinds = v.kinds;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    const h = rack[k];
    const nj = v.needNJ[k];
    const j = v.needJ[k];
    const a = h < nj ? h : nj;
    const rem = h - a;
    const b = rem < j ? rem : j;
    naturals += a + b;
    flexMissing += j - b;
  }
  const jk = rack[JOKER_INDEX];
  return HAND_SIZE - naturals - (jk < flexMissing ? jk : flexMissing);
}

export function matchVariant(rack: Counts, v: HandVariant): VariantMatch {
  // Per-kind remaining naturals, consumed first by exact groups (pairs/singles), then flexible groups.
  const remaining = new Array<number>(NUM_KINDS);
  for (let i = 0; i < NUM_KINDS; i++) remaining[i] = rack[i];
  const groups: GroupFill[] = v.groups.map((g) => ({ ...g, naturals: 0, jokers: 0, missing: 0 }));
  const order = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => Number(a.g.jokerable) - Number(b.g.jokerable) || a.i - b.i);
  for (const { g } of order) {
    const ki = KINDS.indexOf(g.kind);
    const use = Math.min(remaining[ki], g.count);
    remaining[ki] -= use;
    g.naturals = use;
    g.missing = g.count - use;
  }
  // Place jokers into flexible groups, smallest gaps first so more groups become complete.
  let jokers = rack[JOKER_INDEX];
  const flex = groups.filter((g) => g.jokerable && g.missing > 0).sort((a, b) => a.missing - b.missing);
  for (const g of flex) {
    const use = Math.min(jokers, g.missing);
    g.jokers = use;
    g.missing -= use;
    jokers -= use;
  }
  const naturals = groups.reduce((a, g) => a + g.naturals, 0);
  const jokersUsed = groups.reduce((a, g) => a + g.jokers, 0);
  const missingExact = groups.filter((g) => !g.jokerable).reduce((a, g) => a + g.missing, 0);
  const missingFlexible = groups.filter((g) => g.jokerable).reduce((a, g) => a + g.missing, 0);
  const distance = HAND_SIZE - naturals - jokersUsed;
  return { naturals, jokersUsed, distance, missingExact, missingFlexible, complete: distance === 0, groups };
}

/**
 * Which rack tile kinds contribute to the variant, with counts (naturals plus jokers).
 * Used to highlight tiles in the rack.
 */
export function contributingCounts(rack: Counts, v: HandVariant): number[] {
  const m = matchVariant(rack, v);
  const out = new Array<number>(NUM_KINDS).fill(0);
  for (const g of m.groups) out[KINDS.indexOf(g.kind)] += g.naturals;
  out[JOKER_INDEX] = m.jokersUsed;
  return out;
}

/** Tiles in the rack the variant does not use at all (natural excess plus unusable jokers). */
export function excessCounts(rack: Counts, v: HandVariant): number[] {
  const used = contributingCounts(rack, v);
  return Array.from(rack, (c, i) => c - used[i]);
}
