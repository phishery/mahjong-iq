/**
 * Pass evaluation: judges which tiles to give away using only information available to
 * the passer at that moment (their own rack and what they have already passed).
 *
 * A pass is valued by the *rack potential* of the tiles kept (see heuristic.ts): a blend
 * of the best five lines, so keeping several options open is rewarded. Received tiles are
 * unknown when deciding, so they are not part of the decision-quality score.
 */

import type { HandVariant, LoadedCard } from './card/schema';
import {
  analyzeRack,
  evaluateOpportunity,
  potentialFromScores,
  unseenCount,
  type PlayerKnowledge,
} from './heuristic';
import { JOKER_INDEX, KINDS, NUM_KINDS, type TileKind } from './tiles';

export interface PassOption {
  /** Kind indices passed (length = number of own tiles passed). */
  kinds: number[];
  /** Potential of the kept tiles. */
  value: number;
}

export interface PassEvaluation {
  options: PassOption[]; // sorted best first
  best: PassOption;
  worst: PassOption;
  median: number;
}

/** Variants worth considering for pass search: top variants for the current rack. */
export function candidateVariants(card: LoadedCard, know: PlayerKnowledge, n = 60): HandVariant[] {
  const a = analyzeRack(card, know);
  const chosen = new Set<HandVariant>(a.ranked.slice(0, n).map((o) => o.variant));
  // Always include the best variant of each line so line-level options are represented.
  for (const o of a.bestByLine.values()) chosen.add(o.variant);
  return [...chosen];
}

/** Potential of a rack (kept tiles), evaluated over a fixed candidate variant set. */
export function keptPotential(card: LoadedCard, know: PlayerKnowledge, variants: HandVariant[]): number {
  const U = unseenCount(know);
  const best = new Map<string, number>();
  for (const v of variants) {
    const s = evaluateOpportunity(know, v, card.lineById.get(v.lineId)!.concealed, U).score;
    if ((best.get(v.lineId) ?? -1) < s) best.set(v.lineId, s);
  }
  return potentialFromScores([...best.values()]);
}

/** Enumerate distinct multisets of `size` passable kinds from the rack. */
export function enumeratePassKinds(rack: number[], size: number): number[][] {
  const kinds: number[] = [];
  for (let k = 0; k < NUM_KINDS; k++) if (k !== JOKER_INDEX && rack[k] > 0) kinds.push(k);
  const out: number[][] = [];
  const cur: number[] = [];
  const used = new Array(NUM_KINDS).fill(0);
  const rec = (start: number) => {
    if (cur.length === size) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < kinds.length; i++) {
      const k = kinds[i];
      if (used[k] >= rack[k]) continue;
      used[k]++;
      cur.push(k);
      rec(i);
      cur.pop();
      used[k]--;
    }
  };
  rec(0);
  return out;
}

function applyPass(know: PlayerKnowledge, kinds: number[]): PlayerKnowledge {
  const rack = [...know.rack];
  const away = [...know.knownElsewhere];
  for (const k of kinds) {
    rack[k]--;
    away[k]++;
  }
  return { rack, knownElsewhere: away };
}

export function evaluatePasses(card: LoadedCard, know: PlayerKnowledge, size: number): PassEvaluation {
  const variants = candidateVariants(card, know);
  const options = enumeratePassKinds(know.rack, size).map((kinds) => ({
    kinds,
    value: keptPotential(card, applyPass(know, kinds), variants),
  }));
  if (options.length === 0) {
    const none = { kinds: [], value: keptPotential(card, know, variants) };
    return { options: [none], best: none, worst: none, median: none.value };
  }
  options.sort((a, b) => b.value - a.value);
  const median = options[Math.floor(options.length / 2)].value;
  return { options, best: options[0], worst: options[options.length - 1], median };
}

export interface PassGrade {
  /** 0–1 decision quality credit. */
  credit: number;
  /** Fraction of possible passes that were worse than this one. */
  percentile: number;
  value: number;
  bestValue: number;
  bestKinds: TileKind[];
  yourKinds: TileKind[];
  optionsCount: number;
}

/**
 * Grade a pass: half by percentile among all legal passes, half by how close the kept
 * potential is to the best achievable (normalised between the worst and best options).
 */
export function gradePass(card: LoadedCard, know: PlayerKnowledge, passedKinds: number[]): PassGrade {
  const size = passedKinds.length;
  const yourKinds = passedKinds.map((k) => KINDS[k]);
  if (size === 0) {
    return { credit: 1, percentile: 1, value: 0, bestValue: 0, bestKinds: [], yourKinds, optionsCount: 1 };
  }
  const ev = evaluatePasses(card, know, size);
  const variants = candidateVariants(card, know);
  const value = keptPotential(card, applyPass(know, passedKinds), variants);
  const worse = ev.options.filter((o) => o.value < value - 1e-9).length;
  const ties = ev.options.filter((o) => Math.abs(o.value - value) <= 1e-9).length;
  const percentile = ev.options.length > 1 ? (worse + Math.max(0, ties - 1) / 2) / (ev.options.length - 1) : 1;
  const span = ev.best.value - ev.worst.value;
  const closeness = span > 1e-9 ? (value - ev.worst.value) / span : 1;
  const credit = Math.max(0, Math.min(1, 0.5 * percentile + 0.5 * closeness));
  return {
    credit,
    percentile,
    value,
    bestValue: ev.best.value,
    bestKinds: ev.best.kinds.map((k) => KINDS[k]),
    yourKinds,
    optionsCount: ev.options.length,
  };
}
