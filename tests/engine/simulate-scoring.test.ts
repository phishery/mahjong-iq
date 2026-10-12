import { describe, expect, it } from 'vitest';
import {
  attachSim,
  buildCandidates,
  chooseBasis,
  simTargets,
  type Candidate,
  type DecisionAnalysis,
} from '../../src/engine/analysis';
import { knowledgeFromRack } from '../../src/engine/heuristic';
import { buildUnknownPool, simulate, wilson } from '../../src/engine/simulate';
import { gradeRanking, roundScore } from '../../src/engine/scoring';
import { emptyCounts } from '../../src/engine/tiles';
import { card, rackOf, variantByLabel } from './helpers';

/** ln C(n, k) */
function lnC(n: number, k: number): number {
  let s = 0;
  for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
  return s;
}
/** P(at least one of K special tiles among the first n of N, without replacement). */
function atLeastOne(N: number, K: number, n: number): number {
  return 1 - Math.exp(lnC(N - K, n) - lnC(N, n));
}

describe('Monte Carlo engine — validation against exact combinatorics', () => {
  // RN-1 (11 222 3333 444 55 Bam) missing only the second 1 Bam (a pair: exact tile, no jokers).
  const rack = rackOf('1B 2B 2B 2B 3B 3B 3B 3B 4B 4B 4B 5B 5B');
  const v = variantByLabel('RN-1', { x: 1, A: 'B' });
  const pool = 152 - 13; // 3 live 1 Bams among 139 unknown tiles

  it('draw-only model matches the hypergeometric probability (one exact out)', () => {
    const [r] = simulate(card, { rack, knownElsewhere: emptyCounts(), targets: [{ key: 'a', variantIndices: [v.index] }], draws: 18, trials: 20000, seed: 3, model: 'draws' });
    const exact = atLeastOne(pool, 3, 18);
    expect(Math.abs(r.p - exact)).toBeLessThan(4 * Math.sqrt((exact * (1 - exact)) / 20000));
    expect(r.lo).toBeLessThanOrEqual(exact);
    expect(r.hi).toBeGreaterThanOrEqual(exact);
  });

  it('calls model: Mahjong may be called on any discard (4 looks per turn)', () => {
    const [r] = simulate(card, { rack, knownElsewhere: emptyCounts(), targets: [{ key: 'a', variantIndices: [v.index] }], draws: 10, trials: 20000, seed: 4, model: 'calls' });
    const exact = atLeastOne(pool, 3, 40);
    expect(Math.abs(r.p - exact)).toBeLessThan(4 * Math.sqrt((exact * (1 - exact)) / 20000));
  });

  it('jokers count as outs for a missing pung/kong tile', () => {
    // Missing one 3 Bam of the kong: outs = 1 live 3B + 8 jokers = 9.
    const r2 = rackOf('1B 1B 2B 2B 2B 3B 3B 3B 4B 4B 4B 5B 5B');
    const [r] = simulate(card, { rack: r2, knownElsewhere: emptyCounts(), targets: [{ key: 'a', variantIndices: [v.index] }], draws: 12, trials: 20000, seed: 5, model: 'draws' });
    const exact = atLeastOne(pool, 9, 12);
    expect(Math.abs(r.p - exact)).toBeLessThan(4 * Math.sqrt((exact * (1 - exact)) / 20000));
  });

  it('respects known-elsewhere tiles (sampling only from tiles the player could draw)', () => {
    const away = rackOf('1B 1B 1B');
    const [r] = simulate(card, { rack, knownElsewhere: away, targets: [{ key: 'a', variantIndices: [v.index] }], draws: 30, trials: 2000, seed: 6, model: 'draws' });
    expect(r.p).toBe(0);
    expect(buildUnknownPool(rack, away)).toHaveLength(152 - 13 - 3);
  });

  it('is reproducible with a fixed seed and differs with another seed', () => {
    const fx = rackOf('F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B');
    const targets = card.categories.map((c) => ({ key: c.id, variantIndices: card.variants.filter((v) => v.categoryId === c.id).map((v) => v.index) }));
    const a = simulate(card, { rack: fx, knownElsewhere: emptyCounts(), targets, draws: 20, trials: 300, seed: 99, model: 'calls' });
    const b = simulate(card, { rack: fx, knownElsewhere: emptyCounts(), targets, draws: 20, trials: 300, seed: 99, model: 'calls' });
    expect(a).toEqual(b);
  });

  it('uses common random numbers: a target’s result does not depend on what else is simulated', () => {
    const fx = rackOf('F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B');
    const t1 = { key: 'run', variantIndices: card.variants.filter((v) => v.categoryId === 'run').map((v) => v.index) };
    const t2 = { key: 'odd', variantIndices: card.variants.filter((v) => v.categoryId === 'odd').map((v) => v.index) };
    const alone = simulate(card, { rack: fx, knownElsewhere: emptyCounts(), targets: [t1], draws: 20, trials: 400, seed: 1, model: 'calls' });
    const both = simulate(card, { rack: fx, knownElsewhere: emptyCounts(), targets: [t2, t1], draws: 20, trials: 400, seed: 1, model: 'calls' });
    expect(both[1]).toEqual(alone[0]);
  });

  it('Wilson interval behaves sensibly', () => {
    const w = wilson(50, 100);
    expect(w.lo).toBeLessThan(0.5);
    expect(w.hi).toBeGreaterThan(0.5);
    expect(wilson(0, 100).lo).toBe(0);
    expect(wilson(0, 100).hi).toBeGreaterThan(0);
  });
});

describe('scoring', () => {
  function fakeAnalysis(values: number[]): DecisionAnalysis {
    const base = buildCandidates(card, knowledgeFromRack(rackOf('F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B')), 'category');
    const candidates: Candidate[] = base.candidates.slice(0, values.length).map((c, i) => ({
      ...c,
      sim: { key: c.key, successes: Math.round(values[i] * 10000), trials: 10000, p: values[i], lo: 0, hi: 1, meanTurnsToComplete: null },
    }));
    return { level: 'category', candidates, byKey: new Map(candidates.map((c) => [c.key, c])) };
  }

  it('gives full credit for the optimal ranking', () => {
    const an = fakeAnalysis([0.19, 0.15, 0.1, 0.04, 0.02]);
    const picks = an.candidates.slice(0, 3).map((c) => ({ level: c.level, id: c.id }));
    const g = gradeRanking(an, picks, 'simulation');
    expect(g.credit).toBeCloseTo(1);
    expect(g.recognized).toHaveLength(3);
    expect(g.overlooked).toHaveLength(0);
  });

  it('uses probability regret: 18% vs 19% earns far more than 4% vs 19%', () => {
    const an = fakeAnalysis([0.19, 0.18, 0.1, 0.04, 0.02]);
    const c = an.candidates;
    const near = gradeRanking(an, [c[1], c[0], c[2]].map((x) => ({ level: x.level, id: x.id })), 'simulation');
    const far = gradeRanking(an, [c[3], c[0], c[2]].map((x) => ({ level: x.level, id: x.id })), 'simulation');
    expect(near.picks[0].credit).toBeGreaterThan(0.9);
    expect(far.picks[0].credit).toBeLessThan(0.15);
    expect(near.credit).toBeGreaterThan(far.credit);
  });

  it('rewards correct prioritisation', () => {
    const an = fakeAnalysis([0.2, 0.1, 0.05]);
    const c = an.candidates.map((x) => ({ level: x.level, id: x.id }));
    expect(gradeRanking(an, [c[0], c[1], c[2]], 'simulation').orderCredit).toBe(1);
    expect(gradeRanking(an, [c[2], c[1], c[0]], 'simulation').orderCredit).toBe(0);
  });

  it('rejects duplicate selections', () => {
    const an = fakeAnalysis([0.2, 0.1, 0.05]);
    const c0 = { level: an.candidates[0].level, id: an.candidates[0].id };
    expect(() => gradeRanking(an, [c0, c0, c0], 'simulation')).toThrow(/distinct/);
  });

  it('only grades with simulation when every candidate is simulated with enough successes', () => {
    const an = buildCandidates(card, knowledgeFromRack(rackOf('F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B')), 'category');
    expect(chooseBasis(an)).toBe('heuristic');
    expect(chooseBasis(fakeAnalysis([0.2, 0.1, 0.05]))).toBe('simulation');
    expect(chooseBasis(fakeAnalysis([0.001, 0.0005]))).toBe('heuristic');
    const sim = simulate(card, { rack: rackOf('F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B'), knownElsewhere: emptyCounts(), targets: simTargets(card, an), draws: 20, trials: 100, seed: 1, model: 'calls' });
    expect(attachSim(an, sim).candidates.every((c) => c.sim)).toBe(true);
  });

  it('combines 70 strategy + 30 passing points', () => {
    const s = roundScore([1, 1, 1, 1], [1, 1, 1]);
    expect(s.total).toBe(100);
    const half = roundScore([0.5, 0.5], [1]);
    expect(half.strategy).toBeCloseTo(35);
    expect(half.passing).toBeCloseTo(30);
    expect(half.total).toBe(65);
    const opening = roundScore([0.8], []);
    expect(opening.total).toBe(80);
    expect(opening.passing).toBeNull();
  });
});
