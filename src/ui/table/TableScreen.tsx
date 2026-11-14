import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HandVariant, LoadedCard } from '../../engine/card/schema';
import type { Exposure } from '../../engine/table/hand';
import type { TableAction } from '../../engine/table/table';
import type { TableView } from '../../engine/table/view';
import { countsFromIds, JOKER_INDEX, KIND_OF_ID, kindOfTile, type TileId } from '../../engine/tiles';
import { CardHands } from '../CardHands';
import { Button, Chip, cx, Drawer, Panel, PatternText } from '../components';
import { Rack } from '../Rack';
import { Tile, TileBack } from '../Tile';
import { describeEvent, DIR_ARROW, groupName, positionOf, possessive, seatAt, seatLabel, tileName, windName, type Position } from './describe';

export interface TableScreenProps {
  card: LoadedCard;
  view: TableView;
  act: (a: TableAction) => void;
  error: string | null;
  clearError: () => void;
  /** Epoch ms when the current call window closes (online play). */
  callDeadline?: number | null;
  /** Suggested discard (solo play). */
  hint?: () => TileId | null;
  showLabels: boolean;
  /** Extra controls shown when the hand is over (play again, next hand, …). */
  endActions?: ReactNode;
  /** Shown above the table (room code, scores, …). */
  banner?: ReactNode;
}

const isJoker = (id: TileId) => KIND_OF_ID[id] === JOKER_INDEX;

function TileBacks({ n }: { n: number }) {
  return (
    <span className="inline-flex flex-wrap gap-[2px]" aria-label={`${n} concealed tiles`}>
      {Array.from({ length: n }, (_, i) => (
        <TileBack key={i} width={10} />
      ))}
    </span>
  );
}

function ExposureTiles({ e, size = 'xs' }: { e: Exposure; size?: 'xs' | 'sm' }) {
  return (
    <span className="inline-flex gap-[2px] rounded-md bg-paper px-1 py-1 border border-line" title={`${groupName(e.tiles.length)} of ${tileName(e.calledTile)}`}>
      {e.tiles.map((id) => (
        <Tile key={id} kind={kindOfTile(id)} size={size} />
      ))}
    </span>
  );
}

function OpponentCard({ view, pos, active }: { view: TableView; pos: Position; active: boolean }) {
  const seat = seatAt(view, pos);
  const s = view.seats[seat];
  return (
    <div
      className={cx('rounded-2xl border bg-white px-3 py-2.5 min-w-0', active ? 'border-jade-400 ring-2 ring-jade-200' : 'border-line')}
      data-testid={`seat-${pos}`}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="w-6 h-6 rounded-full bg-jade-50 text-jade-700 text-[11px] font-bold flex items-center justify-center shrink-0" title={windName(view, seat)}>
          {s.wind}
        </span>
        <span className="font-semibold truncate">{s.name}</span>
        <span className="hidden sm:inline text-[11px] text-ink-faint shrink-0">{s.bot ? 'bot' : 'player'}</span>
        {s.pending && view.phase.name !== 'ended' && <span className="ml-auto w-2 h-2 rounded-full bg-gold animate-pulse shrink-0" title="Thinking…" />}
      </div>
      <div className="mt-2">
        <TileBacks n={s.concealedCount} />
      </div>
      {s.exposures.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.exposures.map((e, i) => (
            <ExposureTiles key={i} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function phaseText(view: TableView): string {
  const ph = view.phase;
  const me = view.legal.toAct;
  switch (ph.name) {
    case 'charleston':
      return me ? `${ph.label}: choose tiles to pass ${ph.direction} ${DIR_ARROW[ph.direction]}` : `${ph.label}: waiting for the other players…`;
    case 'vote':
      return me ? 'First Charleston done. Continue with a second Charleston?' : 'Waiting for everyone to vote on the second Charleston…';
    case 'courtesy-request':
      return me ? 'Courtesy pass with the player across: how many tiles?' : 'Waiting for courtesy requests…';
    case 'courtesy-select':
      return me ? `Choose ${ph.agreed} tile${ph.agreed === 1 ? '' : 's'} for the courtesy pass` : 'Waiting for the courtesy pass…';
    case 'turn':
      if (ph.seat === view.you) return ph.called ? 'You called — now discard a tile.' : 'Your turn — discard a tile.';
      return `${seatLabel(view, ph.seat)}’s turn.`;
    case 'calls':
      return me ? `${seatLabel(view, ph.by)} discarded ${tileName(ph.tile)} — call it?` : `${seatLabel(view, ph.by)} discarded ${tileName(ph.tile)}.`;
    case 'ended':
      return ph.result.type === 'wall' ? 'Wall game.' : `${seatLabel(view, ph.result.winner!)} declared Mahjong!`;
  }
}

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className="text-xs tabular-nums text-ink-faint">{left}s</span>;
}

export function TableScreen({ card, view, act, error, clearError, callDeadline, hint, showLabels, endActions, banner }: TableScreenProps) {
  const [selected, setSelected] = useState<TileId[]>([]);
  const [blind, setBlind] = useState(0);
  const [hinted, setHinted] = useState<TileId | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [focus, setFocus] = useState<HandVariant | null>(null);
  const ph = view.phase;
  const phaseKey = `${ph.name}:${'label' in ph ? ph.label : ''}:${view.legal.toAct}`;

  // A fresh selection for every decision.
  useEffect(() => {
    setSelected([]);
    setBlind(0);
    setHinted(null);
  }, [phaseKey]);

  const required = ph.name === 'charleston' ? 3 - blind : ph.name === 'courtesy-select' ? ph.agreed : ph.name === 'turn' ? 1 : 0;
  const passing = view.legal.toAct && (ph.name === 'charleston' || ph.name === 'courtesy-select');
  const discarding = view.legal.discard;
  const selectable = passing || discarding;
  const jokerIds = useMemo(() => new Set(view.hand.filter(isJoker)), [view.hand]);

  const toggle = (id: TileId) => {
    if (discarding) {
      setSelected((s) => (s[0] === id ? [] : [id]));
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= required ? s : [...s, id]));
  };

  const lastDiscard = view.floor[view.floor.length - 1] ?? null;
  const callTile = ph.name === 'calls' ? ph.tile : null;
  const activeSeat = ph.name === 'turn' ? ph.seat : null;
  const events = view.events.map((e) => ({ n: e.n, text: describeEvent(view, e) })).filter((e) => e.text).slice(-7).reverse();
  const youSeat = view.seats[view.you];

  const actionBar = (() => {
    const base = 'border-t border-line px-4 py-3 flex flex-wrap items-center gap-3 bg-paper/50 rounded-b-2xl';
    if (error) {
      return (
        <div className={cx(base, 'text-sm text-crak')} role="alert">
          {error}
          <Button size="sm" variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      );
    }
    if (ph.name === 'ended') return <div className={base}>{endActions}</div>;
    if (!view.legal.toAct) {
      return (
        <div className={base}>
          <span className="text-sm text-ink-soft">{phaseText(view)}</span>
        </div>
      );
    }
    switch (ph.name) {
      case 'charleston':
        return (
          <div className={base}>
            <span className="text-sm font-semibold">{phaseText(view)}</span>
            {ph.blindAllowed && (
              <span className="flex items-center gap-1.5 text-xs text-ink-soft" title="Blind pass: forward tiles you are about to receive without looking at them.">
                Blind pass:
                {[0, 1, 2, 3].map((b) => (
                  <Chip key={b} active={blind === b} onClick={() => { setBlind(b); setSelected((s) => s.slice(0, 3 - b)); }} className="h-7 w-8 px-0 text-xs" testId={`blind-${b}`}>
                    {b}
                  </Chip>
                ))}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-ink-faint tabular-nums">
                {selected.length}/{required}
              </span>
              <Button disabled={selected.length !== required} onClick={() => act({ type: 'pass-tiles', tiles: selected, blind })} data-testid="table-pass">
                Pass {DIR_ARROW[ph.direction]}
              </Button>
            </span>
          </div>
        );
      case 'vote':
        return (
          <div className={base}>
            <span className="text-sm">{phaseText(view)} Any player may stop it.</span>
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => act({ type: 'vote', proceed: false })} data-testid="table-vote-stop">
                Stop here
              </Button>
              <Button onClick={() => act({ type: 'vote', proceed: true })} data-testid="table-vote-continue">
                Continue
              </Button>
            </span>
          </div>
        );
      case 'courtesy-request':
        return (
          <div className={base}>
            <span className="text-sm">{phaseText(view)}</span>
            <span className="ml-auto flex gap-1.5">
              {[0, 1, 2, 3].map((n) => (
                <Button key={n} size="sm" variant={n === 0 ? 'secondary' : 'primary'} onClick={() => act({ type: 'courtesy-request', count: n })} data-testid={`table-courtesy-${n}`}>
                  {n === 0 ? 'None' : n}
                </Button>
              ))}
            </span>
          </div>
        );
      case 'courtesy-select':
        return (
          <div className={base}>
            <span className="text-sm">{phaseText(view)}</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-ink-faint">
                {selected.length}/{required}
              </span>
              <Button disabled={selected.length !== required} onClick={() => act({ type: 'courtesy-tiles', tiles: selected })} data-testid="table-courtesy-pass">
                Exchange ↑
              </Button>
            </span>
          </div>
        );
      case 'turn':
        return (
          <div className={base}>
            <span className="text-sm font-semibold">{phaseText(view)}</span>
            {view.legal.jokerSwaps.map((s) => (
              <Button
                key={`${s.seat}-${s.exposure}`}
                size="sm"
                variant="secondary"
                onClick={() => act({ type: 'joker-swap', give: s.give, seat: s.seat, exposure: s.exposure })}
                data-testid="table-joker-swap"
              >
                Swap {tileName(s.give)} for {possessive(view, s.seat)} Joker
              </Button>
            ))}
            <span className="ml-auto flex items-center gap-2">
              {hint && (
                <Button size="sm" variant="ghost" onClick={() => { const h = hint(); setHinted(h); if (h !== null) setSelected([h]); }} data-testid="table-hint">
                  Suggest
                </Button>
              )}
              {view.legal.mahjong && (
                <Button onClick={() => act({ type: 'mahjong' })} className="bg-gold hover:bg-[#b4871f]" data-testid="table-mahjong">
                  Mahjong!
                </Button>
              )}
              <Button disabled={selected.length !== 1} onClick={() => act({ type: 'discard', tile: selected[0] })} data-testid="table-discard">
                Discard {selected.length === 1 ? tileName(selected[0]) : ''}
              </Button>
            </span>
          </div>
        );
      case 'calls':
        return (
          <div className={base}>
            {callTile !== null && <Tile kind={kindOfTile(callTile)} size="md" />}
            <span className="text-sm font-semibold">{phaseText(view)}</span>
            {callDeadline ? <Countdown deadline={callDeadline} /> : null}
            <span className="ml-auto flex flex-wrap gap-2">
              {view.legal.calls.map((c) =>
                c.type === 'mahjong' ? (
                  <Button key="mj" onClick={() => act({ type: 'call', response: { type: 'mahjong' } })} className="bg-gold hover:bg-[#b4871f]" data-testid="table-call-mahjong">
                    Mahjong!
                  </Button>
                ) : (
                  <Button key={c.size} variant="secondary" onClick={() => act({ type: 'call', response: { type: 'expose', tiles: c.tiles } })} data-testid={`table-call-${c.size}`}>
                    Call for {groupName(c.size)}
                    {c.tiles.some(isJoker) ? ` (${c.tiles.filter(isJoker).length} Joker${c.tiles.filter(isJoker).length > 1 ? 's' : ''})` : ''}
                  </Button>
                ),
              )}
              <Button variant="ghost" onClick={() => act({ type: 'call', response: { type: 'pass' } })} data-testid="table-call-pass">
                Pass
              </Button>
            </span>
          </div>
        );
      default:
        return <div className={base} />;
    }
  })();

  return (
    <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-4 space-y-4" data-testid="table">
      {banner}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_1fr_minmax(0,240px)] lg:grid-rows-[auto_1fr]">
        <div className="grid grid-cols-3 gap-2 lg:contents">
          <div className="lg:col-start-1 lg:row-start-2">
            <OpponentCard view={view} pos="left" active={activeSeat === seatAt(view, 'left')} />
          </div>
          <div className="lg:col-start-2 lg:row-start-1">
            <OpponentCard view={view} pos="across" active={activeSeat === seatAt(view, 'across')} />
          </div>
          <div className="lg:col-start-3 lg:row-start-2">
            <OpponentCard view={view} pos="right" active={activeSeat === seatAt(view, 'right')} />
          </div>
        </div>
        <section className="lg:col-start-2 lg:row-start-2 rounded-2xl bg-jade-900/[0.04] border border-line p-3 min-h-[180px] flex flex-col" data-testid="floor">
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span>
              Wall: <strong className="text-ink tabular-nums">{view.wallCount}</strong> tiles
            </span>
            <span>
              Floor: <strong className="text-ink tabular-nums">{view.floor.length}</strong>
            </span>
            <button type="button" className="ml-auto font-semibold text-jade-700" onClick={() => setCardOpen(true)} data-testid="table-card">
              Card
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-[3px] content-start flex-1">
            {view.floor.map((d, i) => (
              <span key={d.tile} title={`${seatLabel(view, d.by)} · ${tileName(d.tile)}`}>
                <Tile kind={kindOfTile(d.tile)} id={d.tile} size={i === view.floor.length - 1 ? 'sm' : 'xs'} highlight={i === view.floor.length - 1 ? 'gold' : null} />
              </span>
            ))}
          </div>
          {lastDiscard && ph.name !== 'ended' && (
            <p className="mt-2 text-xs text-ink-soft">
              Last discard: <strong>{tileName(lastDiscard.tile)}</strong> by {seatLabel(view, lastDiscard.by)} ({positionOf(view, lastDiscard.by)})
            </p>
          )}
          <ol className="mt-2 space-y-0.5 text-xs text-ink-soft border-t border-line pt-2" data-testid="table-log">
            {events.map((e, i) => (
              <li key={e.n} className={i === 0 ? 'text-ink font-medium' : ''}>
                {e.text}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {ph.name === 'ended' && <ResultPanel card={card} view={view} />}

      <Panel
        title={
          <span className="flex items-center gap-2 normal-case tracking-normal">
            <span className="w-6 h-6 rounded-full bg-jade-600 text-white text-[11px] font-bold flex items-center justify-center">{youSeat.wind}</span>
            <span className="text-ink text-sm">You · {windName(view, view.you)}</span>
          </span>
        }
        className={cx(ph.name === 'turn' && ph.seat === view.you && 'ring-2 ring-jade-200')}
      >
        <div className="px-4 pb-4">
          {youSeat.exposures.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3" data-testid="your-exposures">
              {youSeat.exposures.map((e, i) => (
                <ExposureTiles key={i} e={e} size="sm" />
              ))}
            </div>
          )}
          <Rack
            tiles={view.hand}
            selectable={selectable}
            selected={selected}
            onToggle={toggle}
            incoming={view.drawn !== null ? [view.drawn] : []}
            focusVariant={focus}
            showLabels={showLabels}
            disabledIds={passing ? jokerIds : undefined}
          />
          {hinted !== null && discarding && (
            <p className="mt-2 text-xs text-ink-faint text-center">Suggested: discard {tileName(hinted)} — it keeps your strongest hands intact.</p>
          )}
        </div>
        {actionBar}
      </Panel>

      <Drawer open={cardOpen} onClose={() => setCardOpen(false)} title={card.def.title}>
        <CardHands card={card} rack={countsFromIds(view.hand)} revealCounts onFocus={setFocus} />
      </Drawer>
    </div>
  );
}

function ResultPanel({ card, view }: { card: LoadedCard; view: TableView }) {
  if (view.phase.name !== 'ended') return null;
  const r = view.phase.result;
  const line = r.lineId ? card.lineById.get(r.lineId) : undefined;
  return (
    <Panel title="Hand over" className="animate-fade-up">
      <div className="px-4 pb-4 space-y-4" data-testid="table-result">
        {r.type === 'wall' ? (
          <p className="font-display text-2xl font-semibold">Wall game — the tiles ran out before anyone finished.</p>
        ) : (
          <div>
            <p className="font-display text-2xl font-semibold">
              {r.winner === view.you ? 'You won!' : `${seatLabel(view, r.winner!)} won`}{' '}
              <span className="text-base font-sans font-normal text-ink-soft">
                {r.selfDrawn ? 'by drawing the winning tile' : `on ${possessive(view, r.from!)} discard`}
              </span>
            </p>
            {line && (
              <p className="mt-1 text-sm text-ink-soft flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">
                  {line.categoryName} #{line.line}
                </span>
                <PatternText line={line} />
                <span>
                  · {r.value} points{r.jokerless ? ', doubled for jokerless' : ''}
                </span>
              </p>
            )}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {view.seats.map((s) => (
            <div key={s.seat} className={cx('rounded-xl border p-2.5', r.winner === s.seat ? 'border-gold bg-[#fbf3e1]' : 'border-line')}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">
                  {seatLabel(view, s.seat)} <span className="text-ink-faint font-normal">· {windName(view, s.seat)}</span>
                </span>
                <span className={cx('tabular-nums font-semibold', r.payments[s.seat] > 0 ? 'text-jade-700' : r.payments[s.seat] < 0 ? 'text-crak' : 'text-ink-faint')}>
                  {r.payments[s.seat] > 0 ? '+' : ''}
                  {r.payments[s.seat]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 items-center">
                {s.exposures.map((e, i) => (
                  <ExposureTiles key={i} e={e} />
                ))}
                {(view.revealed?.[s.seat] ?? [])
                  .slice()
                  .sort((a, b) => KIND_OF_ID[a] - KIND_OF_ID[b])
                  .map((id) => (
                    <Tile key={id} kind={kindOfTile(id)} size="xs" />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

