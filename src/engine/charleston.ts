/**
 * Centralised NMJL Charleston rules. Everything about passing lives here so the rules
 * can be tested without the UI. See docs/RULES.md for sources and assumptions.
 *
 *  - First Charleston (mandatory): Right, Across, Left. Exactly 3 tiles each pass.
 *  - Blind pass ("steal"): on the FIRST LEFT and the LAST RIGHT a player may pass on
 *    1, 2 or 3 of the tiles being received, unseen, instead of tiles from their own rack.
 *  - Second Charleston (optional): Left, Across, Right. Any one player may stop it.
 *  - Optional courtesy pass: players across from each other exchange 0–3 tiles; when they
 *    ask for different numbers, the lower number is used.
 *  - Jokers may never be passed (Charleston or courtesy). Flowers may be passed freely.
 *  - The dealer (East) holds 14 tiles and others 13; everyone passes the same number.
 */

import type { TileId } from './tiles';
import { JOKER_INDEX, KIND_OF_ID } from './tiles';

export type Seat = 'you' | 'right' | 'across' | 'left';
export type Direction = 'right' | 'across' | 'left';

/** Seats in turn order (play passes to the right, counter-clockwise). */
export const SEAT_ORDER: readonly Seat[] = ['you', 'right', 'across', 'left'];

export const RULES = {
  tilesPerPass: 3,
  courtesyMax: 3,
  jokersPassable: false,
  flowersPassable: true,
  dealerTiles: 14,
  playerTiles: 13,
  maxBlind: 3,
} as const;

export type CharlestonPhase = 1 | 2 | 'courtesy';

export interface PassStep {
  id: string;
  phase: CharlestonPhase;
  direction: Direction;
  blindAllowed: boolean;
  label: string;
  short: string;
}

export const FIRST_CHARLESTON: readonly PassStep[] = [
  { id: 'c1-right', phase: 1, direction: 'right', blindAllowed: false, label: 'First Right', short: 'R' },
  { id: 'c1-across', phase: 1, direction: 'across', blindAllowed: false, label: 'First Across', short: 'A' },
  { id: 'c1-left', phase: 1, direction: 'left', blindAllowed: true, label: 'First Left', short: 'L' },
];

export const SECOND_CHARLESTON: readonly PassStep[] = [
  { id: 'c2-left', phase: 2, direction: 'left', blindAllowed: false, label: 'Second Left', short: 'L' },
  { id: 'c2-across', phase: 2, direction: 'across', blindAllowed: false, label: 'Second Across', short: 'A' },
  { id: 'c2-right', phase: 2, direction: 'right', blindAllowed: true, label: 'Last Right', short: 'R' },
];

export const COURTESY_STEP: PassStep = {
  id: 'courtesy',
  phase: 'courtesy',
  direction: 'across',
  blindAllowed: false,
  label: 'Courtesy Pass',
  short: 'C',
};

const OFFSET: Record<Direction, number> = { right: 1, across: 2, left: 3 };

/** The seat that receives when `from` passes in `dir`. */
export function targetOf(from: Seat, dir: Direction): Seat {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(from) + OFFSET[dir]) % 4];
}

/** The seat whose pass in `dir` arrives at `to`. */
export function giverTo(to: Seat, dir: Direction): Seat {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(to) - OFFSET[dir] + 4) % 4];
}

export function isJoker(id: TileId): boolean {
  return KIND_OF_ID[id] === JOKER_INDEX;
}

export class PassError extends Error {}

/** Validate a set of own tiles chosen for a pass. Throws PassError with a friendly message. */
export function validatePass(rack: readonly TileId[], chosen: readonly TileId[], required: number): void {
  if (new Set(chosen).size !== chosen.length) throw new PassError('The same tile was selected twice.');
  if (chosen.length !== required) {
    throw new PassError(`Select exactly ${required} tile${required === 1 ? '' : 's'} to pass.`);
  }
  for (const id of chosen) {
    if (!rack.includes(id)) throw new PassError('You can only pass tiles from your own rack.');
    if (!RULES.jokersPassable && isJoker(id)) throw new PassError('Jokers can never be passed.');
  }
}

/** How many own tiles must be selected for a Charleston pass with `blind` tiles passed blind. */
export function ownTilesRequired(step: PassStep, blind: number): number {
  if (blind < 0 || blind > RULES.maxBlind) throw new PassError('Blind pass must be 0–3 tiles.');
  if (blind > 0 && !step.blindAllowed) throw new PassError(`A blind pass is not allowed on the ${step.label}.`);
  return RULES.tilesPerPass - blind;
}

/** Courtesy agreement: the lower of the two requested numbers. */
export function courtesyAgreement(a: number, b: number): number {
  const clamp = (x: number) => Math.max(0, Math.min(RULES.courtesyMax, Math.floor(x)));
  return Math.min(clamp(a), clamp(b));
}

/** The second Charleston happens only if nobody stops it. */
export function secondCharlestonProceeds(votes: Record<Seat, boolean>): boolean {
  return SEAT_ORDER.every((s) => votes[s]);
}

export type Racks = Record<Seat, TileId[]>;

export interface ExchangeResult {
  racks: Racks;
  /** Tiles each seat received. */
  received: Record<Seat, TileId[]>;
  /** For the player's blind pass: incoming tiles forwarded unseen. */
  forwarded: TileId[];
}

/**
 * Execute one simultaneous Charleston pass. `chosen[seat]` are the own tiles each seat
 * passes. The player may pass `blindForward` (a subset of the tiles arriving to them)
 * onward unseen; opponents never blind pass in this simulation.
 */
export function executePass(
  racks: Racks,
  chosen: Record<Seat, TileId[]>,
  dir: Direction,
  blindForward: TileId[] = [],
): ExchangeResult {
  const out: Racks = { you: [...racks.you], right: [...racks.right], across: [...racks.across], left: [...racks.left] };
  const received: Record<Seat, TileId[]> = { you: [], right: [], across: [], left: [] };
  for (const seat of SEAT_ORDER) {
    for (const id of chosen[seat]) {
      if (!racks[seat].includes(id)) throw new PassError(`${seat} does not hold tile ${id}`);
      if (isJoker(id)) throw new PassError('Jokers can never be passed.');
    }
  }
  const incomingToYou = chosen[giverTo('you', dir)];
  for (const id of blindForward) {
    if (!incomingToYou.includes(id)) throw new PassError('Blind tiles must come from the incoming pass.');
  }
  if (chosen.you.length + blindForward.length !== RULES.tilesPerPass) {
    throw new PassError('A Charleston pass is always exactly 3 tiles.');
  }
  for (const seat of SEAT_ORDER) {
    if (seat !== 'you' && chosen[seat].length !== RULES.tilesPerPass) {
      throw new PassError(`${seat} must pass exactly 3 tiles.`);
    }
  }
  // Remove passed tiles.
  for (const seat of SEAT_ORDER) out[seat] = out[seat].filter((id) => !chosen[seat].includes(id));
  // Deliver.
  for (const seat of SEAT_ORDER) {
    const to = targetOf(seat, dir);
    let tiles = chosen[seat];
    if (seat === 'you') tiles = [...chosen.you, ...blindForward];
    if (to === 'you') tiles = tiles.filter((id) => !blindForward.includes(id));
    received[to].push(...tiles);
    out[to].push(...tiles);
  }
  return { racks: out, received, forwarded: [...blindForward] };
}

/** Courtesy exchange between across partners (you↔across and right↔left). */
export function executeCourtesy(racks: Racks, chosen: Record<Seat, TileId[]>): ExchangeResult {
  if (chosen.you.length !== chosen.across.length || chosen.right.length !== chosen.left.length) {
    throw new PassError('Courtesy partners must exchange the same number of tiles.');
  }
  for (const seat of SEAT_ORDER) {
    if (chosen[seat].length > RULES.courtesyMax) throw new PassError('A courtesy pass is at most 3 tiles.');
    for (const id of chosen[seat]) {
      if (!racks[seat].includes(id)) throw new PassError(`${seat} does not hold tile ${id}`);
      if (isJoker(id)) throw new PassError('Jokers can never be passed.');
    }
  }
  const out: Racks = { you: [], right: [], across: [], left: [] };
  const received: Record<Seat, TileId[]> = { you: [], right: [], across: [], left: [] };
  for (const seat of SEAT_ORDER) {
    const partner = targetOf(seat, 'across');
    out[seat] = racks[seat].filter((id) => !chosen[seat].includes(id)).concat(chosen[partner]);
    received[seat] = [...chosen[partner]];
  }
  return { racks: out, received, forwarded: [] };
}
