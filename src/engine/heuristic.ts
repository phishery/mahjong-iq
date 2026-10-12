/**
 * Heuristic opportunity score (0–100).
 *
 * THIS IS NOT A WIN PROBABILITY. It is a fast, deterministic measure of how promising a hand
 * variant looks for the tiles currently held. For each tile kind the hand still needs:
 *
 *   - Singles and pairs need the exact tile (no jokers): outs = live copies (≤ 4, or 8 Flowers).
 *   - Groups of 3+ can use Jokers: outs = live copies + a share of the live Jokers.
 *   - Exposed hands can call discards for pungs/kongs/quints, so those groups get extra
 *     "looks" per turn; concealed hands only see their own draws.
 *   - Tiles the player passed away are in opponents' racks and count only 25% as live.
 *   - An exact requirement with too few live copies makes the hand dead (score 0).
 *
 *   p_k   = P(Binomial(looks, outs/unseen) ≥ missing_k)       per needed tile kind
 *   score = 100 · (Π_k p_k^w_k)^(1/4)                           (w = 1.2 exact, 1 flexible)
 *
 * The product treats tile kinds as independent and the 4th root spreads small values across
 * 0–100, so the number is a relative opportunity score, not a probability. Weights were
 * calibrated against the Monte Carlo engine with scripts/calibrate-heuristic.ts (mean
 * Spearman ≈ 0.85 between heuristic line ranking and simulated line completion on random
 * racks). The older "sum of expected waits" form is kept as `form: 'waits'` for comparison.
 */

import type { HandVariant, LoadedCard } from './card/schema';
import { HAND_SIZE } from './card/parser';
import { JOKER_INDEX, KINDS, NUM_KINDS, SUPPLY, TOTAL_TILES, type Counts, type TileKind } from './tiles';

/**
 * Tunable weights. Defaults were calibrated against the Monte Carlo engine
 * (scripts/calibrate-heuristic.ts) to maximise rank agreement on random racks.
 */
export interface HeuristicParams {
  scale: number;
  /** Fraction of a passed-away tile still counted as live. */
  knownWeight: number;
  /** Multiplier on live copies for joker-eligible groups of exposed hands (discards can be called). */
  callBoost: number;
  /** Cost multiplier for each missing single/pair tile. */
  exactMult: number;
  /** Cost multiplier for each missing tile in a group of 3+. */
  flexMult: number;
  /** Weight on the live Joker supply shared across flexible needs. */
  jokerWeight: number;
  /** 'waits': sum of expected waiting times. 'analytic': product of per-tile-kind binomial tails. */
  form: 'waits' | 'analytic';
  /** Analytic form: player turns in the horizon (matches the simulator default). */
  horizon: number;
  /** Analytic form: extra looks per turn at discards for joker-eligible groups of exposed hands. */
  callLooks: number;
  /** Analytic form: score = 100 · P^(1/root) to spread small probabilities over 0–100. */
  root: number;
}

export const DEFAULT_HEURISTIC: HeuristicParams = {
  scale: 120,
  knownWeight: 0.25,
  callBoost: 1,
  exactMult: 1.2,
  flexMult: 1,
  jokerWeight: 0.3,
  form: 'analytic',
  horizon: 20,
  callLooks: 1,
  root: 4,
};
export const HEURISTIC_SCALE = DEFAULT_HEURISTIC.scale;
export const KNOWN_ELSEWHERE_WEIGHT = DEFAULT_HEURISTIC.knownWeight;
const DEAD_COST = 400;

/** P(Binomial(n, p) ≥ m). */
export function binomTail(n: number, p: number, m: number): number {
  if (m <= 0) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return m <= n ? 1 : 0;
  if (m > n) return 0;
  let term = Math.pow(1 - p, n); // i = 0
  let below = term;
  const r = p / (1 - p);
  for (let i = 1; i < m; i++) {
    term *= ((n - i + 1) / i) * r;
    below += term;
  }
  return Math.max(0, 1 - below);
}

/** What the player legitimately knows. Never includes opponents' racks. */
export interface PlayerKnowledge {
  /** The player's own rack as a count vector. */
  rack: number[];
  /** Tiles the player passed away and has not received back (now somewhere in opponents' racks). */
  knownElsewhere: number[];
}

export interface Opportunity {
  variant: HandVariant;
  score: number;
  cost: number;
  naturals: number;
  jokersUsed: number;
  distance: number;
  missingExact: number;
  missingFlexible: number;
  /** An exact requirement (single/pair) cannot be met from live tiles. */
  dead: boolean;
  /** Missing exact tiles whose live supply is 2 or fewer (very hard). */
  scarceExact: { kind: TileKind; missing: number; live: number }[];
}

export function knowledgeFromRack(rack: number[], knownElsewhere?: number[]): PlayerKnowledge {
  return { rack, knownElsewhere: knownElsewhere ?? new Array(NUM_KINDS).fill(0) };
}

export function unseenCount(k: PlayerKnowledge): number {
  let held = 0;
  let away = 0;
  for (let i = 0; i < NUM_KINDS; i++) {
    held += k.rack[i];
    away += k.knownElsewhere[i];
  }
  return TOTAL_TILES - held - away * (1 - KNOWN_ELSEWHERE_WEIGHT);
}

export function evaluateOpportunity(
  know: PlayerKnowledge,
  v: HandVariant,
  concealed: boolean,
  U?: number,
  P: HeuristicParams = DEFAULT_HEURISTIC,
): Opportunity {
  const rack = know.rack;
  const unseen = U ?? unseenCount(know);
  const callBoost = concealed ? 1 : P.callBoost;
  const analytic = P.form === 'analytic';
  let logP = 0;
  let naturals = 0;
  let cost = 0;
  let dead = false;
  let missingExact = 0;
  const scarceExact: Opportunity['scarceExact'] = [];
  // Flexible needs per kind after naturals.
  const flexKinds: number[] = [];
  const flexMissing: number[] = [];
  const flexLive: number[] = [];

  for (let i = 0; i < v.kinds.length; i++) {
    const k = v.kinds[i];
    const h = rack[k];
    const nj = v.needNJ[k];
    const j = v.needJ[k];
    const a = Math.min(h, nj);
    const b = Math.min(h - a, j);
    naturals += a + b;
    const live = Math.max(0, SUPPLY[k] - h - know.knownElsewhere[k] * (1 - P.knownWeight));
    const mNJ = nj - a;
    if (mNJ > 0) {
      missingExact += mNJ;
      if (live < mNJ - 1e-9) {
        dead = true;
        cost += DEAD_COST * (mNJ - live);
      }
      cost += (P.exactMult * mNJ * (unseen + 1)) / (live + 1);
      if (analytic) logP += P.exactMult * Math.log(Math.max(1e-12, binomTail(P.horizon, live / unseen, mNJ)));
      if (live <= 2) scarceExact.push({ kind: KINDS[k], missing: mNJ, live: Math.round(live * 10) / 10 });
    }
    const mJ = j - b;
    if (mJ > 0) {
      flexKinds.push(k);
      flexMissing.push(mJ);
      flexLive.push(Math.max(0, live - mNJ));
    }
  }

  // Place held jokers on the flexible needs with the fewest live copies (hardest first).
  let jokers = rack[JOKER_INDEX];
  let jokersUsed = 0;
  const order = flexKinds.map((_, i) => i).sort((x, y) => flexLive[x] - flexLive[y]);
  for (const i of order) {
    if (jokers <= 0) break;
    const use = Math.min(jokers, flexMissing[i]);
    flexMissing[i] -= use;
    jokers -= use;
    jokersUsed += use;
  }
  const totalFlex = flexMissing.reduce((s, x) => s + x, 0);
  const liveJokers = Math.max(0, SUPPLY[JOKER_INDEX] - rack[JOKER_INDEX]);
  for (let i = 0; i < flexKinds.length; i++) {
    const m = flexMissing[i];
    if (m <= 0) continue;
    const jokerShare = (P.jokerWeight * liveJokers * m) / totalFlex;
    const outs = flexLive[i] * callBoost + jokerShare;
    cost += (P.flexMult * m * (unseen + 1)) / (outs + 1);
    if (analytic) {
      const looks = Math.round(P.horizon * (1 + (concealed ? 0 : P.callLooks)));
      const pk = Math.min(1, (flexLive[i] + jokerShare) / unseen);
      logP += P.flexMult * Math.log(Math.max(1e-12, binomTail(looks, pk, m)));
    }
  }
  if (analytic) cost = -logP * 25; // keep "cost" on a comparable scale for explanations

  const distance = HAND_SIZE - naturals - jokersUsed;
  const score = dead ? 0 : analytic ? 100 * Math.exp(logP / P.root) : 100 * Math.exp(-cost / P.scale);
  return {
    variant: v,
    score,
    cost,
    naturals,
    jokersUsed,
    distance,
    missingExact,
    missingFlexible: totalFlex,
    dead,
    scarceExact,
  };
}

export interface RackAnalysis {
  /** One entry per card variant, indexed by variant.index. */
  all: Opportunity[];
  /** Variant opportunities sorted best first. */
  ranked: Opportunity[];
  bestByLine: Map<string, Opportunity>;
  bestByCategory: Map<string, Opportunity>;
  /** Count of variants per category scoring within 70% of that category's best (depth). */
  depthByCategory: Map<string, number>;
}

const analysisCache = new Map<string, RackAnalysis>();

export function analyzeRack(card: LoadedCard, know: PlayerKnowledge): RackAnalysis {
  const key = `${card.def.id}|${know.rack.join('')}|${know.knownElsewhere.join('')}`;
  const hit = analysisCache.get(key);
  if (hit) return hit;
  const U = unseenCount(know);
  const all = card.variants.map((v) => evaluateOpportunity(know, v, card.lineById.get(v.lineId)!.concealed, U));
  const ranked = [...all].sort((a, b) => b.score - a.score || a.cost - b.cost);
  const bestByLine = new Map<string, Opportunity>();
  const bestByCategory = new Map<string, Opportunity>();
  for (const o of ranked) {
    if (!bestByLine.has(o.variant.lineId)) bestByLine.set(o.variant.lineId, o);
    if (!bestByCategory.has(o.variant.categoryId)) bestByCategory.set(o.variant.categoryId, o);
  }
  const depthByCategory = new Map<string, number>();
  for (const o of all) {
    const best = bestByCategory.get(o.variant.categoryId)!;
    if (best.score > 0 && o.score >= best.score * 0.7) {
      depthByCategory.set(o.variant.categoryId, (depthByCategory.get(o.variant.categoryId) ?? 0) + 1);
    }
  }
  const res = { all, ranked, bestByLine, bestByCategory, depthByCategory };
  if (analysisCache.size > 400) analysisCache.clear();
  analysisCache.set(key, res);
  return res;
}

/**
 * Overall rack potential (0–100): weighted blend of the best five *lines*, so that racks
 * keeping several distinct options open are valued above racks with a single strong line.
 * Used to judge Charleston passes and by simulated opponents.
 */
export const POTENTIAL_WEIGHTS = [1, 0.5, 0.3, 0.2, 0.1];

export function potentialFromScores(lineBest: number[]): number {
  const top = lineBest.sort((a, b) => b - a).slice(0, POTENTIAL_WEIGHTS.length);
  let s = 0;
  let w = 0;
  top.forEach((x, i) => {
    s += x * POTENTIAL_WEIGHTS[i];
    w += POTENTIAL_WEIGHTS[i];
  });
  return w ? s / w : 0;
}

export function rackPotential(card: LoadedCard, know: PlayerKnowledge, variants?: HandVariant[]): number {
  const U = unseenCount(know);
  const best = new Map<string, number>();
  for (const v of variants ?? card.variants) {
    const o = evaluateOpportunity(know, v, card.lineById.get(v.lineId)!.concealed, U);
    if ((best.get(v.lineId) ?? -1) < o.score) best.set(v.lineId, o.score);
  }
  return potentialFromScores([...best.values()]);
}

export function countsSum(c: Counts): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s += c[i];
  return s;
}
