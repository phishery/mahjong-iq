import { describe, expect, it } from 'vitest';
import { cardDemand, discardWeights, measureDemand } from '../../src/engine/demand';
import { JOKER_INDEX, KIND_INDEX } from '../../src/engine/tiles';
import { card } from './helpers';

describe('tile demand', () => {
  const d = cardDemand(card);

  it('never discards Jokers and keeps Flowers far more than Winds', () => {
    expect(d.keep[JOKER_INDEX]).toBe(1);
    expect(discardWeights(d)[JOKER_INDEX]).toBe(0);
    for (const w of ['N', 'E', 'W', 'S'] as const) expect(d.keep[KIND_INDEX.F]).toBeGreaterThan(d.keep[KIND_INDEX[w]] + 0.3);
  });

  it('is suit-symmetric and bounded', () => {
    for (let r = 1; r <= 9; r++) {
      const b = d.keep[KIND_INDEX[`${r}B` as '1B']];
      expect(d.keep[KIND_INDEX[`${r}C` as '1C']]).toBe(b);
      expect(d.keep[KIND_INDEX[`${r}D` as '1D']]).toBe(b);
    }
    expect(d.keep[KIND_INDEX.GD]).toBe(d.keep[KIND_INDEX.RD]);
    for (const k of d.keep) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and cached', () => {
    expect(Array.from(measureDemand(card, 50).keep)).toEqual(Array.from(measureDemand(card, 50).keep));
    expect(cardDemand(card)).toBe(d);
  });
});
