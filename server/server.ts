/**
 * Mahjong IQ game server: HTTP health check plus a WebSocket endpoint (/ws) for rooms.
 *
 * Environment:
 *   PORT             listen port (default 8787)
 *   ALLOWED_ORIGINS  comma-separated browser origins allowed to connect (default: any)
 *   CARD_JSON        optional official card JSON (never committed to the repository)
 *   CARD_PASSCODE    passcode a host enters to use CARD_JSON in a private room
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadCard } from '../src/engine/card/parser';
import type { LoadedCard } from '../src/engine/card/schema';
import { DEMO_CARD_JSON, getDemoCard } from '../src/engine/cards';
import { ClientMessageSchema, type ServerMessage } from '../src/net/protocol';
import { DEFAULT_TIMING, realClock, Room, type Clock, type RoomTiming } from './room';

export interface ServerOptions {
  port: number;
  allowedOrigins?: string[];
  cardJson?: string;
  cardPasscode?: string;
  clock?: Clock;
  timing?: RoomTiming;
  maxRooms?: number;
  /** Rooms with nobody connected are closed after this long. */
  idleRoomMs?: number;
  log?: (msg: string) => void;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_MSGS_PER_10S = 120;
const FAILURE_DELAY_MS = 1000;

const digest = (s: string) => createHash('sha256').update(s).digest();

export interface RunningServer {
  port: number;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const clock = opts.clock ?? realClock;
  const timing = opts.timing ?? DEFAULT_TIMING;
  const maxRooms = opts.maxRooms ?? 500;
  const idleRoomMs = opts.idleRoomMs ?? 15 * 60_000;
  const log = opts.log ?? (() => {});
  const rooms = new Map<string, Room>();
  /** Open sockets per room and player (a person may have several tabs). */
  const sockets = new Map<string, Map<string, Set<WebSocket>>>();

  let official: { card: LoadedCard; json: unknown } | null = null;
  const officialCard = () => {
    if (!official && opts.cardJson) {
      const json = JSON.parse(opts.cardJson) as unknown;
      official = { card: loadCard(json), json };
    }
    return official;
  };

  const sendTo = (code: string) => (playerId: string, msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of sockets.get(code)?.get(playerId) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
  };

  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  };

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Mahjong IQ game server');
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }: { origin: string }) => !opts.allowedOrigins?.length || opts.allowedOrigins.includes(origin),
  });

  wss.on('connection', (ws) => {
    let roomCode: string | null = null;
    let playerId: string | null = null;
    let windowStart = clock.now();
    let count = 0;
    const reply = (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    const fail = (message: string) => reply({ t: 'error', message });

    const attach = (code: string, id: string) => {
      roomCode = code;
      playerId = id;
      let byPlayer = sockets.get(code);
      if (!byPlayer) sockets.set(code, (byPlayer = new Map()));
      let set = byPlayer.get(id);
      if (!set) byPlayer.set(id, (set = new Set()));
      set.add(ws);
    };
    const detach = () => {
      if (!roomCode || !playerId) return;
      const set = sockets.get(roomCode)?.get(playerId);
      set?.delete(ws);
      if (set && set.size === 0) rooms.get(roomCode)?.disconnect(playerId);
    };

    ws.on('message', async (raw) => {
      const now = clock.now();
      if (now - windowStart > 10_000) {
        windowStart = now;
        count = 0;
      }
      if (++count > MAX_MSGS_PER_10S) return fail('Too many messages — slow down.');
      let parsed;
      try {
        parsed = ClientMessageSchema.safeParse(JSON.parse(String(raw)));
      } catch {
        return fail('Malformed message.');
      }
      if (!parsed.success) return fail('Malformed message.');
      const msg = parsed.data;
      const room = roomCode ? rooms.get(roomCode) : undefined;

      switch (msg.t) {
        case 'ping':
          return reply({ t: 'pong' });
        case 'create': {
          if (roomCode) return fail('You are already in a room.');
          if (rooms.size >= maxRooms) return fail('The server is full — try again later.');
          let card: LoadedCard = getDemoCard();
          let json: unknown = DEMO_CARD_JSON;
          let isOfficial = false;
          if (msg.passcode) {
            const expected = opts.cardPasscode;
            const off = officialCard();
            if (!expected || !off) return fail('No private card is configured on this server.');
            if (!timingSafeEqual(digest(msg.passcode.trim()), digest(expected))) {
              await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
              return fail('That passcode isn’t right.');
            }
            card = off.card;
            json = off.json;
            isOfficial = true;
          }
          const code = newCode();
          const r = new Room(code, card, json, isOfficial, msg.playerId, { botProfile: msg.botProfile, courtesy: msg.courtesy }, sendTo(code), clock, timing);
          rooms.set(code, r);
          attach(code, msg.playerId);
          log(`room ${code} created (${isOfficial ? 'private card' : 'demo card'})`);
          const err = r.join(msg.playerId, msg.name);
          return err ? fail(err) : undefined;
        }
        case 'join': {
          if (roomCode) return fail('You are already in a room.');
          const r = rooms.get(msg.code);
          if (!r) return fail('No room with that code.');
          attach(msg.code, msg.playerId);
          const err = r.join(msg.playerId, msg.name);
          if (err) {
            detach();
            roomCode = playerId = null;
            return fail(err);
          }
          return;
        }
        default:
          break;
      }

      if (!room || !playerId) return fail('Join a room first.');
      let err: string | null = null;
      switch (msg.t) {
        case 'take-seat':
          err = room.takeSeat(playerId, msg.seat);
          break;
        case 'set-bot':
          err = room.setBot(playerId, msg.seat, msg.bot);
          break;
        case 'start':
          err = room.start(playerId);
          break;
        case 'new-hand':
          err = room.newHand(playerId);
          break;
        case 'act':
          err = room.act(playerId, msg.action);
          break;
        case 'leave':
          room.leave(playerId);
          sockets.get(room.code)?.delete(playerId);
          roomCode = playerId = null;
          break;
      }
      if (err) fail(err);
    });

    ws.on('close', detach);
    ws.on('error', detach);
  });

  // Close rooms nobody has been connected to for a while.
  const sweep = setInterval(() => {
    const now = clock.now();
    for (const [code, r] of rooms) {
      if (r.connectedCount === 0 && now - r.lastActivity > idleRoomMs) {
        r.dispose();
        rooms.delete(code);
        sockets.delete(code);
        log(`room ${code} closed (idle)`);
      }
    }
  }, 60_000);
  sweep.unref?.();

  return new Promise((resolve) => {
    http.listen(opts.port, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        port,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(sweep);
            for (const r of rooms.values()) r.dispose();
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}
