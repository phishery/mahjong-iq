import { describe, expect, it } from 'vitest';
import { buildCandidates } from '../../src/engine/analysis';
import {
  courtesyAgreement,
  executeCourtesy,
  executePass,
  FIRST_CHARLESTON,
  giverTo,
  ownTilesRequired,
  PassError,
  SECOND_CHARLESTON,
  secondCharlestonProceeds,
  targetOf,
  validatePass,
  type Racks,
} from '../../src/engine/charleston';
import {
  assertConservation,
  levelFor,
  playerKnowledge,
  startRound,
  submitPass,
  submitRanking,
} from '../../src/engine/game';
import { choosePass } from '../../src/engine/opponents';
import { createRng } from '../../src/engine/rng';
import { gradeRanking } from '../../src/engine/scoring';
import { idsForKinds, JOKER_INDEX, KIND_OF_ID, parseKinds } from '../../src/engine/tiles';
import { autoRank, card, firstPassable, playRound } from './helpers';

describe('Charleston rules', () => {
  it('uses the correct pass directions', () => {
    expect(FIRST_CHARLESTON.map((s) => s.direction)).toEqual(['right', 'across', 'left']);
    expect(SECOND_CHARLESTON.map((s) => s.direction)).toEqual(['left', 'across', 'right']);
    expect(targetOf('you', 'right')).toBe('right');
    expect(targetOf('you', 'left')).toBe('left');
    expect(targetOf('right', 'right')).toBe('across');
    expect(targetOf('left', 'right')).toBe('you');
    // When you pass right, you receive from your left.
    expect(giverTo('you', 'right')).toBe('left');
    expect(giverTo('you', 'left')).toBe('right');
    expect(giverTo('you', 'across')).toBe('across');
  });

  it('allows blind passes only on the first left and last right', () => {
    expect(FIRST_CHARLESTON.map((s) => s.blindAllowed)).toEqual([false, false, true]);
    expect(SECOND_CHARLESTON.map((s) => s.blindAllowed)).toEqual([false, false, true]);
    expect(() => ownTilesRequired(FIRST_CHARLESTON[0], 1)).toThrow(PassError);
    expect(ownTilesRequired(FIRST_CHARLESTON[2], 2)).toBe(1);
    expect(ownTilesRequired(FIRST_CHARLESTON[2], 3)).toBe(0);
  });

  it('rejects joker passes, wrong counts, and tiles not owned', () => {
    const rack = idsForKinds(parseKinds('J 1B 2B 3B 4B'));
    expect(() => validatePass(rack, [rack[0], rack[1], rack[2]], 3)).toThrow(/Jokers/);
    expect(() => validatePass(rack, [rack[1], rack[2]], 3)).toThrow(/exactly 3/);
    expect(() => validatePass(rack, [rack[1], rack[2], 151], 3)).toThrow(/own rack/);
    expect(() => validatePass(rack, [rack[1], rack[1], rack[2]], 3)).toThrow(/twice/);
    expect(() => validatePass(rack, [rack[1], rack[2], rack[3]], 3)).not.toThrow();
  });

  it('allows flowers to be passed', () => {
    const rack = idsForKinds(parseKinds('F F F 1B'));
    expect(() => validatePass(rack, rack.slice(0, 3), 3)).not.toThrow();
  });

  it('courtesy pass uses the lower requested number (0–3)', () => {
    expect(courtesyAgreement(3, 1)).toBe(1);
    expect(courtesyAgreement(0, 3)).toBe(0);
    expect(courtesyAgreement(5, 2)).toBe(2);
  });

  it('any single player can stop the second Charleston', () => {
    expect(secondCharlestonProceeds({ you: true, right: true, across: true, left: true })).toBe(true);
    expect(secondCharlestonProceeds({ you: true, right: true, across: false, left: true })).toBe(false);
  });

  function sampleRacks(): Racks {
    const s = startRound(card, { mode: 'beginner', length: 'full', seed: 9, opponents: 'competent', courtesy: true });
    return s.racks;
  }

  it('conserves tiles in a pass, including a blind pass', () => {
    const racks = sampleRacks();
    const pick = (ids: number[], n: number) => ids.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX).slice(0, n);
    const chosen = { you: pick(racks.you, 1), right: pick(racks.right, 3), across: pick(racks.across, 3), left: pick(racks.left, 3) };
    // First left: you receive from right; forward two of them blind.
    const forward = chosen.right.slice(0, 2);
    const res = executePass(racks, chosen, 'left', forward);
    const before = Object.values(racks).flat().sort();
    const after = Object.values(res.racks).flat().sort();
    expect(after).toEqual(before);
    expect(res.racks.you).toHaveLength(13);
    expect(res.received.you).toEqual([chosen.right[2]]);
    expect(res.received.left).toEqual([...chosen.you, ...forward]);
  });

  it('conserves tiles in a courtesy exchange', () => {
    const racks = sampleRacks();
    const pick = (ids: number[], n: number) => ids.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX).slice(0, n);
    const res = executeCourtesy(racks, { you: pick(racks.you, 2), across: pick(racks.across, 2), right: pick(racks.right, 1), left: pick(racks.left, 1) });
    expect(Object.values(res.racks).flat().sort()).toEqual(Object.values(racks).flat().sort());
    expect(() => executeCourtesy(racks, { you: pick(racks.you, 2), across: pick(racks.across, 1), right: [], left: [] })).toThrow();
  });

  it('opponents never pass jokers', () => {
    const rack = idsForKinds(parseKinds('J J J J 1B 2C 3D N E W S F RD'));
    for (let s = 0; s < 30; s++) {
      for (const profile of ['casual', 'competent', 'random'] as const) {
        const ids = choosePass(card, { rack, passedAway: [] }, 3, profile, createRng(s));
        expect(ids).toHaveLength(3);
        expect(ids.every((id) => KIND_OF_ID[id] !== JOKER_INDEX)).toBe(true);
      }
    }
  });
});

describe('round state machine', () => {
  it('deals legal racks: 13 for the player, 14 for the dealer, 152 tiles in total', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = startRound(card, { mode: 'hybrid', length: 'full', seed, opponents: 'casual', courtesy: true });
      expect(s.racks.you).toHaveLength(13);
      expect(s.dealer).not.toBe('you');
      expect(s.racks[s.dealer]).toHaveLength(14);
      expect(() => assertConservation(s)).not.toThrow();
    }
  });

  it('is reproducible from a seed', () => {
    const a = playRound({ seed: 77 });
    const b = playRound({ seed: 77 });
    expect(a.final.racks).toEqual(b.final.racks);
    expect(a.final.passes.map((p) => p.received)).toEqual(b.final.passes.map((p) => p.received));
  });

  it('conserves every tile through a full round with blind passes and courtesy', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const opponents of ['casual', 'competent', 'random'] as const) {
        const { states, final } = playRound({ seed, opponents }, { blind: 2, continueSecond: true, courtesy: 3 });
        for (const s of states) expect(() => assertConservation(s)).not.toThrow();
        expect(final.phase).toBe('done');
      }
    }
  });

  it('requires a fresh ranking after every exchange', () => {
    let s = startRound(card, { mode: 'beginner', length: 'first', seed: 3, opponents: 'competent', courtesy: false });
    expect(s.phase).toBe('rank');
    expect(() => submitPass(card, s, firstPassable(s, 3))).toThrow(/Cannot pass/);
    s = autoRank(s);
    expect(s.phase).toBe('pass');
    s = submitPass(card, s, firstPassable(s, 3));
    expect(s.phase).toBe('rank');
    // A second pass without re-ranking is impossible.
    expect(() => submitPass(card, s, firstPassable(s, 3))).toThrow(/Cannot pass/);
    s = autoRank(s);
    expect(s.decisions).toHaveLength(2);
  });

  it('records one decision per rack state: deal + each exchange', () => {
    const { final } = playRound({ length: 'first' });
    expect(final.passes).toHaveLength(3);
    expect(final.decisions).toHaveLength(4);
    expect(final.decisions.map((d) => d.stepLabel)).toEqual([
      'Opening rack',
      'After First Right',
      'After First Across',
      'After First Left',
    ]);
  });

  it('hybrid mode moves from categories to lines to exact hands', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => levelFor('hybrid', i))).toEqual([
      'category',
      'category',
      'line',
      'variant',
      'variant',
      'variant',
    ]);
    const { final } = playRound({ mode: 'hybrid', length: 'first' });
    expect(final.decisions.map((d) => d.level)).toEqual(['category', 'category', 'line', 'variant']);
    expect(levelFor('beginner', 5)).toBe('category');
    expect(levelFor('advanced', 0)).toBe('variant');
  });

  it('rejects rankings at the wrong level', () => {
    const s = startRound(card, { mode: 'hybrid', length: 'first', seed: 3, opponents: 'competent', courtesy: false });
    const an = buildCandidates(card, playerKnowledge(s), 'line');
    const picks = an.candidates.slice(0, 3).map((c) => ({ level: c.level, id: c.id }));
    expect(() => submitRanking(s, picks, an, gradeRanking(an, picks, 'heuristic'))).toThrow(/category/);
  });

  it('opening-only rounds end after one decision', () => {
    const { final } = playRound({ length: 'opening' });
    expect(final.decisions).toHaveLength(1);
    expect(final.passes).toHaveLength(0);
  });

  it('stopping the second Charleston skips straight to the courtesy pass', () => {
    const { final } = playRound({ length: 'full' }, { continueSecond: false, courtesy: 0 });
    expect(final.secondCharleston).toBe('no');
    expect(final.passes).toHaveLength(3);
    expect(final.courtesy.status).toBe('done');
  });

  it('hidden information: player analysis depends only on what the player knows', () => {
    const s = startRound(card, { mode: 'beginner', length: 'first', seed: 11, opponents: 'competent', courtesy: false });
    const swapped = { ...s, racks: { ...s.racks, right: s.racks.across, across: s.racks.right } };
    const a = buildCandidates(card, playerKnowledge(s), 'category').candidates.map((c) => [c.id, c.heuristic]);
    const b = buildCandidates(card, playerKnowledge(swapped), 'category').candidates.map((c) => [c.id, c.heuristic]);
    expect(a).toEqual(b);
    // Knowledge contains exactly the player's rack and nothing about opponents.
    expect(Object.keys(playerKnowledge(s)).sort()).toEqual(['knownElsewhere', 'rack']);
  });

  it('known-elsewhere tiles are exactly the tiles the player passed and did not get back', () => {
    let s = startRound(card, { mode: 'beginner', length: 'first', seed: 5, opponents: 'competent', courtesy: false });
    s = autoRank(s);
    const passed = firstPassable(s, 3);
    s = submitPass(card, s, passed);
    const know = playerKnowledge(s);
    const awayCount = know.knownElsewhere.reduce((a, b) => a + b, 0);
    const returned = passed.filter((id) => s.racks.you.includes(id)).length;
    expect(awayCount).toBe(3 - returned);
  });

  it('targeted practice selects a deal whose strongest category is the target, and flags it', () => {
    const s = startRound(card, { mode: 'beginner', length: 'opening', seed: 21, opponents: 'competent', courtesy: false, targetCategories: ['winds'] });
    expect(s.selectedDeal).toBe(true);
    const top = buildCandidates(card, playerKnowledge(s), 'category').candidates[0];
    expect(top.id).toBe('winds');
  });
});
