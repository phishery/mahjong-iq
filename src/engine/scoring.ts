/**
 * Player scoring (100 points per round):
 *   70 — strategic recognition (regret-based credit for each ranked decision)
 *   30 — Charleston decision quality (judged on information available when passing)
 *
 * Ranking credit uses *ratio regret*: credit = min(1, value/best)^γ, so choosing a hand at
 * 18% when the best is 19% earns ~92% credit while choosing 4% earns ~10%. With simulated
 * probabilities γ = 1.5. With heuristic scores (a 4th-root transform of an approximate
 * probability) γ = 3, which is gentler than the exact equivalent to allow for heuristic noise.
 */

import {
  metricOf,
  neededKinds,
  rankedBy,
  selectionKey,
  type Basis,
  type Candidate,
  type DecisionAnalysis,
  type Selection,
} from './analysis';

export const STRATEGY_POINTS = 70;
export const PASSING_POINTS = 30;
export const SLOT_WEIGHTS = [0.45, 0.27, 0.18] as const;
export const ORDER_WEIGHT = 0.1;

export function gammaFor(basis: Basis): number {
  return basis === 'simulation' ? 1.5 : 3;
}

export interface PickResult {
  selection: Selection;
  key: string;
  value: number;
  /** 1-based rank of this pick among all candidates under the grading basis. */
  rank: number;
  credit: number;
  candidate: Candidate | null;
}

export interface Flexibility {
  /** Mean pairwise overlap (Jaccard) of needed tile kinds between the three choices, 0–1. */
  overlap: number;
  /** 0–100, higher = more distinct backup routes. */
  score: number;
}

export interface RankingGrade {
  basis: Basis;
  credit: number;
  picks: PickResult[];
  orderCredit: number;
  top: Candidate[];
  recognized: string[];
  overlooked: Candidate[];
  yourFlexibility: Flexibility;
  topFlexibility: Flexibility;
}

export function flexibilityOf(cands: Candidate[]): Flexibility {
  const sets = cands.map(neededKinds);
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const inter = [...sets[i]].filter((k) => sets[j].has(k)).length;
      const union = new Set([...sets[i], ...sets[j]]).size;
      total += union ? inter / union : 0;
      pairs++;
    }
  const overlap = pairs ? total / pairs : 0;
  return { overlap, score: Math.round(100 * (1 - overlap)) };
}

export function gradeRanking(an: DecisionAnalysis, picks: Selection[], basis: Basis): RankingGrade {
  if (picks.length !== 3) throw new Error('A ranking needs exactly three selections');
  const keys = picks.map(selectionKey);
  if (new Set(keys).size !== 3) throw new Error('Selections must be distinct');
  const ordered = rankedBy(an, basis);
  const values = ordered.map((c) => metricOf(c, basis));
  const gamma = gammaFor(basis);

  const results: PickResult[] = picks.map((s, i) => {
    const key = keys[i];
    const cand = an.byKey.get(key) ?? null;
    if (cand && cand.level !== s.level) throw new Error('Selection level mismatch');
    const value = cand ? metricOf(cand, basis) : 0;
    const rank = cand ? ordered.findIndex((c) => c.key === key) + 1 : ordered.length + 1;
    const bestForSlot = values[i] ?? 0;
    const ratio = bestForSlot > 0 ? Math.min(1, value / bestForSlot) : 1;
    return { selection: s, key, value, rank, credit: Math.pow(ratio, gamma), candidate: cand };
  });

  // Prioritisation: fraction of the three pairs ordered consistently with their values.
  let good = 0;
  const pv = results.map((r) => r.value);
  if (pv[0] >= pv[1] - 1e-12) good++;
  if (pv[0] >= pv[2] - 1e-12) good++;
  if (pv[1] >= pv[2] - 1e-12) good++;
  const orderCredit = good / 3;

  const credit =
    SLOT_WEIGHTS[0] * results[0].credit +
    SLOT_WEIGHTS[1] * results[1].credit +
    SLOT_WEIGHTS[2] * results[2].credit +
    ORDER_WEIGHT * orderCredit;

  const top = ordered.slice(0, 3);
  const topKeys = new Set(top.map((c) => c.key));
  const recognized = keys.filter((k) => topKeys.has(k));
  const overlooked = top.filter((c) => !keys.includes(c.key));
  const pickedCands = results.map((r) => r.candidate).filter((c): c is Candidate => !!c);

  return {
    basis,
    credit: Math.max(0, Math.min(1, credit)),
    picks: results,
    orderCredit,
    top,
    recognized,
    overlooked,
    yourFlexibility: flexibilityOf(pickedCands),
    topFlexibility: flexibilityOf(top),
  };
}

export interface RoundScore {
  total: number;
  strategy: number;
  passing: number | null;
  strategyMax: number;
  passingMax: number;
  decisionCredits: number[];
  passCredits: number[];
}

/** Combine decision and pass credits into the 100-point round score. */
export function roundScore(decisionCredits: number[], passCredits: number[]): RoundScore {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  if (passCredits.length === 0) {
    // Opening-rack drills: no passes, so recognition is worth the full 100.
    const strategy = 100 * mean(decisionCredits);
    return {
      total: Math.round(strategy),
      strategy,
      passing: null,
      strategyMax: 100,
      passingMax: 0,
      decisionCredits,
      passCredits,
    };
  }
  const strategy = STRATEGY_POINTS * mean(decisionCredits);
  const passing = PASSING_POINTS * mean(passCredits);
  return {
    total: Math.round(strategy + passing),
    strategy,
    passing,
    strategyMax: STRATEGY_POINTS,
    passingMax: PASSING_POINTS,
    decisionCredits,
    passCredits,
  };
}
