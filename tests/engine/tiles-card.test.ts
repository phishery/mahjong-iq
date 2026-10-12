import { describe, expect, it } from 'vitest';
import { expandLine, loadCard, parseGroup, parsePattern, validateCard } from '../../src/engine/card/parser';
import { DEMO_CARD_JSON } from '../../src/engine/cards';
import {
  allTileIds,
  countsFromIds,
  isDragon,
  isSuited,
  isWind,
  KINDS,
  SUPPLY,
  TOTAL_TILES,
} from '../../src/engine/tiles';
import { card } from './helpers';

describe('tile set', () => {
  it('has exactly 152 tiles with the standard composition', () => {
    expect(TOTAL_TILES).toBe(152);
    const c = countsFromIds(allTileIds());
    let suited = 0;
    let winds = 0;
    let dragons = 0;
    KINDS.forEach((k, i) => {
      if (isSuited(k)) suited += c[i];
      if (isWind(k)) winds += c[i];
      if (isDragon(k)) dragons += c[i];
    });
    expect(suited).toBe(108);
    expect(winds).toBe(16);
    expect(dragons).toBe(12);
    expect(c[KINDS.indexOf('F')]).toBe(8);
    expect(c[KINDS.indexOf('J')]).toBe(8);
    expect(SUPPLY.every((s, i) => c[i] === s)).toBe(true);
  });
});

describe('card pattern parser', () => {
  it('parses groups with variables, offsets and suit variables', () => {
    expect(parseGroup('4x+1:A')).toMatchObject({ count: 4, suitVar: 'A', expr: { t: 'num', varName: 'x', offset: 1 } });
    expect(parseGroup('2F')).toMatchObject({ count: 2, suitVar: null, expr: { t: 'lit', kind: 'F' } });
    expect(parseGroup('3D:B')).toMatchObject({ count: 3, suitVar: 'B', expr: { t: 'dragon' } });
    expect(parseGroup('10')).toMatchObject({ count: 1, expr: { t: 'lit', kind: 'WD' } });
    expect(parseGroup('1W')).toMatchObject({ count: 1, expr: { t: 'lit', kind: 'W' } });
  });

  it('rejects malformed groups', () => {
    expect(() => parseGroup('4x')).toThrow(/suit variable/);
    expect(() => parseGroup('2N:A')).toThrow(/fixed tile/);
    expect(() => parseGroup('7F')).toThrow();
    expect(() => parseGroup('2Q')).toThrow();
  });

  it('expands suit and number variables into distinct concrete variants', () => {
    const def = { id: 'T', category: 'run', line: 1, pattern: '2F 4x:A 4x+1:A 4x+2:A', concealed: false };
    const vs = expandLine(def, parsePattern(def.pattern), 'Runs');
    // x ∈ 1..7, one suit variable → 7 × 3 variants
    expect(vs).toHaveLength(21);
    const v = vs.find((v) => v.nums.x === 3 && v.suits.A === 'D')!;
    expect(v.groups.map((g) => `${g.count}${g.kind}`)).toEqual(['2F', '43D', '44D', '45D']);
  });

  it('maps "D" to the dragon matching the suit (Bam→Green, Crak→Red, Dot→White)', () => {
    const def = { id: 'T', category: 'x', line: 1, pattern: '2F 4D:A 4D:B 4D:C', concealed: false };
    const vs = expandLine(def, parsePattern(def.pattern), '');
    // All suit permutations give the same concrete hand → de-duplicated to one variant.
    expect(vs).toHaveLength(1);
    expect(vs[0].groups.map((g) => g.kind).sort()).toEqual(['F', 'GD', 'RD', 'WD']);
  });

  it('honours explicit variable domains', () => {
    const def = { id: 'T', category: 'x', line: 1, pattern: '2F 4x:A 4x+2:B 4x+4:C', concealed: false, vars: { x: [1, 3, 5] } };
    const vs = expandLine(def, parsePattern(def.pattern), '');
    expect(new Set(vs.map((v) => v.nums.x))).toEqual(new Set([1, 3, 5]));
    expect(vs).toHaveLength(18);
  });

  it('expands "-or-" alternatives and de-duplicates hands shared between them', () => {
    const raw = structuredClone(DEMO_CARD_JSON) as { hands: Record<string, unknown>[] };
    raw.hands = [
      { id: 'ALT', category: 'run', line: 1, pattern: ['2F 4x:A 4x+1:A 4x+2:A', '2F 4x:A 4x+1:B 4x+2:C'], concealed: false },
      { id: 'DUP', category: 'run', line: 2, pattern: ['4N 3E 3W 4S', '4N 3E 3W 4S'], concealed: false },
    ];
    const c = loadCard(raw);
    const alt = c.lineById.get('ALT')!;
    expect(alt.alternatives).toHaveLength(2);
    expect(alt.variants.filter((v) => v.alt === 0)).toHaveLength(21); // 7 starts × 3 suits
    expect(alt.variants.filter((v) => v.alt === 1)).toHaveLength(42); // 7 starts × 6 suit orders
    expect(new Set(alt.variants.map((v) => v.id)).size).toBe(alt.variants.length);
    expect(c.lineById.get('DUP')!.variants).toHaveLength(1);
  });

  it('marks only groups of 3+ as joker-eligible', () => {
    const v = card.lineById.get('RN-1')!.variants[0];
    expect(v.groups.map((g) => [g.count, g.jokerable])).toEqual([
      [2, false],
      [3, true],
      [4, true],
      [3, true],
      [2, false],
    ]);
  });
});

describe('card validation', () => {
  it('accepts the demo card and marks it as non-official', () => {
    const r = validateCard(DEMO_CARD_JSON);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(card.def.source.official).toBe(false);
    expect(card.def.source.kind).toBe('demo');
    expect(card.def.source.attribution).toMatch(/Not an official/);
  });

  it('every demo variant has exactly 14 tiles', () => {
    for (const v of card.variants) expect(v.groups.reduce((a, g) => a + g.count, 0)).toBe(14);
  });

  it('rejects hands with the wrong tile count, impossible pairs, unknown categories', () => {
    const base = structuredClone(DEMO_CARD_JSON) as { hands: Record<string, unknown>[] };
    base.hands = [
      { id: 'A', category: 'run', line: 1, pattern: '2F 4x:A 4x+1:A', concealed: false },
      { id: 'B', category: 'nope', line: 1, pattern: '2F 4x:A 4x+1:A 4x+2:A', concealed: false },
      { id: 'C', category: 'run', line: 2, pattern: '5F 5F 4N', concealed: false },
    ];
    const r = validateCard(base);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/A.*10 tiles/);
    expect(r.errors.join('\n')).toMatch(/unknown category "nope"/);
  });

  it('rejects singles/pairs that exceed the supply (cannot be filled with jokers)', () => {
    const bad = structuredClone(DEMO_CARD_JSON) as { hands: Record<string, unknown>[] };
    bad.hands = [{ id: 'P', category: 'run', line: 1, pattern: '2N 2N 2N 2E 3W 3S', concealed: false }];
    const r = validateCard(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/non-joker copies/);
  });

  it('refuses a demo card that claims to be official', () => {
    const bad = structuredClone(DEMO_CARD_JSON) as { source: { official: boolean } };
    bad.source.official = true;
    expect(validateCard(bad).errors).toContain('A demo card cannot be marked official');
  });

  it('loadCard throws with all validation errors', () => {
    expect(() => loadCard({ schemaVersion: 1 })).toThrow(/Invalid card definition/);
  });
});
