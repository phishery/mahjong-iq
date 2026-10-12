/**
 * Declarative schema for annual NMJL-style card definitions.
 *
 * A card is stored as JSON. Each hand line is written in a compact pattern DSL so
 * a whole annual card can be entered by hand in an hour or two:
 *
 *   pattern  := group (" " group)*
 *   group    := COUNT TILE (":" SUITVAR)?
 *   COUNT    := 1–6           (1 single, 2 pair, 3 pung, 4 kong, 5 quint, 6 sextet)
 *   TILE     := 1–9           absolute number (needs a suit variable)
 *             | x | x+1 | y-2 number variable with offset (needs a suit variable)
 *             | D            dragon matching the group's suit variable
 *                            (Bam→Green, Crak→Red, Dot→White)
 *             | N | E | W | S | F
 *             | GD | RD | WD literal dragons
 *             | 0            White Dragon used as a zero ("Soap"), e.g. in year hands
 *   SUITVAR  := A | B | C     distinct suits by default (A≠B≠C)
 *
 * Examples:
 *   "2F 4x:A 4x+1:A 4x+2:A"   FF 1111 2222 3333 — any three consecutive kongs, one suit
 *   "1N 1E 1W 1S 3x:A 3x:B 4x:C" NEWS + like-number pungs/kong in three suits
 *
 * Joker eligibility follows standard NMJL practice: jokers may stand in for any tile of
 * a group of three or more identical tiles (pung, kong, quint, sextet) and never for a
 * single or a pair. A line can set `"jokers": "none"` to forbid jokers entirely.
 */

import type { Suit, TileKind } from '../tiles';

export type SuitVar = 'A' | 'B' | 'C';

export type CardSourceKind = 'demo' | 'licensed' | 'user-supplied';

export interface CardSource {
  kind: CardSourceKind;
  /** Human-readable attribution, shown in the UI next to every hand. */
  attribution: string;
  /** True only for a complete, legitimately supplied official card. Demo cards: false. */
  official: boolean;
  notes?: string;
}

export interface CardCategory {
  id: string;
  name: string;
  description?: string;
}

export interface HandLineDef {
  id: string;
  category: string;
  /** Line number within its category, as printed on the card. */
  line: number;
  pattern: string;
  concealed: boolean;
  value?: number;
  description?: string;
  /** Optional explicit domains for number variables. Default: every value keeping all tiles in 1–9. */
  vars?: Record<string, number[]>;
  /** If true (default), different number variables (x, y) must take different values. */
  distinctVars?: boolean;
  /** 'standard' (default): jokers allowed in groups of 3+. 'none': no jokers anywhere. */
  jokers?: 'standard' | 'none';
}

export interface CardDefinition {
  schemaVersion: 1;
  id: string;
  year: number;
  title: string;
  source: CardSource;
  categories: CardCategory[];
  hands: HandLineDef[];
}

// ---------------------------------------------------------------------------
// Parsed / compiled forms
// ---------------------------------------------------------------------------

export type TileExpr =
  | { t: 'num'; abs: number | null; varName: string | null; offset: number }
  | { t: 'dragon' }
  | { t: 'lit'; kind: TileKind };

export interface PatternGroup {
  count: number;
  expr: TileExpr;
  suitVar: SuitVar | null;
  raw: string;
}

export interface ConcreteGroup {
  kind: TileKind;
  count: number;
  jokerable: boolean;
}

export interface HandVariant {
  /** Globally unique id, e.g. "CR-3|x=2|A=B". */
  id: string;
  /** Dense index into the card's flat variant list (for fast lookups). */
  index: number;
  lineId: string;
  categoryId: string;
  groups: ConcreteGroup[];
  suits: Partial<Record<SuitVar, Suit>>;
  nums: Record<string, number>;
  /** Human readable configuration, e.g. "x=2, A=Bam". */
  configLabel: string;
  /** Required tiles that cannot use jokers, per kind index. */
  needNJ: Int8Array;
  /** Required tiles that can use jokers, per kind index. */
  needJ: Int8Array;
  /** Kind indices that this variant needs at all (sparse list for speed). */
  kinds: Int16Array;
}

export interface HandLine extends HandLineDef {
  groups: PatternGroup[];
  variants: HandVariant[];
  categoryName: string;
}

export interface LoadedCard {
  def: CardDefinition;
  categories: CardCategory[];
  lines: HandLine[];
  variants: HandVariant[];
  lineById: Map<string, HandLine>;
  variantById: Map<string, HandVariant>;
  categoryById: Map<string, CardCategory>;
}
