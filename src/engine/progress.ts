/**
 * Local learning progress and spaced repetition (pure functions; storage is injected).
 *
 * Tracks which categories the learner recognises, which lines they overlook, how often the
 * primary choice is misplaced, pass quality, and whether they pivot when they should.
 * A Leitner-style box per category drives targeted practice: categories the learner misses
 * drop to box 1 and come up more often.
 */

import type { LoadedCard } from './card/schema';
import type { Mode, RoundLength, RoundState } from './game';
import { buildReport } from './report';
import type { Rng } from './rng';

export interface CategoryStats {
  /** Decisions where this category held the strongest opportunity. */
  wasBest: number;
  /** …and the learner ranked it first. */
  recognizedFirst: number;
  /** …and the learner ranked it anywhere in the top three. */
  recognizedTop3: number;
  /** Leitner box 1–5 (1 = needs most practice). */
  box: number;
}

export interface ModeStats {
  rounds: number;
  best: number;
  total: number;
  last: number;
}

export interface ProgressData {
  version: 1;
  rounds: number;
  decisions: number;
  misplacedPrimary: number;
  byMode: Record<string, ModeStats>;
  categories: Record<string, CategoryStats>;
  missedLines: Record<string, number>;
  passCredits: number[];
  pivots: { opportunities: number; taken: number };
  confidence: { stated: number; credit: number }[];
  history: { at: number; mode: Mode; length: RoundLength; score: number }[];
}

export function emptyProgress(): ProgressData {
  return {
    version: 1,
    rounds: 0,
    decisions: 0,
    misplacedPrimary: 0,
    byMode: {},
    categories: {},
    missedLines: {},
    passCredits: [],
    pivots: { opportunities: 0, taken: 0 },
    confidence: [],
    history: [],
  };
}

export const modeKey = (mode: Mode, length: RoundLength) => `${mode}/${length}`;

function cat(p: ProgressData, id: string): CategoryStats {
  return (p.categories[id] ??= { wasBest: 0, recognizedFirst: 0, recognizedTop3: 0, box: 3 });
}

export function recordRound(prev: ProgressData, card: LoadedCard, state: RoundState): ProgressData {
  const p: ProgressData = structuredClone(prev);
  const report = buildReport(card, state);
  p.rounds++;
  const mk = modeKey(state.config.mode, state.config.length);
  const ms = (p.byMode[mk] ??= { rounds: 0, best: 0, total: 0, last: 0 });
  ms.rounds++;
  ms.total += report.score.total;
  ms.best = Math.max(ms.best, report.score.total);
  ms.last = report.score.total;

  for (const d of state.decisions) {
    p.decisions++;
    const top = d.grade.top[0];
    if (!top) continue;
    const bestCat = top.best.variant.categoryId;
    const picksCats = d.grade.picks.map((x) => x.candidate?.best.variant.categoryId);
    const c = cat(p, bestCat);
    c.wasBest++;
    const first = picksCats[0] === bestCat;
    if (first) c.recognizedFirst++;
    if (picksCats.includes(bestCat)) c.recognizedTop3++;
    // Leitner update for the category that was best.
    c.box = first ? Math.min(5, c.box + 1) : Math.max(1, c.box - 1);
    if (d.grade.picks[0].rank > 3) p.misplacedPrimary++;
    if (d.grade.picks[0].key !== top.key) {
      const line = top.best.variant.lineId;
      p.missedLines[line] = (p.missedLines[line] ?? 0) + 1;
    }
    if (d.confidence !== undefined) p.confidence.push({ stated: d.confidence, credit: d.grade.credit });
  }
  for (const t of report.timeline) {
    if (t.pivotJustified) {
      p.pivots.opportunities++;
      if (t.pivoted) p.pivots.taken++;
    }
  }
  p.passCredits = [...p.passCredits, ...state.passes.map((x) => x.grade.credit)].slice(-200);
  p.confidence = p.confidence.slice(-200);
  p.history = [...p.history, { at: Date.now(), mode: state.config.mode, length: state.config.length, score: report.score.total }].slice(-300);
  return p;
}

/** Pick a category to practise, weighted toward low Leitner boxes (spaced repetition). */
export function pickPracticeCategory(p: ProgressData, card: LoadedCard, rng: Rng): string {
  const weights = card.categories.map((c) => {
    const box = p.categories[c.id]?.box ?? 3;
    return 2 ** (5 - box);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return card.categories[i].id;
  }
  return card.categories[card.categories.length - 1].id;
}

export interface SessionSummary {
  rounds: number;
  averageScore: number;
  bestCategories: string[];
  missedPatterns: string[];
  recommendation: string;
}

export function summarize(p: ProgressData, card: LoadedCard, sinceIndex = 0): SessionSummary {
  const recent = p.history.slice(sinceIndex);
  const avg = recent.length ? recent.reduce((a, h) => a + h.score, 0) / recent.length : 0;
  const cats = Object.entries(p.categories)
    .filter(([, s]) => s.wasBest >= 2)
    .map(([id, s]) => ({ id, rate: s.recognizedFirst / s.wasBest, s }));
  const best = [...cats].sort((a, b) => b.rate - a.rate).slice(0, 2);
  const worst = [...cats].sort((a, b) => a.rate - b.rate)[0];
  const missed = Object.entries(p.missedLines)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => {
      const l = card.lineById.get(id);
      return l ? `${l.categoryName} #${l.line}` : id;
    });
  let recommendation = 'Play a few more rounds so Mahjong IQ can spot your patterns.';
  if (worst && worst.rate < 0.6) {
    recommendation = `Practise ${card.categoryById.get(worst.id)?.name ?? worst.id}: you ranked it first in only ${Math.round(worst.rate * 100)}% of the racks where it was strongest.`;
  } else if (p.pivots.opportunities >= 3 && p.pivots.taken / p.pivots.opportunities < 0.5) {
    recommendation = 'Practise pivoting: try the two-pass challenge and re-rank from scratch after each pass.';
  } else if (p.passCredits.length >= 5 && p.passCredits.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, p.passCredits.length) < 0.6) {
    recommendation = 'Focus on passing: before you pass, ask which tiles none of your top three hands use.';
  } else if (recent.length >= 3) {
    recommendation = 'You are reading racks well — try Advanced mode to practise exact hands.';
  }
  return {
    rounds: recent.length,
    averageScore: avg,
    bestCategories: best.map((b) => card.categoryById.get(b.id)?.name ?? b.id),
    missedPatterns: missed,
    recommendation,
  };
}
