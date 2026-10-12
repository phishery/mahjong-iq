/**
 * Tile definitions for a standard 152-tile American Mahjong set.
 *
 *   108 suited tiles  (Bam, Crak, Dot × 1–9 × 4 copies)
 *    16 winds         (N, E, W, S × 4)
 *    12 dragons       (Red, Green, White/"Soap" × 4)
 *     8 flowers
 *     8 jokers
 *
 * Two representations are used throughout the engine:
 *  - A *kind* is the face of a tile ("5D", "N", "RD", "F", "J"). Kinds have a dense
 *    integer index (0–35) so that racks can be stored as fixed-size count vectors.
 *  - A *physical tile* has a unique id (0–151). Game state tracks physical ids so that
 *    tile conservation (never creating, duplicating or losing a tile) can be verified.
 */

export type Suit = 'B' | 'C' | 'D'; // Bam, Crak, Dot
export type Wind = 'N' | 'E' | 'W' | 'S';
export type Dragon = 'GD' | 'RD' | 'WD'; // Green (Bam), Red (Crak), White/Soap (Dot)

export type TileKind =
  | `${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}${Suit}`
  | Wind
  | Dragon
  | 'F'
  | 'J';

export const SUITS: readonly Suit[] = ['B', 'C', 'D'];
export const WINDS: readonly Wind[] = ['N', 'E', 'W', 'S'];
export const DRAGONS: readonly Dragon[] = ['GD', 'RD', 'WD'];

export const SUIT_NAMES: Record<Suit, string> = { B: 'Bam', C: 'Crak', D: 'Dot' };
export const WIND_NAMES: Record<Wind, string> = { N: 'North', E: 'East', W: 'West', S: 'South' };
export const DRAGON_NAMES: Record<Dragon, string> = {
  GD: 'Green Dragon',
  RD: 'Red Dragon',
  WD: 'White Dragon (Soap)',
};

/** Conventional pairing of each dragon with a suit (Green↔Bam, Red↔Crak, White↔Dot). */
export const DRAGON_OF_SUIT: Record<Suit, Dragon> = { B: 'GD', C: 'RD', D: 'WD' };

/** Every kind, in canonical display/sort order. Index in this array is the kind index. */
export const KINDS: readonly TileKind[] = [
  ...SUITS.flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}${s}` as TileKind)),
  ...WINDS,
  ...DRAGONS,
  'F',
  'J',
];

export const NUM_KINDS = KINDS.length; // 36
export const KIND_INDEX: Record<TileKind, number> = Object.fromEntries(
  KINDS.map((k, i) => [k, i]),
) as Record<TileKind, number>;

export const FLOWER_INDEX = KIND_INDEX.F;
export const JOKER_INDEX = KIND_INDEX.J;

/** Number of physical copies of each kind in the full set. */
export function supplyOf(kind: TileKind): number {
  if (kind === 'F' || kind === 'J') return 8;
  return 4;
}
export const SUPPLY: readonly number[] = KINDS.map(supplyOf);
export const TOTAL_TILES = SUPPLY.reduce((a, b) => a + b, 0); // 152

export function isSuited(kind: TileKind): kind is Extract<TileKind, `${number}${Suit}`> {
  return kind.length === 2 && kind[0] >= '1' && kind[0] <= '9';
}
export function suitOf(kind: TileKind): Suit | null {
  return isSuited(kind) ? (kind[1] as Suit) : null;
}
export function rankOf(kind: TileKind): number | null {
  return isSuited(kind) ? Number(kind[0]) : null;
}
export function isWind(kind: TileKind): kind is Wind {
  return (WINDS as readonly string[]).includes(kind);
}
export function isDragon(kind: TileKind): kind is Dragon {
  return (DRAGONS as readonly string[]).includes(kind);
}
export function isKind(s: string): s is TileKind {
  return s in KIND_INDEX;
}

export function kindName(kind: TileKind): string {
  if (isSuited(kind)) return `${kind[0]} ${SUIT_NAMES[kind[1] as Suit]}`;
  if (isWind(kind)) return WIND_NAMES[kind];
  if (isDragon(kind)) return DRAGON_NAMES[kind];
  if (kind === 'F') return 'Flower';
  return 'Joker';
}

/** Plural-aware short name, e.g. "5 Dots", "Norths", "Flowers". */
export function kindNamePlural(kind: TileKind, count: number): string {
  if (count === 1) return kindName(kind);
  if (isSuited(kind)) return `${kind[0]} ${SUIT_NAMES[kind[1] as Suit]}s`;
  if (isWind(kind)) return `${WIND_NAMES[kind]}s`;
  if (isDragon(kind)) return `${DRAGON_NAMES[kind].replace(' (Soap)', '')}s`;
  return kind === 'F' ? 'Flowers' : 'Jokers';
}

// ---------------------------------------------------------------------------
// Physical tiles
// ---------------------------------------------------------------------------

export type TileId = number;

/** kindOfId[id] gives the kind index of a physical tile. Ids are grouped by kind. */
export const KIND_OF_ID: readonly number[] = (() => {
  const out: number[] = [];
  KINDS.forEach((_, ki) => {
    for (let c = 0; c < SUPPLY[ki]; c++) out.push(ki);
  });
  return out;
})();

export function kindOfTile(id: TileId): TileKind {
  return KINDS[KIND_OF_ID[id]];
}

export function allTileIds(): TileId[] {
  return Array.from({ length: TOTAL_TILES }, (_, i) => i);
}

// ---------------------------------------------------------------------------
// Count vectors
// ---------------------------------------------------------------------------

export type Counts = Int8Array | number[];

export function emptyCounts(): number[] {
  return new Array(NUM_KINDS).fill(0);
}

export function countsFromIds(ids: readonly TileId[]): number[] {
  const c = emptyCounts();
  for (const id of ids) c[KIND_OF_ID[id]]++;
  return c;
}

export function countsFromKinds(kinds: readonly TileKind[]): number[] {
  const c = emptyCounts();
  for (const k of kinds) c[KIND_INDEX[k]]++;
  return c;
}

export function kindsFromCounts(c: Counts): TileKind[] {
  const out: TileKind[] = [];
  for (let i = 0; i < NUM_KINDS; i++) for (let n = 0; n < c[i]; n++) out.push(KINDS[i]);
  return out;
}

/** Parse a whitespace separated rack such as "F N W S RD 1C 2C". */
export function parseKinds(text: string): TileKind[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const up = t.toUpperCase();
      if (!isKind(up)) throw new Error(`Unknown tile "${t}"`);
      return up;
    });
}

/** Sort kinds by canonical order (Bam, Crak, Dot, winds, dragons, flowers, jokers). */
export function sortKinds(kinds: TileKind[]): TileKind[] {
  return [...kinds].sort((a, b) => KIND_INDEX[a] - KIND_INDEX[b]);
}

/** Stable string key for a count vector (used for caching). */
export function countsKey(c: Counts): string {
  return Array.from(c).join('');
}

/**
 * Pick concrete physical ids for a list of kinds, taking the first unused copies.
 * Throws if the kinds exceed the supply — used to build fixtures and selected racks.
 */
export function idsForKinds(kinds: readonly TileKind[], exclude: ReadonlySet<TileId> = new Set()): TileId[] {
  const used = new Set(exclude);
  return kinds.map((k) => {
    const ki = KIND_INDEX[k];
    for (let id = 0; id < TOTAL_TILES; id++) {
      if (KIND_OF_ID[id] === ki && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error(`No copies of ${k} left in the set`);
  });
}
