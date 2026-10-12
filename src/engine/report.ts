/**
 * End-of-round report: score breakdown, decision timeline, pass analysis and lessons.
 */

import { rankedBy, selectionLabel } from './analysis';
import type { LoadedCard } from './card/schema';
import type { RoundState } from './game';
import { roundScore, type RoundScore } from './scoring';
import { kindName, KINDS, countsFromIds } from './tiles';

export interface TimelineEntry {
  index: number;
  stepLabel: string;
  level: string;
  yourPicks: string[];
  engineTop: string[];
  credit: number;
  basis: string;
  bestCategory: string;
  pivotJustified: boolean;
  pivoted: boolean;
}

export interface RoundReport {
  score: RoundScore;
  timeline: TimelineEntry[];
  strongestPass: { label: string; credit: number } | null;
  weakestPass: { label: string; credit: number; better: string } | null;
  initialStrategy: string;
  finalStrategy: string;
  lessons: string[];
  durationSec: number;
}

export function buildReport(card: LoadedCard, state: RoundState): RoundReport {
  const score = roundScore(
    state.decisions.map((d) => d.grade.credit),
    state.passes.map((p) => p.grade.credit),
  );

  let prevBestCat: string | null = null;
  let prevPickCat: string | null = null;
  const timeline: TimelineEntry[] = state.decisions.map((d) => {
    const top = rankedBy(d.analysis, d.grade.basis);
    const bestCat = top[0].best.variant.categoryId;
    const pickCat = d.grade.picks[0].candidate?.best.variant.categoryId ?? null;
    const pivotJustified = prevBestCat !== null && bestCat !== prevBestCat;
    const pivoted = prevPickCat !== null && pickCat !== prevPickCat;
    prevBestCat = bestCat;
    prevPickCat = pickCat;
    return {
      index: d.index,
      stepLabel: d.stepLabel,
      level: d.level,
      yourPicks: d.picks.map((p) => selectionLabel(card, p)),
      engineTop: top.slice(0, 3).map((c) => c.label),
      credit: d.grade.credit,
      basis: d.grade.basis,
      bestCategory: card.categoryById.get(bestCat)!.name,
      pivotJustified,
      pivoted,
    };
  });

  const passes = state.passes.map((p) => ({
    label: p.step.label,
    credit: p.grade.credit,
    better: p.grade.bestKinds.map(kindName).join(', '),
    yours: p.grade.yourKinds.map(kindName).join(', '),
  }));
  const sorted = [...passes].sort((a, b) => b.credit - a.credit);
  const strongestPass = sorted[0] ? { label: sorted[0].label, credit: sorted[0].credit } : null;
  const w = sorted[sorted.length - 1];
  const weakestPass = w && w.credit < 0.85 ? { label: w.label, credit: w.credit, better: w.better } : null;

  const lessons: string[] = [];
  const missedPivot = timeline.find((t) => t.pivotJustified && !t.pivoted && t.credit < 0.7);
  if (missedPivot) {
    lessons.push(
      `${missedPivot.stepLabel}: the strongest opportunity moved to ${missedPivot.bestCategory}, but your plan stayed put. Re-read your rack fresh after every pass — yesterday’s best plan isn’t sacred.`,
    );
  }
  const goodPivot = timeline.find((t) => t.pivotJustified && t.pivoted && t.credit >= 0.7);
  if (goodPivot) lessons.push(`Nice pivot ${goodPivot.stepLabel.toLowerCase()} — you followed the tiles to ${goodPivot.bestCategory}.`);

  const weakDecision = [...timeline].sort((a, b) => a.credit - b.credit)[0];
  if (weakDecision && weakDecision.credit < 0.6) {
    lessons.push(
      `Toughest moment — ${weakDecision.stepLabel}: the engine preferred ${weakDecision.engineTop[0]} over your ${weakDecision.yourPicks[0]}. Compare how many exact pair/single tiles each still needs.`,
    );
  }
  if (weakestPass) {
    lessons.push(
      `On the ${weakestPass.label} pass, giving away ${weakestPass.better} would have kept more options open. Pass tiles that none of your top hands use, and never break up pairs you might need.`,
    );
  }
  // Pair-heavy picks lesson.
  const pairHeavy = state.decisions.some((d) => d.grade.picks[0].candidate && d.grade.picks[0].candidate.best.missingExact >= 4);
  if (pairHeavy && lessons.length < 3) {
    lessons.push('Hands needing many exact singles or pairs are harder than they look: Jokers can’t fill them and you can’t call them except for Mahjong.');
  }
  if (lessons.length === 0) {
    lessons.push('Great round. Keep testing yourself on the second and third choices — backups win games when the Charleston turns against you.');
  }
  // Rack composition lesson for opening-only drills.
  if (state.passes.length === 0 && lessons.length < 2) {
    const c = countsFromIds(state.decisions[0]?.rack ?? []);
    const jokers = c[KINDS.indexOf('J')];
    if (jokers) lessons.push(`With ${jokers} Joker${jokers > 1 ? 's' : ''}, favour hands with pungs, kongs and quints where Jokers count.`);
  }

  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  return {
    score,
    timeline,
    strongestPass,
    weakestPass,
    initialStrategy: first ? first.yourPicks[0] : '',
    finalStrategy: last ? last.yourPicks[0] : '',
    lessons: lessons.slice(0, 3),
    durationSec: Math.round((Date.now() - state.startedAt) / 1000),
  };
}
