import type { SeatIndex } from '../../engine/table/table';
import type { EventView, TableView } from '../../engine/table/view';
import { kindName, kindOfTile, type TileId } from '../../engine/tiles';

export type Position = 'you' | 'right' | 'across' | 'left';
const POSITIONS: Position[] = ['you', 'right', 'across', 'left'];

/** Where a seat sits relative to you (turn order runs to the right). */
export function positionOf(view: TableView, seat: SeatIndex): Position {
  return POSITIONS[(seat - view.you + 4) % 4];
}

export function seatAt(view: TableView, pos: Position): SeatIndex {
  return (view.you + POSITIONS.indexOf(pos)) % 4;
}

const WIND_NAME = { E: 'East', S: 'South', W: 'West', N: 'North' } as const;

export function seatLabel(view: TableView, seat: SeatIndex): string {
  if (seat === view.you) return 'You';
  return view.seats[seat].name;
}

/** "your" for you, otherwise "Name’s". */
export function possessive(view: TableView, seat: SeatIndex): string {
  return seat === view.you ? 'your' : `${view.seats[seat].name}’s`;
}

export function windName(view: TableView, seat: SeatIndex): string {
  return WIND_NAME[view.seats[seat].wind];
}

export const tileName = (id: TileId) => kindName(kindOfTile(id));

const GROUP = ['', '', 'pair', 'pung', 'kong', 'quint', 'sextet'];

/** A one-line description of a table event, or null for events not worth showing. */
export function describeEvent(view: TableView, e: EventView): string | null {
  const who = (s: SeatIndex) => seatLabel(view, s);
  switch (e.type) {
    case 'deal':
      return 'Tiles dealt. East holds 14 and opens play.';
    case 'pass': {
      const blind = e.blind.reduce((a, b) => a + b, 0);
      return `${e.label} complete${blind ? ` (${blind} tile${blind === 1 ? '' : 's'} passed blind)` : ''}.`;
    }
    case 'vote':
      return e.proceed ? 'Everyone agreed to a second Charleston.' : `${e.stoppedBy.map(who).join(' and ')} stopped the second Charleston.`;
    case 'courtesy':
      return e.counts.every((c) => c === 0) ? 'No courtesy exchange.' : `Courtesy pass: you exchange ${e.counts[view.you]}.`;
    case 'play-start':
      return 'Play begins — East discards first.';
    case 'draw':
      return e.seat === view.you && e.tile !== null ? `You drew ${tileName(e.tile)}.` : null;
    case 'discard':
      return `${who(e.seat)} discarded ${tileName(e.tile)}.`;
    case 'expose':
      return `${who(e.seat)} called ${tileName(e.tile)} from ${e.from === view.you ? 'you' : who(e.from)} for a ${GROUP[e.size] ?? `group of ${e.size}`}.`;
    case 'joker-swap':
      return `${who(e.seat)} swapped ${tileName(e.give)} for a Joker in ${e.target === e.seat ? (e.seat === view.you ? 'your own' : 'their own') : possessive(view, e.target)} exposure.`;
    case 'mahjong':
      return `Mahjong! ${who(e.seat)} ${e.selfDrawn ? 'drew the winning tile' : `won on ${possessive(view, e.from!)} discard`}.`;
    case 'wall-game':
      return 'The wall is empty — a wall game, nobody wins.';
  }
}

export function groupName(size: number): string {
  return GROUP[size] ?? `group of ${size}`;
}

export const DIR_ARROW = { right: '→', across: '↑', left: '←' } as const;
