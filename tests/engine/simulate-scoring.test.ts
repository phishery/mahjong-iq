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

  it('random-calls model: Mahjong may be called on any discard (4 looks per turn)', () => {
    const [r] = simulate(card, { rack, knownElsewhere: emptyCounts(), targets: [{ key: 'a', variantIndices: [v.index] }], draws: 10, trials: 20000, seed: 4, model: 'random-calls' });
    const exact = atLeastOne(pool, 3, 40);
    expect(Math.abs(r.p - exact)).toBeLessThan(4 * Math.sqrt((exact * (1 - exact)) / 20000));
  });

  it('calls model: opponents throw high-demand tiles (Flowers) less and low-demand tiles (Winds) more', () => {
    const run = (r: number[], vi: number, model: 'calls' | 'random-calls') =>
      simulate(card, { rack: r, knownElsewhere: emptyCounts(), targets: [{ key: 'a', variantIndices: [vi] }], draws: 10, trials: 20000, seed: 7, model })[0].p;
    // RN-3 (FF 1111 2222 3333) waiting on the second Flower of the pair.
    const flowerRack = rackOf('F 1B 1B 1B 1B 2B 2B 2B 2B 3B 3B 3B 3B');
    const flower = variantByLabel('RN-3', { x: 1, A: 'B' }).index;
    // LK-3 (N E W S 333 333 3333) waiting on the single North.
    const windRack = rackOf('E W S 3B 3B 3B 3C 3C 3C 3D 3D 3D 3D');
    const wind = card.lineById.get('LK-3')!.variants.find((v) => v.nums.x === 3 && v.suits.C === 'D')!.index;
    expect(run(flowerRack, flower, 'calls')).toBeLessThan(run(flowerRack, flower, 'random-calls') - 0.02);
    expect(run(windRack, wind, 'calls')).toBeGreaterThan(run(windRack, wind, 'random-calls') + 0.02);
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

  it('treats picks within the margin of error as ties', () => {
    // 10,000 trials each: 10.8% vs 10.6% is a tie; 10.6% vs 6.8% is not.
    const an = fakeAnalysis([0.237, 0.108, 0.106, 0.105, 0.068]);
    const c = an.candidates.map((x) => ({ level: x.level, id: x.id }));
    // Picking the 4th-by-point-estimate candidate (tied with #2 and #3) instead of #3.
    const g = gradeRanking(an, [c[0], c[1], c[3]], 'simulation');
    expect(g.picks[2].credit).toBe(1);
    expect(g.picks[2].rank).toBe(2);
    expect(g.picks[2].rankShared).toBe(true);
    expect(g.recognized).toHaveLength(3);
    expect(g.overlooked).toHaveLength(0);
    expect(g.credit).toBeCloseTo(1);
    // Swapping the order of two tied picks keeps full order credit.
    expect(gradeRanking(an, [c[0], c[2], c[1]], 'simulation').orderCredit).toBe(1);
    // A clearly weaker pick is not a tie.
    const weak = gradeRanking(an, [c[0], c[1], c[4]], 'simulation');
    expect(weak.picks[2].credit).toBeLessThan(1);
    expect(weak.picks[2].rank).toBe(5);
    expect(weak.overlooked.map((x) => x.key)).toEqual([an.candidates[2].key]);
    expect(weak.alsoTied.map((x) => x.key)).toEqual([an.candidates[3].key]);
  });

  it('does not call ties when the simulation is precise enough to separate them', () => {
    const base = fakeAnalysis([0.237, 0.108, 0.106]);
    const precise: DecisionAnalysis = {
      ...base,
      candidates: base.candidates.map((x) => ({ ...x, sim: { ...x.sim!, trials: 10_000_000, successes: Math.round(x.sim!.p * 1e7) } })),
    };
    precise.byKey = new Map(precise.candidates.map((x) => [x.key, x]));
    const c = precise.candidates.map((x) => ({ level: x.level, id: x.id }));
    const g = gradeRanking(precise, [c[0], c[2], c[1]], 'simulation');
    expect(g.picks[1].rankShared).toBe(false);
    expect(g.orderCredit).toBeLessThan(1);
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
