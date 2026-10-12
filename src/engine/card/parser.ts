/**
 * Card-pattern parser, variant expander and validator.
 * See schema.ts for the pattern DSL.
 */

import { z } from 'zod';
import {
  DRAGON_OF_SUIT,
  KIND_INDEX,
  NUM_KINDS,
  SUIT_NAMES,
  SUITS,
  SUPPLY,
  type Suit,
  type TileKind,
} from '../tiles';
import type {
  CardDefinition,
  ConcreteGroup,
  HandLine,
  HandLineDef,
  HandVariant,
  LoadedCard,
  PatternGroup,
  SuitVar,
  TileExpr,
} from './schema';

export const HAND_SIZE = 14;
const MAX_GROUP = 6;
const TOTAL_JOKERS = 8;

const GROUP_RE = /^([1-6])(x|y|z)?([+-]\d)?([1-9]|GD|RD|WD|D|N|E|W|S|F|0)?(?::([ABC]))?$/;

export class PatternError extends Error {}

/** Parse one group token such as "4x+1:A", "2F", "3D:B", "1N". */
export function parseGroup(token: string): PatternGroup {
  const m = GROUP_RE.exec(token);
  if (!m) throw new PatternError(`Cannot parse group "${token}"`);
  const [, countStr, varName, offsetStr, tileStr, suitVarStr] = m;
  const count = Number(countStr);
  const suitVar = (suitVarStr as SuitVar | undefined) ?? null;
  let expr: TileExpr;
  if (varName) {
    if (tileStr) throw new PatternError(`Group "${token}" mixes a variable and a tile`);
    expr = { t: 'num', abs: null, varName, offset: offsetStr ? Number(offsetStr) : 0 };
  } else {
    if (offsetStr) throw new PatternError(`Offset without variable in "${token}"`);
    if (!tileStr) throw new PatternError(`Group "${token}" has no tile`);
    if (/^[1-9]$/.test(tileStr)) expr = { t: 'num', abs: Number(tileStr), varName: null, offset: 0 };
    else if (tileStr === 'D') expr = { t: 'dragon' };
    else if (tileStr === '0') expr = { t: 'lit', kind: 'WD' };
    else expr = { t: 'lit', kind: tileStr as TileKind };
  }
  if ((expr.t === 'num' || expr.t === 'dragon') && !suitVar) {
    throw new PatternError(`Group "${token}" needs a suit variable (e.g. ":A")`);
  }
  if (expr.t === 'lit' && suitVar) {
    throw new PatternError(`Group "${token}" is a fixed tile and cannot take a suit variable`);
  }
  return { count, expr, suitVar, raw: token };
}

export function parsePattern(pattern: string): PatternGroup[] {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new PatternError('Empty pattern');
  return tokens.map(parseGroup);
}

function permutations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((it, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const p of permutations(rest, k - 1)) out.push([it, ...p]);
  });
  return out;
}

function cartesian(domains: number[][]): number[][] {
  return domains.reduce<number[][]>(
    (acc, d) => acc.flatMap((a) => d.map((v) => [...a, v])),
    [[]],
  );
}

/** Default domain for a number variable: values keeping every offset tile within 1–9. */
function defaultDomain(groups: PatternGroup[], v: string): number[] {
  const offsets = groups
    .filter((g) => g.expr.t === 'num' && g.expr.varName === v)
    .map((g) => (g.expr as { offset: number }).offset);
  const out: number[] = [];
  for (let x = 1; x <= 9; x++) if (offsets.every((o) => x + o >= 1 && x + o <= 9)) out.push(x);
  return out;
}

function resolveKind(g: PatternGroup, suits: Partial<Record<SuitVar, Suit>>, nums: Record<string, number>): TileKind {
  const e = g.expr;
  if (e.t === 'lit') return e.kind;
  const suit = suits[g.suitVar as SuitVar] as Suit;
  if (e.t === 'dragon') return DRAGON_OF_SUIT[suit];
  const n = e.abs ?? nums[e.varName as string] + e.offset;
  if (n < 1 || n > 9) throw new PatternError(`Group "${g.raw}" resolves to out-of-range number ${n}`);
  return `${n}${suit}` as TileKind;
}

/** Signature used to de-duplicate variants that produce the same concrete hand. */
function concreteSignature(groups: ConcreteGroup[]): string {
  return groups
    .map((g) => `${g.count}${g.kind}${g.jokerable ? 'j' : ''}`)
    .sort()
    .join(' ');
}

export function expandLine(def: HandLineDef, groups: PatternGroup[], categoryName: string): HandVariant[] {
  const suitVars = [...new Set(groups.map((g) => g.suitVar).filter((s): s is SuitVar => !!s))].sort();
  const numVars = [
    ...new Set(groups.flatMap((g) => (g.expr.t === 'num' && g.expr.varName ? [g.expr.varName] : []))),
  ].sort();
  const domains = numVars.map((v) => def.vars?.[v] ?? defaultDomain(groups, v));
  const distinct = def.distinctVars ?? true;
  const noJokers = def.jokers === 'none';

  const seen = new Set<string>();
  const variants: HandVariant[] = [];
  for (const perm of permutations(SUITS, suitVars.length)) {
    const suits: Partial<Record<SuitVar, Suit>> = {};
    suitVars.forEach((sv, i) => (suits[sv] = perm[i]));
    for (const combo of cartesian(domains)) {
      if (distinct && new Set(combo).size !== combo.length) continue;
      const nums: Record<string, number> = {};
      numVars.forEach((v, i) => (nums[v] = combo[i]));
      let concrete: ConcreteGroup[];
      try {
        concrete = groups.map((g) => ({
          kind: resolveKind(g, suits, nums),
          count: g.count,
          jokerable: !noJokers && g.count >= 3,
        }));
      } catch {
        continue; // out-of-range explicit domain values are skipped (and flagged by validation)
      }
      const sig = concreteSignature(concrete);
      if (seen.has(sig)) continue;
      seen.add(sig);

      const needNJ = new Int8Array(NUM_KINDS);
      const needJ = new Int8Array(NUM_KINDS);
      for (const g of concrete) {
        const ki = KIND_INDEX[g.kind];
        if (g.jokerable) needJ[ki] += g.count;
        else needNJ[ki] += g.count;
      }
      const kinds: number[] = [];
      for (let i = 0; i < NUM_KINDS; i++) if (needNJ[i] || needJ[i]) kinds.push(i);

      const parts = [
        ...numVars.map((v) => `${v}=${nums[v]}`),
        ...suitVars.map((sv) => `${sv}=${SUIT_NAMES[suits[sv] as Suit]}`),
      ];
      variants.push({
        id: `${def.id}|${parts.join('|') || 'fixed'}`,
        index: -1,
        lineId: def.id,
        categoryId: def.category,
        groups: concrete,
        suits,
        nums,
        configLabel: parts.join(', ').replace(/=/g, ' = ') || 'Fixed tiles',
        needNJ,
        needJ,
        kinds: Int16Array.from(kinds),
      });
    }
  }
  void categoryName;
  return variants;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CardShape = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  year: z.number().int(),
  title: z.string().min(1),
  source: z.object({
    kind: z.enum(['demo', 'licensed', 'user-supplied']),
    attribution: z.string().min(1),
    official: z.boolean(),
    notes: z.string().optional(),
  }),
  categories: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().optional() }))
    .min(1),
  hands: z
    .array(
      z.object({
        id: z.string().min(1),
        category: z.string().min(1),
        line: z.number().int().positive(),
        pattern: z.string().min(1),
        concealed: z.boolean(),
        value: z.number().optional(),
        description: z.string().optional(),
        vars: z.record(z.string(), z.array(z.number().int())).optional(),
        distinctVars: z.boolean().optional(),
        jokers: z.enum(['standard', 'none']).optional(),
      }),
    )
    .min(1),
});

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  variantCount: number;
}

export function validateVariant(v: HandVariant): string[] {
  const errs: string[] = [];
  const total = v.groups.reduce((a, g) => a + g.count, 0);
  if (total !== HAND_SIZE) errs.push(`${v.id}: hand has ${total} tiles, expected ${HAND_SIZE}`);
  for (const g of v.groups) {
    if (g.count < 1 || g.count > MAX_GROUP) errs.push(`${v.id}: illegal group size ${g.count}`);
  }
  let jokersRequired = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    const supply = SUPPLY[k];
    if (v.needNJ[k] > supply) {
      errs.push(`${v.id}: needs ${v.needNJ[k]} non-joker copies of a tile that only has ${supply}`);
    }
    const over = v.needNJ[k] + v.needJ[k] - supply;
    if (over > 0) {
      if (v.needJ[k] < over) errs.push(`${v.id}: impossible tile count for kind #${k}`);
      jokersRequired += over;
    }
  }
  if (jokersRequired > TOTAL_JOKERS) errs.push(`${v.id}: requires ${jokersRequired} jokers, only 8 exist`);
  if (v.needJ[KIND_INDEX.J] || v.needNJ[KIND_INDEX.J]) errs.push(`${v.id}: jokers cannot be a required tile`);
  return errs;
}

export function validateCard(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shape = CardShape.safeParse(raw);
  if (!shape.success) {
    return {
      ok: false,
      errors: shape.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      warnings,
      variantCount: 0,
    };
  }
  const def = shape.data as CardDefinition;
  const catIds = new Set<string>();
  for (const c of def.categories) {
    if (catIds.has(c.id)) errors.push(`Duplicate category id "${c.id}"`);
    catIds.add(c.id);
  }
  const handIds = new Set<string>();
  const lineKeys = new Set<string>();
  let variantCount = 0;
  for (const h of def.hands) {
    if (handIds.has(h.id)) errors.push(`Duplicate hand id "${h.id}"`);
    handIds.add(h.id);
    if (!catIds.has(h.category)) errors.push(`${h.id}: unknown category "${h.category}"`);
    const lk = `${h.category}#${h.line}`;
    if (lineKeys.has(lk)) warnings.push(`${h.id}: line number ${h.line} repeated in category "${h.category}"`);
    lineKeys.add(lk);
    let groups: PatternGroup[];
    try {
      groups = parsePattern(h.pattern);
    } catch (e) {
      errors.push(`${h.id}: ${(e as Error).message}`);
      continue;
    }
    const usedVars = new Set(groups.flatMap((g) => (g.expr.t === 'num' && g.expr.varName ? [g.expr.varName] : [])));
    for (const [v, dom] of Object.entries(h.vars ?? {})) {
      if (!usedVars.has(v)) warnings.push(`${h.id}: variable "${v}" has a domain but is not used`);
      for (const x of dom) {
        const bad = groups.some(
          (g) => g.expr.t === 'num' && g.expr.varName === v && (x + g.expr.offset < 1 || x + g.expr.offset > 9),
        );
        if (bad) errors.push(`${h.id}: value ${v}=${x} puts a tile outside 1–9`);
      }
    }
    const variants = expandLine(h, groups, '');
    if (variants.length === 0) errors.push(`${h.id}: pattern has no legal variants`);
    for (const v of variants) errors.push(...validateVariant(v));
    variantCount += variants.length;
  }
  for (const c of def.categories) {
    if (!def.hands.some((h) => h.category === c.id)) warnings.push(`Category "${c.name}" has no hands`);
  }
  if (def.source.kind === 'demo' && def.source.official) {
    errors.push('A demo card cannot be marked official');
  }
  return { ok: errors.length === 0, errors, warnings, variantCount };
}

/** Validate and compile a card. Throws with all validation errors if invalid. */
export function loadCard(raw: unknown): LoadedCard {
  const res = validateCard(raw);
  if (!res.ok) throw new Error(`Invalid card definition:\n- ${res.errors.join('\n- ')}`);
  const def = raw as CardDefinition;
  const categoryById = new Map(def.categories.map((c) => [c.id, c]));
  const lines: HandLine[] = [];
  const variants: HandVariant[] = [];
  // Keep the card's category order, then line order.
  const catOrder = new Map(def.categories.map((c, i) => [c.id, i]));
  const sorted = [...def.hands].sort(
    (a, b) => (catOrder.get(a.category)! - catOrder.get(b.category)!) || a.line - b.line,
  );
  for (const h of sorted) {
    const groups = parsePattern(h.pattern);
    const categoryName = categoryById.get(h.category)!.name;
    const vs = expandLine(h, groups, categoryName);
    for (const v of vs) {
      v.index = variants.length;
      variants.push(v);
    }
    lines.push({ ...h, groups, variants: vs, categoryName });
  }
  return {
    def,
    categories: def.categories,
    lines,
    variants,
    lineById: new Map(lines.map((l) => [l.id, l])),
    variantById: new Map(variants.map((v) => [v.id, v])),
    categoryById,
  };
}

/** Display string for a pattern, e.g. "FF 1111 2222 3333" (variables shown as their minimum value). */
export function patternDisplayTokens(line: HandLine): { text: string; suitVar: SuitVar | null }[] {
  const domMin: Record<string, number> = {};
  for (const v of line.variants) for (const [k, n] of Object.entries(v.nums)) domMin[k] = Math.min(domMin[k] ?? 9, n);
  return line.groups.map((g) => {
    let sym: string;
    const e = g.expr;
    if (e.t === 'lit') sym = e.kind === 'WD' && g.raw.includes('0') ? '0' : e.kind === 'GD' ? 'G' : e.kind === 'RD' ? 'R' : e.kind === 'WD' ? 'Wh' : e.kind;
    else if (e.t === 'dragon') sym = 'D';
    else sym = String(e.abs ?? (domMin[e.varName!] ?? 1) + e.offset);
    // Multi-char symbols (Wh) are shown once with a count; single chars are repeated.
    const text = sym.length === 1 ? sym.repeat(g.count) : `${sym}×${g.count}`;
    return { text, suitVar: g.suitVar };
  });
}

/** Does any line in the card use number variables (i.e. "any consecutive numbers")? */
export function lineHasVariables(line: HandLine): boolean {
  return line.variants.length > 1;
}
