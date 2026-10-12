/**
 * Decision analysis: turns rack evaluation into ranked *candidates* at the level the player
 * is choosing at (category, card line, or exact variant), optionally enriched with Monte
 * Carlo probabilities.
 */

import { patternsOf } from './card/parser';
import type { HandVariant, LoadedCard } from './card/schema';
import { analyzeRack, type Opportunity, type PlayerKnowledge } from './heuristic';
import type { SimResult, SimTarget } from './simulate';

export type Level = 'category' | 'line' | 'variant';

export interface Selection {
  level: Level;
  /** categoryId, lineId or variantId depending on level. */
  id: string;
}

export const selectionKey = (s: Selection) => `${s.level}:${s.id}`;

export interface Candidate {
  key: string;
  level: Level;
  id: string;
  label: string;
  sublabel: string;
  /** Heuristic opportunity score (0–100) of the best variant inside this candidate. */
  heuristic: number;
  best: Opportunity;
  /** Number of variants this candidate covers. */
  variantCount: number;
  /** Variants within 80% of the candidate's best heuristic score (depth of options). */
  strongVariants: number;
  sim?: SimResult;
}

export interface DecisionAnalysis {
  level: Level;
  /** Candidates sorted by heuristic, best first. For 'variant' this is the top slice plus extras. */
  candidates: Candidate[];
  byKey: Map<string, Candidate>;
}

export const VARIANT_SHORTLIST = 12;

export function lineLabel(card: LoadedCard, lineId: string): string {
  const l = card.lineById.get(lineId)!;
  return `${l.categoryName} #${l.line}`;
}

export function variantLabel(card: LoadedCard, v: HandVariant): string {
  return `${lineLabel(card, v.lineId)} · ${v.configLabel}`;
}

export function selectionLabel(card: LoadedCard, s: Selection): string {
  if (s.level === 'category') return card.categoryById.get(s.id)?.name ?? s.id;
  if (s.level === 'line') return lineLabel(card, s.id);
  const v = card.variantById.get(s.id);
  return v ? variantLabel(card, v) : s.id;
}

function variantCandidate(card: LoadedCard, o: Opportunity): Candidate {
  const line = card.lineById.get(o.variant.lineId)!;
  return {
    key: `variant:${o.variant.id}`,
    level: 'variant',
    id: o.variant.id,
    label: variantLabel(card, o.variant),
    sublabel: line.description ?? patternsOf(line).join(" -or- "),
    heuristic: o.score,
    best: o,
    variantCount: 1,
    strongVariants: 1,
  };
}

export function buildCandidates(
  card: LoadedCard,
  know: PlayerKnowledge,
  level: Level,
  extraVariantIds: string[] = [],
): DecisionAnalysis {
  const a = analyzeRack(card, know);
  let candidates: Candidate[];
  if (level === 'category') {
    candidates = card.categories.map((c) => {
      const best = a.bestByCategory.get(c.id)!;
      const vs = a.all.filter((o) => o.variant.categoryId === c.id);
      return {
        key: `category:${c.id}`,
        level,
        id: c.id,
        label: c.name,
        sublabel: c.description ?? '',
        heuristic: best.score,
        best,
        variantCount: vs.length,
        strongVariants: vs.filter((o) => o.score >= best.score * 0.8 && best.score > 0).length,
      };
    });
  } else if (level === 'line') {
    candidates = card.lines.map((l) => {
      const best = a.bestByLine.get(l.id)!;
      const vs = l.variants.map((v) => a.all[v.index]);
      return {
        key: `line:${l.id}`,
        level,
        id: l.id,
        label: lineLabel(card, l.id),
        sublabel: l.description ?? patternsOf(l).join(" -or- "),
        heuristic: best.score,
        best,
        variantCount: l.variants.length,
        strongVariants: vs.filter((o) => o.score >= best.score * 0.8 && best.score > 0).length,
      };
    });
  } else {
    const chosen = new Map<string, Opportunity>();
    for (const o of a.ranked.slice(0, VARIANT_SHORTLIST)) chosen.set(o.variant.id, o);
    for (const id of extraVariantIds) {
      const v = card.variantById.get(id);
      if (v) chosen.set(id, a.all[v.index]);
    }
    candidates = [...chosen.values()].map((o) => variantCandidate(card, o));
  }
  candidates.sort((x, y) => y.heuristic - x.heuristic || x.label.localeCompare(y.label));
  return { level, candidates, byKey: new Map(candidates.map((c) => [c.key, c])) };
}

/** Ensure a selection is represented in the analysis (variant picks outside the shortlist). */
export function withSelections(card: LoadedCard, know: PlayerKnowledge, an: DecisionAnalysis, picks: Selection[]): DecisionAnalysis {
  const missing = picks.filter((p) => !an.byKey.has(selectionKey(p)) && p.level === 'variant').map((p) => p.id);
  if (!missing.length) return an;
  const extra = buildCandidates(card, know, 'variant', [...an.candidates.map((c) => c.id), ...missing]);
  // Preserve existing sim results.
  for (const c of extra.candidates) {
    const old = an.byKey.get(c.key);
    if (old?.sim) c.sim = old.sim;
  }
  return extra;
}

/** Simulation targets covering every candidate in the analysis. */
export function simTargets(card: LoadedCard, an: DecisionAnalysis): SimTarget[] {
  return an.candidates.map((c) => {
    let variantIndices: number[];
    if (c.level === 'category') variantIndices = card.variants.filter((v) => v.categoryId === c.id).map((v) => v.index);
    else if (c.level === 'line') variantIndices = card.lineById.get(c.id)!.variants.map((v) => v.index);
    else variantIndices = [card.variantById.get(c.id)!.index];
    return { key: c.key, variantIndices };
  });
}

export function attachSim(an: DecisionAnalysis, results: SimResult[]): DecisionAnalysis {
  const map = new Map(results.map((r) => [r.key, r]));
  const candidates = an.candidates.map((c) => (map.has(c.key) ? { ...c, sim: map.get(c.key) } : c));
  return { ...an, candidates, byKey: new Map(candidates.map((c) => [c.key, c])) };
}

export type Basis = 'simulation' | 'heuristic';

/** Minimum successes for the leading candidate before simulated probabilities drive grading. */
export const MIN_SUCCESSES_FOR_SIM_GRADING = 25;

/**
 * Simulated probabilities are used for grading only when every candidate has a result and
 * the leader's estimate rests on enough successes to be meaningfully precise; otherwise
 * grading falls back to the (clearly labelled) heuristic score.
 */
export function chooseBasis(an: DecisionAnalysis): Basis {
  if (!an.candidates.length || an.candidates.some((c) => !c.sim)) return 'heuristic';
  const leader = Math.max(...an.candidates.map((c) => c.sim!.successes));
  return leader >= MIN_SUCCESSES_FOR_SIM_GRADING ? 'simulation' : 'heuristic';
}

export function metricOf(c: Candidate, basis: Basis): number {
  return basis === 'simulation' ? (c.sim?.p ?? 0) : c.heuristic;
}

export function rankedBy(an: DecisionAnalysis, basis: Basis): Candidate[] {
  return [...an.candidates].sort((a, b) => metricOf(b, basis) - metricOf(a, basis) || b.heuristic - a.heuristic);
}

/** Every distinct kind the candidate's best variant needs (for overlap measures). */
export function neededKinds(c: Candidate): Set<number> {
  return new Set(Array.from(c.best.variant.kinds));
}
