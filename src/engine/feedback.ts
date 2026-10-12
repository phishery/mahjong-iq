/**
 * Deterministic teaching feedback. Every sentence is generated from engine results — no
 * invented statistics. This is what the player sees when no AI coach is configured, and it
 * is also the factual basis handed to the AI coach.
 */

import {
  metricOf,
  rankedBy,
  selectionKey,
  selectionLabel,
  type Basis,
  type Candidate,
  type DecisionAnalysis,
} from './analysis';
import type { LoadedCard } from './card/schema';
import type { DecisionRecord, PassRecord } from './game';
import { analyzeRack, type Opportunity, type PlayerKnowledge } from './heuristic';
import {
  countsFromIds,
  isDragon,
  isWind,
  KINDS,
  kindName,
  kindNamePlural,
  kindOfTile,
  NUM_KINDS,
  SUIT_NAMES,
  suitOf,
  type Suit,
  type TileId,
  type TileKind,
} from './tiles';

export type Tone = 'great' | 'good' | 'ok' | 'miss';

export interface Feedback {
  headline: string;
  tone: Tone;
  /** 1–3 short lines shown by default. */
  summary: string[];
  /** Extra detail shown when expanded. */
  details: string[];
}

export function formatMetric(value: number, basis: Basis): string {
  return basis === 'simulation' ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(0)}`;
}

export function metricName(basis: Basis): string {
  return basis === 'simulation' ? 'simulated completion' : 'opportunity score';
}

export function toneFor(credit: number): Tone {
  if (credit >= 0.9) return 'great';
  if (credit >= 0.7) return 'good';
  if (credit >= 0.45) return 'ok';
  return 'miss';
}

const HEADLINES: Record<Tone, string[]> = {
  great: ['Excellent read!', 'Spot on.', 'Sharp eye!'],
  good: ['Solid choices.', 'Good thinking.', 'Nicely done.'],
  ok: ['Reasonable — but there was a stronger option.', 'Close, with room to improve.'],
  miss: ['A stronger opportunity was available.', 'Missed opportunity — let’s see why.'],
};

/** Plain-language description of what a hand still needs. */
export function describeNeeds(o: Opportunity): string {
  const parts: string[] = [];
  parts.push(`you hold ${o.naturals}${o.jokersUsed ? ` + ${o.jokersUsed} Joker${o.jokersUsed > 1 ? 's' : ''}` : ''} of its 14 tiles`);
  const needs: string[] = [];
  if (o.missingExact) needs.push(`${o.missingExact} exact tile${o.missingExact > 1 ? 's' : ''} for singles/pairs (no Jokers allowed)`);
  if (o.missingFlexible) needs.push(`${o.missingFlexible} for pungs/kongs where Jokers can help`);
  if (needs.length) parts.push(`it still needs ${needs.join(' and ')}`);
  if (o.dead) parts.push('one exact requirement can no longer be met');
  return parts.join('; ');
}

/** Compare two opportunities and explain the most important structural difference. */
export function explainDifference(card: LoadedCard, better: Opportunity, worse: Opportunity): string {
  const b = better;
  const w = worse;
  if (w.dead && !b.dead) return 'your choice needs exact tiles that are no longer available';
  if (b.distance < w.distance) {
    return `it is ${w.distance - b.distance} tile${w.distance - b.distance > 1 ? 's' : ''} closer to complete (${b.distance} away vs ${w.distance})`;
  }
  if (w.missingExact > b.missingExact) {
    return `it needs fewer exact pair/single tiles (${b.missingExact} vs ${w.missingExact}) — those cannot be filled with Jokers`;
  }
  if (w.scarceExact.length > b.scarceExact.length) {
    const s = w.scarceExact[0];
    return `your choice depends on ${kindNamePlural(s.kind, 2)}, with only about ${Math.round(s.live)} left unseen`;
  }
  const bl = card.lineById.get(b.variant.lineId)!;
  const wl = card.lineById.get(w.variant.lineId)!;
  if (wl.concealed && !bl.concealed) return 'it is an exposed hand, so you can call discards for pungs and kongs';
  if (b.missingFlexible > w.missingFlexible) {
    return 'more of its missing tiles sit in groups of three or more, where Jokers and calls help';
  }
  return 'its remaining tiles have more live copies';
}

/** Short observations about the rack's composition. */
export function rackObservations(rackIds: TileId[]): string[] {
  const c = countsFromIds(rackIds);
  const obs: string[] = [];
  const winds = KINDS.filter((k) => isWind(k) && c[KINDS.indexOf(k)] > 0);
  const windPairs = winds.filter((k) => c[KINDS.indexOf(k)] >= 2);
  if (winds.length >= 3 && windPairs.length === 0) {
    obs.push(
      `You have ${winds.length} different winds but no wind pair — several starting directions, but you are not especially close to a wind pung.`,
    );
  }
  const pairs = KINDS.filter((k) => k !== 'J' && c[KINDS.indexOf(k)] >= 2);
  if (pairs.length === 0) obs.push('No natural pairs yet: hands built on pungs and kongs (where Jokers help) are usually easier to reach than pair-heavy hands.');
  else if (pairs.length >= 3) obs.push(`You hold ${pairs.length} pairs or better (${pairs.slice(0, 3).map((k) => kindNamePlural(k, 2)).join(', ')}) — valuable anchors for pung/kong hands.`);
  const jokers = c[KINDS.indexOf('J')];
  if (jokers >= 2) obs.push(`${jokers} Jokers: favour hands with many pungs, kongs or quints where Jokers count.`);
  const flowers = c[KINDS.indexOf('F')];
  if (flowers >= 3) obs.push(`${flowers} Flowers — hands with a Flower pung or kong deserve a look.`);
  const bySuit: Record<Suit, number> = { B: 0, C: 0, D: 0 };
  for (let i = 0; i < NUM_KINDS; i++) {
    const s = suitOf(KINDS[i]);
    if (s) bySuit[s] += c[i];
  }
  const heavy = (Object.entries(bySuit) as [Suit, number][]).sort((a, b) => b[1] - a[1])[0];
  if (heavy[1] >= 7) obs.push(`${heavy[1]} of your tiles are ${SUIT_NAMES[heavy[0]]}s — one-suit hands become realistic.`);
  const dragons = KINDS.filter((k) => isDragon(k) && c[KINDS.indexOf(k)] > 0);
  if (dragons.length >= 2 && !obs.length) obs.push(`You hold ${dragons.length} different dragons; they pair naturally with matching suits on many lines.`);
  return obs;
}

function bestOf(an: DecisionAnalysis, basis: Basis): Candidate {
  return rankedBy(an, basis)[0];
}

export function decisionFeedback(card: LoadedCard, d: DecisionRecord, prev?: DecisionRecord, pass?: PassRecord): Feedback {
  const { grade } = d;
  const basis = grade.basis;
  const tone = toneFor(grade.credit);
  const headline = HEADLINES[tone][d.index % HEADLINES[tone].length];
  const summary: string[] = [];
  const details: string[] = [];
  const best = bestOf(d.analysis, basis);
  const first = grade.picks[0];

  if (first.key === best.key) {
    summary.push(`You spotted the strongest option: ${best.label} (${metricName(basis)} ${formatMetric(metricOf(best, basis), basis)}).`);
  } else if (first.candidate) {
    const why = explainDifference(card, best.best, first.candidate.best);
    summary.push(
      `${best.label} (${formatMetric(metricOf(best, basis), basis)}) was stronger than your first choice ${first.candidate.label} (${formatMetric(first.value, basis)}): ${why}.`,
    );
  }

  if (grade.overlooked.length && !(grade.overlooked.length === 1 && grade.overlooked[0].key === best.key && first.key !== best.key)) {
    const o = grade.overlooked.filter((c) => c.key !== best.key || first.key === best.key)[0];
    if (o) summary.push(`Worth a look: ${o.label} also ranked in the engine’s top three.`);
  }

  // What changed since the last decision.
  if (prev && pass) {
    summary.push(...changeNarrative(card, prev, d, pass).slice(0, 1));
    details.push(...changeNarrative(card, prev, d, pass).slice(1));
  }

  // Reasons for the best option.
  details.push(`${best.label}: ${describeNeeds(best.best)}.`);
  if (best.level !== 'variant') {
    details.push(`Strongest hand inside it: ${selectionLabel(card, { level: 'variant', id: best.best.variant.id })}.`);
  }
  if (best.level === 'category' && best.strongVariants > 1) {
    details.push(`${best.strongVariants} different hand variations in ${best.label} are close to its best — flexibility if the next pass disappoints.`);
  }
  details.push(...rackObservations(d.rack));

  // Flexibility.
  const yf = grade.yourFlexibility;
  if (yf.overlap > 0.6) {
    details.push(`Your three choices share most of their key tiles (overlap ${(yf.overlap * 100).toFixed(0)}%). Strong backups often use different tiles, so one bad pass doesn’t sink every plan.`);
  } else if (yf.overlap < 0.25 && grade.credit > 0.6) {
    details.push('Your three choices use quite different tiles — a well-diversified set of backup plans.');
  }
  if (basis === 'heuristic') {
    details.push('Graded with the heuristic opportunity score (a relative measure, not a probability).');
  }
  return { headline, tone, summary, details };
}

/** Explain how an exchange changed the leading candidates, attributing changes to tiles. */
export function changeNarrative(card: LoadedCard, prev: DecisionRecord, cur: DecisionRecord, pass: PassRecord): string[] {
  const out: string[] = [];
  const beforeKnow: PlayerKnowledge = { rack: countsFromIds(prev.rack), knownElsewhere: prev.knownElsewhere };
  const afterKnow: PlayerKnowledge = { rack: countsFromIds(cur.rack), knownElsewhere: cur.knownElsewhere };
  const before = analyzeRack(card, beforeKnow);
  const after = analyzeRack(card, afterKnow);

  const prevBestCat = before.ranked[0].variant.categoryId;
  const curBestCat = after.ranked[0].variant.categoryId;
  if (prevBestCat !== curBestCat) {
    const from = card.categoryById.get(prevBestCat)!.name;
    const to = card.categoryById.get(curBestCat)!.name;
    const pivoted = cur.picks[0] && cur.grade.picks[0].candidate?.best.variant.categoryId === curBestCat;
    out.push(
      `The exchange shifted the strongest opportunity from ${from} to ${to}${pivoted ? ' — and you pivoted with it. Good flexibility!' : '. A pivot was justified here.'}`,
    );
  }

  // Received tiles that most improved a leading line.
  const received = pass.received.map(kindOfTile);
  const recCounts = countsFromIds(pass.received);
  let bestGain: { line: string; gain: number; kinds: TileKind[] } | null = null;
  for (const [lineId, o] of after.bestByLine) {
    const gain = o.score - (before.bestByLine.get(lineId)?.score ?? 0);
    const used = received.filter((k) => o.variant.needNJ[KINDS.indexOf(k)] + o.variant.needJ[KINDS.indexOf(k)] > 0);
    if (used.length && gain > (bestGain?.gain ?? 3)) bestGain = { line: lineId, gain, kinds: [...new Set(used)] };
  }
  if (bestGain) {
    const tiles = bestGain.kinds
      .map((k) => {
        const total = afterKnow.rack[KINDS.indexOf(k)];
        const got = recCounts[KINDS.indexOf(k)];
        if (total >= 2 && got >= 1) return total === 2 ? `new pair of ${kindNamePlural(k, 2)}` : `new ${kindName(k)} (now ${total})`;
        return `new ${kindName(k)}`;
      })
      .join(' and ');
    const l = card.lineById.get(bestGain.line)!;
    out.push(`Your ${tiles} made ${l.categoryName} #${l.line} more attractive.`);
  }

  // Passed tiles that hurt candidates.
  const passedKinds = [...new Set(pass.passed.map(kindOfTile))];
  for (const k of passedKinds) {
    const ki = KINDS.indexOf(k);
    let hurt = 0;
    for (const [lineId, o] of before.bestByLine) {
      if (o.score < 15) continue;
      const needed = o.variant.needNJ[ki] + o.variant.needJ[ki] > 0;
      const afterScore = after.bestByLine.get(lineId)?.score ?? 0;
      if (needed && afterScore < o.score - 2) hurt++;
    }
    if (hurt >= 2) {
      out.push(`You passed a ${kindName(k)}, which reduced the prospects of ${hurt} candidate lines.`);
      break;
    }
  }

  const dq = pass.grade;
  out.push(
    `Pass decision quality: better than ${(dq.percentile * 100).toFixed(0)}% of the ${dq.optionsCount} possible passes. ` +
      `Actual outcome: best opportunity ${pass.outcome.before.toFixed(0)} → ${pass.outcome.after.toFixed(0)}` +
      (pass.outcome.after < pass.outcome.before && dq.credit > 0.7 ? ' (an unlucky draw, not a bad decision).' : '.'),
  );
  return out;
}

export interface ChangeRow {
  key: string;
  label: string;
  before: number;
  after: number;
}

/**
 * Before/after values for the leading candidates of the current decision, measured on the
 * previous and current racks with the same metric (heuristic, or simulation when available
 * for both).
 */
export function changeTable(card: LoadedCard, prev: DecisionRecord, cur: DecisionRecord): { rows: ChangeRow[]; basis: Basis } {
  const before = analyzeRack(card, { rack: countsFromIds(prev.rack), knownElsewhere: prev.knownElsewhere });
  const after = analyzeRack(card, { rack: countsFromIds(cur.rack), knownElsewhere: cur.knownElsewhere });
  const scoreFor = (a: typeof before, key: string): number => {
    const [level, ...rest] = key.split(':');
    const id = rest.join(':');
    if (level === 'category') return a.bestByCategory.get(id)?.score ?? 0;
    if (level === 'line') return a.bestByLine.get(id)?.score ?? 0;
    const v = card.variantById.get(id);
    return v ? a.all[v.index].score : 0;
  };
  const keys: string[] = [];
  for (const c of rankedBy(cur.analysis, 'heuristic').slice(0, 3)) keys.push(c.key);
  for (const p of cur.picks) if (!keys.includes(selectionKey(p))) keys.push(selectionKey(p));
  for (const p of prev.picks) {
    const k = selectionKey(p);
    if (p.level === cur.level && !keys.includes(k)) keys.push(k);
  }
  const rows = keys.slice(0, 6).map((key) => {
    const [level, ...rest] = key.split(':');
    return {
      key,
      label: selectionLabel(card, { level: level as 'category', id: rest.join(':') }),
      before: scoreFor(before, key),
      after: scoreFor(after, key),
    };
  });
  return { rows, basis: 'heuristic' };
}
