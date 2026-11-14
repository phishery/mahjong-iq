/**
 * Wire protocol between the browser and the game server (JSON over a WebSocket).
 *
 * The server owns every game. Clients send intents ("discard this tile"); the server checks
 * them with the table engine and sends each person a view of the table that contains only
 * what their seat may see (see src/engine/table/view.ts).
 */

import { z } from 'zod';
import type { OpponentProfile } from '../engine/opponents';
import type { TableAction } from '../engine/table/table';
import type { TableView } from '../engine/table/view';

export const PROFILES = ['competent', 'casual', 'random'] as const satisfies readonly OpponentProfile[];

const tile = z.number().int().min(0).max(151);
const seat = z.number().int().min(0).max(3);
const name = z.string().trim().min(1).max(24);
const playerId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ActionSchema: z.ZodType<TableAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pass-tiles'), tiles: z.array(tile).max(3), blind: z.number().int().min(0).max(3).optional() }),
  z.object({ type: z.literal('vote'), proceed: z.boolean() }),
  z.object({ type: z.literal('courtesy-request'), count: z.number().int().min(0).max(3) }),
  z.object({ type: z.literal('courtesy-tiles'), tiles: z.array(tile).max(3) }),
  z.object({ type: z.literal('discard'), tile }),
  z.object({ type: z.literal('mahjong') }),
  z.object({ type: z.literal('joker-swap'), give: tile, seat, exposure: z.number().int().min(0).max(4) }),
  z.object({
    type: z.literal('call'),
    response: z.discriminatedUnion('type', [
      z.object({ type: z.literal('pass') }),
      z.object({ type: z.literal('mahjong') }),
      z.object({ type: z.literal('expose'), tiles: z.array(tile).min(2).max(5) }),
    ]),
  }),
]) as z.ZodType<TableAction>;

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('create'),
    name,
    playerId,
    passcode: z.string().max(200).optional(),
    botProfile: z.enum(PROFILES).default('competent'),
    courtesy: z.boolean().default(true),
  }),
  z.object({ t: z.literal('join'), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/), name, playerId }),
  z.object({ t: z.literal('take-seat'), seat }),
  z.object({ t: z.literal('set-bot'), seat, bot: z.enum(PROFILES).nullable() }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('new-hand') }),
  z.object({ t: z.literal('act'), action: ActionSchema }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMessage = z.input<typeof ClientMessageSchema>;
export type ParsedClientMessage = z.output<typeof ClientMessageSchema>;

export type LobbySeat =
  | { kind: 'empty' }
  | { kind: 'bot'; profile: OpponentProfile; name: string }
  | { kind: 'human'; name: string; connected: boolean; you: boolean; host: boolean };

export interface RoomInfo {
  code: string;
  started: boolean;
  /** Seats by wind: 0 East (dealer), 1 South, 2 West, 3 North. */
  seats: LobbySeat[];
  youAreHost: boolean;
  yourSeat: number | null;
  cardTitle: string;
  officialCard: boolean;
  botProfile: OpponentProfile;
  courtesy: boolean;
  hands: number;
  /** Running totals across hands, by seat. */
  scores: number[];
}

export type ServerMessage =
  | { t: 'joined'; code: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'card'; json: unknown }
  | { t: 'view'; view: TableView; callDeadline: number | null }
  | { t: 'error'; message: string }
  | { t: 'left' }
  | { t: 'pong' };
