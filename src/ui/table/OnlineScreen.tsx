import { useState } from 'react';
import { OPPONENT_PROFILES, type OpponentProfile } from '../../engine/opponents';
import { SEAT_WIND_NAMES } from '../../engine/table/table';
import { Button, Chip, cx, Panel, Segmented, Toggle } from '../components';
import { TableScreen } from './TableScreen';
import { gameServerUrl, savedName, useOnline } from './useOnline';

const PROFILE_ORDER: OpponentProfile[] = ['competent', 'casual', 'random'];

export function OnlineScreen({ initialCode, showLabels, onHome }: { initialCode: string | null; showLabels: boolean; onHome: () => void }) {
  const url = gameServerUrl();
  if (!url) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Panel title="Play online">
          <div className="px-4 pb-4 space-y-3 text-sm text-ink-soft">
            <p>Online play needs the Mahjong IQ game server, and this site isn’t connected to one yet.</p>
            <p>
              The site owner can run it with <code className="bg-paper px-1 rounded">npm run server</code> (see the README) and set{' '}
              <code className="bg-paper px-1 rounded">VITE_GAME_SERVER_URL</code>.
            </p>
            <Button variant="secondary" onClick={onHome}>
              Back
            </Button>
          </div>
        </Panel>
      </div>
    );
  }
  return <Online url={url} initialCode={initialCode} showLabels={showLabels} onHome={onHome} />;
}

function ServerNotice({ net }: { net: ReturnType<typeof useOnline> }) {
  if (net.unreachable) {
    return (
      <div role="alert" className="rounded-xl bg-red-50 text-[#8f2d22] px-3 py-2 text-sm flex flex-wrap items-center gap-3">
        Can’t reach the game server right now.
        <Button size="sm" variant="secondary" onClick={net.retry}>
          Try again
        </Button>
      </div>
    );
  }
  if (net.waking && net.status !== 'open') {
    return (
      <div role="status" className="rounded-xl bg-[#fbf3e1] text-[#7a5a14] px-3 py-2 text-sm" data-testid="server-waking">
        Waking up the game server… After a quiet spell this can take up to a minute. You can keep going — we’ll connect as soon as it’s ready.
      </div>
    );
  }
  return null;
}

function Online({ url, initialCode, showLabels, onHome }: { url: string; initialCode: string | null; showLabels: boolean; onHome: () => void }) {
  const net = useOnline(url);
  const { room, view, card } = net;

  if (room?.started && view && card) {
    const banner = (
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
        <span className="rounded-full bg-jade-50 text-jade-800 px-2.5 py-1 font-semibold">Room {room.code}</span>
        <span>Hand {room.hands}</span>
        <span className="flex gap-2">
          {room.seats.map((s, i) => (
            <span key={i}>
              {s.kind === 'empty' ? '—' : s.kind === 'human' && s.you ? 'You' : s.name}: <strong className="tabular-nums">{room.scores[i]}</strong>
            </span>
          ))}
        </span>
        {net.status !== 'open' && <span className="text-crak font-semibold">{net.unreachable ? 'Disconnected' : 'Reconnecting…'}</span>}
        {net.unreachable && (
          <button type="button" className="font-semibold text-jade-700" onClick={net.retry}>
            Try again
          </button>
        )}
        <button type="button" className="ml-auto font-semibold text-ink-faint hover:text-crak" onClick={() => { net.leave(); onHome(); }}>
          Leave table
        </button>
      </div>
    );
    return (
      <TableScreen
        card={card}
        view={view}
        act={net.act}
        error={net.error}
        clearError={net.clearError}
        callDeadline={net.callDeadline}
        showLabels={showLabels}
        banner={banner}
        endActions={
          <span className="flex flex-wrap gap-2 w-full">
            {room.youAreHost ? (
              <Button onClick={net.newHand} data-testid="online-next-hand">
                Deal the next hand →
              </Button>
            ) : (
              <span className="text-sm text-ink-soft">Waiting for the host to deal the next hand…</span>
            )}
            <Button variant="ghost" onClick={() => { net.leave(); onHome(); }}>
              Leave table
            </Button>
          </span>
        }
      />
    );
  }

  if (room) return <Lobby net={net} onHome={onHome} />;
  return <JoinForm net={net} initialCode={initialCode} onHome={onHome} />;
}

function JoinForm({ net, initialCode, onHome }: { net: ReturnType<typeof useOnline>; initialCode: string | null; onHome: () => void }) {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(initialCode ?? '');
  const [profile, setProfile] = useState<OpponentProfile>('competent');
  const [courtesy, setCourtesy] = useState(true);
  const [usePasscode, setUsePasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const nameOk = name.trim().length > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10 space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold">Play a full game</h1>
        <p className="text-ink-soft mt-1">One to four people at a table; computer players fill the empty seats.</p>
      </div>
      <ServerNotice net={net} />
      <label className="block max-w-sm">
        <span className="text-sm font-semibold">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          className="mt-1 w-full h-10 rounded-xl border border-line px-3 bg-white"
          placeholder="e.g. Ruth"
          data-testid="online-name"
        />
      </label>
      {net.error && (
        <p role="alert" className="text-sm text-crak">
          {net.error}
        </p>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Start a table">
          <form
            className="px-4 pb-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameOk) net.create(name.trim(), { passcode: usePasscode ? passcode : undefined, botProfile: profile, courtesy });
            }}
          >
            <div>
              <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">Computer players</span>
              <div className="mt-1.5">
                <Segmented value={profile} onChange={setProfile} options={PROFILE_ORDER.map((p) => ({ value: p, label: OPPONENT_PROFILES[p].name.replace(' (experimental)', '') }))} />
              </div>
            </div>
            <Toggle checked={courtesy} onChange={setCourtesy} label="Offer the courtesy pass" />
            <Toggle checked={usePasscode} onChange={setUsePasscode} label="Use the private card" hint="Needs the card passcode. Everyone at the table will see the card." />
            {usePasscode && (
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full h-10 rounded-xl border border-line px-3 bg-white"
                placeholder="Card passcode"
                autoComplete="off"
              />
            )}
            <Button type="submit" disabled={!nameOk} data-testid="online-create">
              {net.status === 'open' ? 'Create table →' : 'Create table (connecting…)'}
            </Button>
          </form>
        </Panel>
        <Panel title="Join a table">
          <form
            className="px-4 pb-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameOk && code.trim()) net.join(code, name.trim());
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              className="w-full h-12 rounded-xl border border-line px-3 bg-white font-mono text-xl tracking-[0.3em] uppercase"
              placeholder="CODE"
              data-testid="online-code"
            />
            <Button type="submit" variant="secondary" disabled={!nameOk || code.trim().length < 4} data-testid="online-join">
              Join →
            </Button>
          </form>
        </Panel>
      </div>
      <Button variant="ghost" onClick={onHome}>
        ← Back
      </Button>
    </div>
  );
}

function Lobby({ net, onHome }: { net: ReturnType<typeof useOnline>; onHome: () => void }) {
  const room = net.room!;
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${location.pathname}#room=${room.code}`;
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-4" data-testid="lobby">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Table code</p>
          <p className="font-mono text-4xl font-bold tracking-[0.25em]" data-testid="room-code">
            {room.code}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))}
        >
          {copied ? 'Invite link copied' : 'Copy invite link'}
        </Button>
        <span className={cx('text-xs rounded-full px-2 py-0.5', room.officialCard ? 'bg-jade-50 text-jade-800' : 'bg-[#fbf3e1] text-[#7a5a14]')}>
          {room.cardTitle}
        </span>
      </div>
      <ServerNotice net={net} />
      {net.error && (
        <p role="alert" className="text-sm text-crak">
          {net.error}
        </p>
      )}
      <Panel title="Seats">
        <ul className="px-4 pb-4 grid sm:grid-cols-2 gap-2">
          {room.seats.map((s, i) => (
            <li key={i} className={cx('rounded-xl border p-3 flex items-center gap-3', s.kind === 'human' && s.you ? 'border-jade-400 bg-jade-50/50' : 'border-line')} data-testid={`lobby-seat-${i}`}>
              <span className="w-8 h-8 rounded-full bg-jade-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{SEAT_WIND_NAMES[i][0]}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-ink-faint">
                  {SEAT_WIND_NAMES[i]}
                  {i === 0 ? ' · deals first' : ''}
                </span>
                <span className="block font-semibold truncate">
                  {s.kind === 'empty' && <span className="text-ink-faint font-normal">Empty — a bot will play</span>}
                  {s.kind === 'bot' && `${s.name} (bot · ${OPPONENT_PROFILES[s.profile].name.replace(' (experimental)', '')})`}
                  {s.kind === 'human' && (
                    <>
                      {s.name}
                      {s.you ? ' (you)' : ''}
                      {s.host ? ' · host' : ''}
                      {!s.connected && <span className="text-crak font-normal"> · away</span>}
                    </>
                  )}
                </span>
              </span>
              {s.kind !== 'human' && (
                <span className="flex gap-1">
                  <Chip onClick={() => net.takeSeat(i)} className="h-7 text-xs">
                    Sit here
                  </Chip>
                  {room.youAreHost && s.kind === 'bot' && (
                    <Chip onClick={() => net.setBot(i, null)} className="h-7 text-xs">
                      Remove bot
                    </Chip>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex flex-wrap items-center gap-3">
        {room.youAreHost ? (
          <Button size="lg" onClick={net.start} data-testid="online-start">
            Start the game →
          </Button>
        ) : (
          <span className="text-sm text-ink-soft">Waiting for the host to start the game…</span>
        )}
        <Button variant="ghost" onClick={() => { net.leave(); onHome(); }}>
          Leave
        </Button>
        <span className="text-xs text-ink-faint">Share the code or link with up to three friends. Empty seats get {OPPONENT_PROFILES[room.botProfile].name.toLowerCase()} bots.</span>
      </div>
    </div>
  );
}
