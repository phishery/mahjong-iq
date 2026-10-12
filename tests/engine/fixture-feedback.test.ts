import { describe, expect, it } from 'vitest';
import { attachSim, buildCandidates, rankedBy, simTargets } from '../../src/engine/analysis';
import { loadCard } from '../../src/engine/card/parser';
import { decisionFeedback, rackObservations } from '../../src/engine/feedback';
import { analyzeRack, knowledgeFromRack } from '../../src/engine/heuristic';
import { gradePass, evaluatePasses } from '../../src/engine/passes';
import { emptyProgress, recordRound, summarize, pickPracticeCategory } from '../../src/engine/progress';
import { buildReport } from '../../src/engine/report';
import { createRng } from '../../src/engine/rng';
import { simulate } from '../../src/engine/simulate';
import { countsFromKinds, emptyCounts, idsForKinds, KINDS, parseKinds } from '../../src/engine/tiles';
import { card, playRound } from './helpers';

const FIXTURE = 'F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B';

describe('regression fixture: F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B', () => {
  const kinds = parseKinds(FIXTURE);
  const rack = countsFromKinds(kinds);

  it('is a valid 13-tile rack within the set supply', () => {
    expect(kinds).toHaveLength(13);
    expect(() => idsForKinds(kinds)).not.toThrow();
  });

  it('contains no natural pairs', () => {
    expect(rack.every((c) => c <= 1)).toBe(true);
  });

  it('can be evaluated against the supplied card definition', () => {
    const a = analyzeRack(card, knowledgeFromRack(rack));
    expect(a.all).toHaveLength(card.variants.length);
    expect(a.bestByCategory.size).toBe(card.categories.length);
  });

  it('produces repeatable rankings under fixed simulation seeds', () => {
    const an = buildCandidates(card, knowledgeFromRack(rack), 'category');
    const run = () =>
      rankedBy(
        attachSim(an, simulate(card, { rack, knownElsewhere: emptyCounts(), targets: simTargets(card, an), draws: 20, trials: 400, seed: 2026, model: 'calls' })),
        'simulation',
      ).map((c) => [c.id, c.sim!.p]);
    expect(run()).toEqual(run());
  });

  it('does not hardcode a best category: ranking comes from evaluation and changes with the card', () => {
    const an = buildCandidates(card, knowledgeFromRack(rack), 'category');
    const top = an.candidates[0].id;
    // Remove every hand of the leading category: a different category must lead, and the
    // evaluator still works — nothing assumes Winds, Runs or 369 must win.
    const json = structuredClone(card.def);
    json.hands = json.hands.filter((h) => h.category !== top);
    json.categories = json.categories.filter((c) => c.id !== top);
    const reduced = loadCard(json);
    const an2 = buildCandidates(reduced, knowledgeFromRack(rack), 'category');
    expect(an2.candidates[0].id).not.toBe(top);
    expect(an2.candidates.length).toBe(card.categories.length - 1);
  });

  it('feedback observations describe the rack factually', () => {
    const obs = rackObservations(idsForKinds(kinds));
    expect(obs.join(' ')).toMatch(/3 different winds but no wind pair/);
    expect(obs.join(' ')).toMatch(/No natural pairs/);
  });
});

describe('pass evaluation', () => {
  it('prefers passing tiles none of the strong hands use', () => {
    // Strong Runs rack plus three stray winds: the best pass should be the winds.
    const kinds = parseKinds('1D 1D 2D 2D 2D 3D 3D 3D 4D 4D N E W');
    const know = knowledgeFromRack(countsFromKinds(kinds));
    const ev = evaluatePasses(card, know, 3);
    expect(ev.best.kinds.map((k) => KINDS[k]).sort()).toEqual(['E', 'N', 'W']);
    const good = gradePass(card, know, ev.best.kinds);
    const bad = gradePass(card, know, [KINDS.indexOf('2D'), KINDS.indexOf('3D'), KINDS.indexOf('1D')]);
    expect(good.credit).toBeGreaterThan(0.95);
    expect(bad.credit).toBeLessThan(good.credit);
  });

  it('never proposes passing a joker', () => {
    const know = knowledgeFromRack(countsFromKinds(parseKinds('J J 1B 2B 3B N E W S F RD GD 9C')));
    for (const o of evaluatePasses(card, know, 3).options) expect(o.kinds).not.toContain(KINDS.indexOf('J'));
  });
});

describe('feedback, report and progress', () => {
  it('produces feedback, a report and progress updates for a complete round', () => {
    const { final } = playRound({ mode: 'hybrid', length: 'full', seed: 8 });
    const fb = decisionFeedback(card, final.decisions[1], final.decisions[0], final.passes[0]);
    expect(fb.headline.length).toBeGreaterThan(0);
    expect(fb.summary.length).toBeGreaterThan(0);
    const report = buildReport(card, final);
    expect(report.score.total).toBeGreaterThanOrEqual(0);
    expect(report.score.total).toBeLessThanOrEqual(100);
    expect(report.timeline).toHaveLength(final.decisions.length);
    expect(report.lessons.length).toBeGreaterThanOrEqual(1);
    const p = recordRound(emptyProgress(), card, final);
    expect(p.rounds).toBe(1);
    expect(p.byMode['hybrid/full'].rounds).toBe(1);
    expect(summarize(p, card).rounds).toBe(1);
    expect(card.categoryById.has(pickPracticeCategory(p, card, createRng(1)))).toBe(true);
  });

  it('engine top-3 auto-play scores highly on strategy', () => {
    const { final } = playRound({ mode: 'beginner', length: 'first', seed: 12 });
    const report = buildReport(card, final);
    expect(report.score.strategy).toBeGreaterThan(65);
  });
});
