import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCard } from '../../engine/card/parser';
import type { LoadedCard } from '../../engine/card/schema';
import type { OpponentProfile } from '../../engine/opponents';
import type { TableAction } from '../../engine/table/table';
import type { TableView } from '../../engine/table/view';
import type { ClientMessage, RoomInfo, ServerMessage } from '../../net/protocol';

const PLAYER_KEY = 'mahjong-iq:player-id';
const NAME_KEY = 'mahjong-iq:player-name';
const ROOM_KEY = 'mahjong-iq:room';

/** The game server address: VITE_GAME_SERVER_URL, or a local server while developing. */
export function gameServerUrl(): string | null {
  const env = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (env) return env;
  if (import.meta.env.DEV && typeof location !== 'undefined') return `ws://${location.hostname}:8787/ws`;
  return null;
}

function safeGet(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}
function safeSet(store: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** A stable anonymous id so a person can reconnect to their seat. */
function playerId(): string {
  let id = safeGet(() => localStorage, PLAYER_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    safeSet(() => localStorage, PLAYER_KEY, id);
  }
  return id;
}

export const savedName = () => safeGet(() => localStorage, NAME_KEY) ?? '';

export type OnlineStatus = 'connecting' | 'open' | 'closed';

/** Keep trying this long before calling the server unreachable (a free host can take ~1 min to wake). */
const GIVE_UP_AFTER_MS = 180_000;
/** Show the "waking up" notice if connecting takes longer than this. */
const SLOW_CONNECT_MS = 3000;

export function useOnline(url: string | null) {
  const [status, setStatus] = useState<OnlineStatus>('closed');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [view, setView] = useState<TableView | null>(null);
  const [callDeadline, setCallDeadline] = useState<number | null>(null);
  const [card, setCard] = useState<LoadedCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The server is slow to answer (probably waking from sleep). */
  const [waking, setWaking] = useState(false);
  /** Gave up reconnecting; the person can retry. */
  const [unreachable, setUnreachable] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const firstFailure = useRef<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const me = useRef(playerId());
  const pendingJoin = useRef<ClientMessage | null>(null);
  const closedByUs = useRef(false);
  const retries = useRef(0);

  const connect = useCallback(() => {
    if (!url) return;
    if (ws.current && ws.current.readyState <= WebSocket.OPEN) return;
    setStatus('connecting');
    closedByUs.current = false;
    const sock = new WebSocket(url);
    ws.current = sock;
    const slow = setTimeout(() => setWaking(true), SLOW_CONNECT_MS);
    sock.onopen = () => {
      clearTimeout(slow);
      retries.current = 0;
      firstFailure.current = null;
      setWaking(false);
      setUnreachable(false);
      setStatus('open');
      // Rejoin the room we were in (after a reload or a dropped connection).
      const saved = safeGet(() => sessionStorage, ROOM_KEY);
      const msg = pendingJoin.current ?? (saved ? ({ t: 'join', code: saved, name: savedName() || 'Player', playerId: me.current } as ClientMessage) : null);
      pendingJoin.current = null;
      if (msg) sock.send(JSON.stringify(msg));
    };
    sock.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      switch (msg.t) {
        case 'joined':
          safeSet(() => sessionStorage, ROOM_KEY, msg.code);
          break;
        case 'room':
          setRoom(msg.room);
          if (!msg.room.started) setView(null);
          break;
        case 'card':
          try {
            setCard(loadCard(msg.json));
          } catch {
            setError('The room’s card could not be loaded.');
          }
          break;
        case 'view':
          setView(msg.view);
          setCallDeadline(msg.callDeadline);
          break;
        case 'error':
          setError(msg.message);
          if (/No room with that code/.test(msg.message)) safeSet(() => sessionStorage, ROOM_KEY, null);
          break;
        case 'left':
          safeSet(() => sessionStorage, ROOM_KEY, null);
          setRoom(null);
          setView(null);
          break;
      }
    };
    sock.onclose = () => {
      clearTimeout(slow);
      setStatus('closed');
      if (ws.current === sock) ws.current = null;
      if (closedByUs.current) return;
      // Keep retrying while this screen is open: a sleeping server wakes on the first attempt.
      const now = Date.now();
      firstFailure.current ??= now;
      if (now - firstFailure.current > GIVE_UP_AFTER_MS) {
        setWaking(false);
        setUnreachable(true);
        return;
      }
      setWaking(true);
      const delay = Math.min(5000, 1000 * ++retries.current);
      retryTimer.current = setTimeout(connect, delay);
    };
  }, [url]);

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: 'ping' }));
    }, 25000);
    return () => {
      clearInterval(ping);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      closedByUs.current = true;
      ws.current?.close();
      ws.current = null;
    };
  }, [connect]);

  const send = useCallback(
    (msg: ClientMessage) => {
      const sock = ws.current;
      if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
      else {
        if (msg.t === 'create' || msg.t === 'join') pendingJoin.current = msg;
        connect();
      }
    },
    [connect],
  );

  const remember = (name: string) => safeSet(() => localStorage, NAME_KEY, name);

  return {
    status,
    room,
    view,
    card,
    callDeadline,
    error,
    waking,
    unreachable,
    retry: () => {
      firstFailure.current = null;
      retries.current = 0;
      setUnreachable(false);
      connect();
    },
    clearError: () => setError(null),
    create: (name: string, opts: { passcode?: string; botProfile: OpponentProfile; courtesy: boolean }) => {
      remember(name);
      setError(null);
      send({ t: 'create', name, playerId: me.current, passcode: opts.passcode || undefined, botProfile: opts.botProfile, courtesy: opts.courtesy });
    },
    join: (code: string, name: string) => {
      remember(name);
      setError(null);
      send({ t: 'join', code: code.trim().toUpperCase(), name, playerId: me.current });
    },
    takeSeat: (seat: number) => send({ t: 'take-seat', seat }),
    setBot: (seat: number, bot: OpponentProfile | null) => send({ t: 'set-bot', seat, bot }),
    start: () => send({ t: 'start' }),
    newHand: () => send({ t: 'new-hand' }),
    act: (action: TableAction) => {
      setError(null);
      send({ t: 'act', action });
    },
    leave: () => {
      send({ t: 'leave' });
      safeSet(() => sessionStorage, ROOM_KEY, null);
      setRoom(null);
      setView(null);
    },
  };
}

export type OnlineApi = ReturnType<typeof useOnline>;
