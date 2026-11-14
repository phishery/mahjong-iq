/**
 * Per-seat projection of a table. A view contains only what that seat may see: its own
 * concealed tiles, every exposure and discard, rack sizes, and public phase information.
 * Other racks, the wall order, pending Charleston selections and other seats' tiles drawn
 * stay hidden until the game ends, when every hand is revealed.
 *
 * The game server sends views to clients; the solo table renders the same view locally.
 */

import type { LoadedCard } from '../card/schema';
import { RULES } from '../charleston';
import type { TileId } from '../tiles';
import type { Exposure } from './hand';
import {
  callOptions,
  jokerSwaps,
  pendingSeats,
  SEAT_WINDS,
  SEATS,
  type CallOption,
  type GameResult,
  type SeatIndex,
  type TableEvent,
  type TableState,
} from './table';
import { findMahjong } from './hand';

export interface SeatView {
  seat: SeatIndex;
  name: string;
  bot: boolean;
  wind: (typeof SEAT_WINDS)[number];
  concealedCount: number;
  exposures: Exposure[];
  /** True when this seat still owes an action in the current phase. */
  pending: boolean;
}

export type PhaseView =
  | { name: 'charleston'; label: string; direction: 'right' | 'across' | 'left'; blindAllowed: boolean; required: number }
  | { name: 'vote' }
  | { name: 'courtesy-request' }
  | { name: 'courtesy-select'; agreed: number }
  | { name: 'turn'; seat: SeatIndex; called: boolean }
  | { name: 'calls'; tile: TileId; by: SeatIndex }
  | { name: 'ended'; result: GameResult };

export interface LegalView {
  /** You owe an action in this phase. */
  toAct: boolean;
  discard: boolean;
  mahjong: boolean;
  jokerSwaps: { give: TileId; seat: SeatIndex; exposure: number }[];
  calls: CallOption[];
}

export type EventView = TableEvent | ({ n: number; type: 'draw'; seat: SeatIndex; tile: null });

export interface TableView {
  seq: number;
  cardId: string;
  you: SeatIndex;
  seats: SeatView[];
  hand: TileId[];
  /** The tile you just drew (for highlighting). */
  drawn: TileId | null;
  wallCount: number;
  /** Tiles on the floor (uncalled discards), oldest first. */
  floor: { tile: TileId; by: SeatIndex }[];
  phase: PhaseView;
  legal: LegalView;
  events: EventView[];
  /** Every concealed hand, revealed once the game has ended. */
  revealed: TileId[][] | null;
}

const EVENT_TAIL = 60;

export function viewFor(card: LoadedCard, state: TableState, you: SeatIndex): TableView {
  const ph = state.phase;
  const pending = new Set(pendingSeats(state));
  let phase: PhaseView;
  switch (ph.name) {
    case 'charleston':
      phase = { name: 'charleston', label: ph.step.label, direction: ph.step.direction, blindAllowed: ph.step.blindAllowed, required: RULES.tilesPerPass };
      break;
    case 'vote':
      phase = { name: 'vote' };
      break;
    case 'courtesy-request':
      phase = { name: 'courtesy-request' };
      break;
    case 'courtesy-select':
      phase = { name: 'courtesy-select', agreed: ph.agreed[you] };
      break;
    case 'turn':
      phase = { name: 'turn', seat: ph.seat, called: ph.called };
      break;
    case 'calls':
      phase = { name: 'calls', tile: ph.tile, by: ph.by };
      break;
    case 'ended':
      phase = { name: 'ended', result: ph.result };
      break;
  }
  const myTurn = ph.name === 'turn' && ph.seat === you;
  const legal: LegalView = {
    toAct: pending.has(you),
    discard: myTurn,
    mahjong: myTurn && !!findMahjong(card, state.concealed[you], state.exposures[you]),
    jokerSwaps: myTurn ? jokerSwaps(state, you) : [],
    calls: ph.name === 'calls' && pending.has(you) ? callOptions(card, state, you) : [],
  };
  const ended = ph.name === 'ended';
  const events: EventView[] = state.log.slice(-EVENT_TAIL).map((e) =>
    e.type === 'draw' && e.seat !== you && !ended ? { n: e.n, type: 'draw', seat: e.seat, tile: null } : e,
  );
  return {
    seq: state.seq,
    cardId: state.cardId,
    you,
    seats: SEATS.map((s) => ({
      seat: s,
      name: state.config.seats[s].name,
      bot: state.config.seats[s].bot !== null,
      wind: SEAT_WINDS[s],
      concealedCount: state.concealed[s].length,
      exposures: state.exposures[s].map((e) => ({ ...e, tiles: [...e.tiles] })),
      pending: pending.has(s),
    })),
    hand: [...state.concealed[you]],
    drawn: myTurn ? (ph as { drawn: TileId | null }).drawn : null,
    wallCount: state.wall.length,
    floor: state.discards.filter((d) => !d.called).map((d) => ({ tile: d.tile, by: d.by })),
    phase,
    legal,
    events,
    revealed: ended ? state.concealed.map((r) => [...r]) : null,
  };
}
