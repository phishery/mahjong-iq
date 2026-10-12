import { describe, expect, it } from 'vitest';
import { matchVariant, variantDistance } from '../../src/engine/evaluator';
import { analyzeRack, binomTail, evaluateOpportunity, knowledgeFromRack } from '../../src/engine/heuristic';
import { card, rackOf, variantByLabel } from './helpers';

// RN-1: 11 222 3333 444 55 (one suit)
const rn1Bam1 = () => variantByLabel('RN-1', { x: 1, A: 'B' });

describe('exact hand evaluator', () => {
  it('recognises a complete hand made of natural tiles', () => {
    const m = matchVariant(rackOf('1B 1B 2B 2B 2B 3B 3B 3B 3B 4B 4B 4B 5B 5B'), rn1Bam1());
    expect(m.complete).toBe(true);
    expect(m.distance).toBe(0);
  });

  it('allows jokers in pungs and kongs', () => {
    // Replace one tile of 222, one of 3333 and one of 444 with jokers.
    const m = matchVariant(rackOf('1B 1B 2B 2B J 3B 3B 3B J 4B 4B J 5B 5B'), rn1Bam1());
    expect(m.complete).toBe(true);
    expect(m.jokersUsed).toBe(3);
  });

  it('never allows jokers in pairs or singles', () => {
    // Joker standing in for the second 1B (a pair) is illegal.
    const m = matchVariant(rackOf('1B J 2B 2B 2B 3B 3B 3B 3B 4B 4B 4B 5B 5B'), rn1Bam1());
    expect(m.complete).toBe(false);
    expect(m.distance).toBe(1);
    expect(m.missingExact).toBe(1);
    expect(m.jokersUsed).toBe(0);
  });

  it('allows jokers in quints, and quints require them', () => {
    const v = variantByLabel('QT-1', { x: 1, A: 'C' }); // 11111 2222 33333
    const natural = matchVariant(rackOf('1C 1C 1C 1C 2C 2C 2C 2C 3C 3C 3C 3C 9D 9D'), v);
    expect(natural.complete).toBe(false);
    expect(natural.distance).toBe(2);
    const withJokers = matchVariant(rackOf('1C 1C 1C 1C J 2C 2C 2C 2C 3C 3C 3C 3C J'), v);
    expect(withJokers.complete).toBe(true);
  });

  it('applies suit/number transformations: the same rack fits only matching variants', () => {
    const rack = rackOf('3D 3D 4D 4D 4D 5D 5D 5D 5D 6D 6D 6D 7D 7D');
    const dots3 = variantByLabel('RN-1', { x: 3, A: 'D' });
    const bams3 = variantByLabel('RN-1', { x: 3, A: 'B' });
    const dots2 = variantByLabel('RN-1', { x: 2, A: 'D' });
    expect(variantDistance(rack, dots3)).toBe(0);
    expect(variantDistance(rack, bams3)).toBe(14);
    expect(variantDistance(rack, dots2)).toBeGreaterThan(0);
  });

  it('fills exact (pair) requirements before joker-eligible groups', () => {
    // EV-2: FF 2222 44 66 8888 — with 4D in both "44" (pair) and nothing else; a joker must not count for the pair.
    const v = variantByLabel('EV-2', { A: 'C', B: 'D' });
    const m = matchVariant(rackOf('F F 2C 2C 2C J 4D 6D 6D 8C 8C 8C J'), v);
    expect(m.groups.find((g) => g.kind === '4D')!.missing).toBe(1);
    expect(m.jokersUsed).toBe(2);
    expect(m.distance).toBe(1);
  });
});

describe('heuristic opportunity score', () => {
  it('is bounded 0–100 and labelled as a relative score (not a probability)', () => {
    const a = analyzeRack(card, knowledgeFromRack(rackOf('F N W S RD 1C 2C 5C 2D 4D 5D 9D 6B')));
    for (const o of a.all) {
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(100);
    }
  });

  it('values three copies of a pung tile above three different winds', () => {
    // WD-1: NNNN EEE WWW SSSS. Rack A holds N W S (one each); rack B holds NNN.
    const v = card.lineById.get('WD-1')!.variants[0];
    const spread = evaluateOpportunity(knowledgeFromRack(rackOf('N W S 1B 3B 5B 7C 9C 2D 4D 6D 8D 9B')), v, false);
    const pung = evaluateOpportunity(knowledgeFromRack(rackOf('N N N 1B 3B 5B 7C 9C 2D 4D 6D 8D 9B')), v, false);
    expect(pung.naturals).toBe(spread.naturals);
    expect(pung.score).toBeGreaterThan(spread.score);
  });

  it('treats an exact pair need as harder than the same number of joker-eligible needs', () => {
    // Same distance (1 tile away) — missing a pair tile vs missing a kong tile.
    const v = rn1Bam1();
    const missingPair = evaluateOpportunity(knowledgeFromRack(rackOf('1B 2B 2B 2B 3B 3B 3B 3B 4B 4B 4B 5B 5B')), v, false);
    const missingKong = evaluateOpportunity(knowledgeFromRack(rackOf('1B 1B 2B 2B 2B 3B 3B 3B 4B 4B 4B 5B 5B')), v, false);
    expect(missingPair.distance).toBe(missingKong.distance);
    expect(missingKong.score).toBeGreaterThan(missingPair.score);
  });

  it('marks a hand dead when an exact requirement has no live copies', () => {
    const v = rn1Bam1(); // needs a pair of 1 Bams
    const rack = rackOf('2B 2B 2B 3B 3B 3B 3B 4B 4B 4B 5B 5B 9D');
    // All four 1 Bams were passed away: they count only 25% live (1 effective copy) < 2 needed.
    const dead = evaluateOpportunity({ rack, knownElsewhere: rackOf('1B 1B 1B 1B') }, v, false);
    expect(dead.dead).toBe(true);
    expect(dead.score).toBe(0);
    const alive = evaluateOpportunity(knowledgeFromRack(rack), v, false);
    expect(alive.dead).toBe(false);
    expect(alive.score).toBeGreaterThan(0);
  });

  it('binomial tail helper matches simple cases', () => {
    expect(binomTail(10, 0.5, 0)).toBe(1);
    expect(binomTail(1, 0.3, 1)).toBeCloseTo(0.3);
    expect(binomTail(2, 0.5, 2)).toBeCloseTo(0.25);
    expect(binomTail(3, 0.5, 4)).toBe(0);
  });

  it('does not hardcode any category: rankings change when the rack changes', () => {
    const winds = analyzeRack(card, knowledgeFromRack(rackOf('N N N E E W W S S S F F 1B')));
    const runs = analyzeRack(card, knowledgeFromRack(rackOf('1D 1D 2D 2D 2D 3D 3D 3D 3D 4D 4D 4D 5D')));
    expect(winds.ranked[0].variant.categoryId).toBe('winds');
    expect(runs.ranked[0].variant.categoryId).toBe('run');
  });
});
