import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HandVariant, LoadedCard } from '../engine/card/schema';
import { RULES } from '../engine/charleston';
import { currentLevel, decisionLabel } from '../engine/game';
import { simSettingsFrom, type Settings } from './lib';
import { countsFromIds, JOKER_INDEX, KIND_OF_ID, type TileId } from '../engine/tiles';
import { mixSeed } from '../engine/rng';
import { CardDock } from './CardDock';
import type { CardFilter } from './CardHands';
import { Button, Chip, cx, Panel, Segmented, useMediaQuery } from './components';
import { Rack } from './Rack';
import { FeedbackPanel, LastPassCard, RankingReview } from './Review';
import { StrategyPanel } from './StrategyPanel';
import type { GameApi } from './useGame';

export type Drill = 'none' | 'speed' | 'exact' | 'targeted';

const DIR_ARROW = { right: '→', across: '↑', left: '←' } as const;
const DIR_NAME = { right: 'Right', across: 'Across', left: 'Left' } as const;

export function GameScreen({
  card,
  game,
  settings,
  drill,
  onReport,
  onNextRack,
  onOpenCard,
  focus,
  setFocus,
}: {
  card: LoadedCard;
  game: GameApi;
  settings: Settings;
  drill: Drill;
  onReport: () => void;
  onNextRack: () => void;
  onOpenCard: () => void;
  focus: HandVariant | null;
  setFocus: (v: HandVariant | null) => void;
}) {
  const round = game.round!;
  const [selected, setSelected] = useState<TileId[]>([]);
  const [blind, setBlind] = useState(0);
  const [highlight, setHighlight] = useState<'mine' | 'engine' | 'off'>('mine');
  const [elapsed, setElapsed] = useState(0);
  const [milestoneSeen, setMilestoneSeen] = useState<string>('');

  const phaseKey = `${round.phase}|${round.stepIndex}|${round.decisions.length}`;
  useEffect(() => {
    setSelected([]);
    setBlind(0);
  }, [phaseKey]);

  // Speed-drill timer.
  useEffect(() => {
    if (drill !== 'speed' || round.phase !== 'rank') return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 100) / 10), 100);
    return () => clearInterval(id);
  }, [drill, round.phase, round.decisions.length]);

  const level = currentLevel(round);
  const last = game.lastDecision;
  const prevDecision = round.decisions.length >= 2 ? round.decisions[round.decisions.length - 2] : undefined;
  const lastPass = round.passes[round.passes.length - 1];
  const rackCounts = useMemo(() => countsFromIds(round.racks.you), [round.racks.you]);
  // Card docked under the rack on larger screens (phones keep the drawer).
  const docked = useMediaQuery('(min-width: 1024px)');
  const dockRef = useRef<HTMLElement>(null);
  const ranking = round.phase === 'rank';
  const [dockOpen, setDockOpen] = useState(true);
  const [dockFilter, setDockFilter] = useState<CardFilter>('all');
  const [dockLine, setDockLine] = useState<string | null>(null);
  /** Sections from the most recent ranking, in the order they were ranked. */
  const mySections = useMemo(() => {
    const d = round.decisions[round.decisions.length - 1];
    const ids = (d?.picks ?? []).map((p) =>
      p.level === 'category' ? p.id : p.level === 'line' ? card.lineById.get(p.id)?.category : card.variantById.get(p.id)?.categoryId,
    );
    return [...new Set(ids.filter((id): id is string => !!id))];
  }, [round.decisions, card]);
  useEffect(() => {
    // Open the card for each new ranking (on your sections once you have some); fold it for the analysis.
    setDockOpen(ranking);
    setDockLine(null);
    if (ranking) setDockFilter(level !== 'category' && mySections.length ? 'mine' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking, round.decisions.length]);
  const browseCard = useCallback(
    (categoryId: string, lineId?: string) => {
      // A line inside "Your sections" is outlined in place rather than narrowing the card.
      setDockFilter((f) => (lineId && f === 'mine' && mySections.includes(categoryId) ? f : categoryId));
      setDockLine(lineId ?? null);
      setDockOpen(true);
    },
    [mySections],
  );
  const openCard = () => {
    if (!docked) return onOpenCard();
    setDockOpen(true);
    requestAnimationFrame(() => dockRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const jokerIds = useMemo(() => new Set(round.racks.you.filter((id) => KIND_OF_ID[id] === JOKER_INDEX)), [round.racks.you]);

  // In review/pass phases, highlight the player's #1 (or the engine's best) hand to support passing.
  const reviewFocus = useMemo(() => {
    if (!last || round.phase === 'rank' || highlight === 'off') return null;
    if (highlight === 'engine') return last.grade.top[0]?.best.variant ?? null;
    return last.grade.picks[0].candidate?.best.variant ?? null;
  }, [last, round.phase, highlight]);
  const rackFocus = focus ?? reviewFocus;

  const step = round.phase === 'pass' ? round.schedule[round.stepIndex] : null;
  const required =
    round.phase === 'pass' ? RULES.tilesPerPass - blind : round.phase === 'courtesy-select' ? (round.courtesy.agreed ?? 0) : 0;
  const selectable = (round.phase === 'pass' || round.phase === 'courtesy-select') && !game.anim;

  const toggle = useCallback(
    (id: TileId) => {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= required ? [...s.slice(1), id] : [...s, id]));
    },
    [required],
  );

  // Hybrid milestones.
  const milestone =
    round.config.mode === 'hybrid' && round.phase === 'rank' && (round.decisions.length === 2 || round.decisions.length === 3)
      ? round.decisions.length === 2
        ? {
            id: 'line',
            title: 'Milestone: from categories to card lines',
            text: 'Spotting a promising section of the card is the first skill. Now name the specific line you would pursue — and remember, you may still switch sections if the tiles say so.',
          }
        : {
            id: 'variant',
            title: 'Milestone: exact hands',
            text: 'Strong players commit to exact suits and numbers only when the tiles justify it. Choose the line plus its suits and starting number.',
          }
      : null;

  const prevPicks = last && round.phase === 'rank' ? last.picks : null;
  const simSettings = settings.simulation ? simSettingsFrom(settings, mixSeed(round.config.seed, 9000)) : null;

  return (
    <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
      <div className="space-y-4 min-w-0">
        {milestone && milestoneSeen !== `${round.startedAt}|${milestone.id}` && (
          <div className="rounded-2xl border border-jade-200 bg-gradient-to-r from-jade-50 to-white px-4 py-3 flex items-start gap-3 animate-fade-up" data-testid="milestone">
            <span className="text-2xl">🎓</span>
            <div className="flex-1">
              <p className="font-display text-lg font-semibold text-jade-800">{milestone.title}</p>
              <p className="text-sm text-ink-soft">{milestone.text}</p>
            </div>
            <button type="button" className="text-ink-faint hover:text-ink text-sm" onClick={() => setMilestoneSeen(`${round.startedAt}|${milestone.id}`)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        <Panel>
          <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-xl font-semibold" data-testid="stage-title">
                {round.phase === 'rank' ? decisionLabel(round) : last?.stepLabel}
              </h1>
              <span className="rounded-full bg-jade-50 text-jade-700 text-xs font-semibold px-2.5 py-1">
                {round.phase === 'rank' ? `Rank ${level === 'category' ? 'categories' : level === 'line' ? 'card lines' : 'exact hands'}` : 'Review & pass'}
              </span>
              {round.selectedDeal && (
                <span className="rounded-full bg-[#fbf3e1] text-[#7a5a14] text-xs font-semibold px-2.5 py-1" title="This rack was deliberately selected for targeted practice, not dealt from an unbiased random distribution.">
                  Selected rack
                </span>
              )}
              {drill === 'speed' && round.phase === 'rank' && (
                <span className="rounded-full bg-ink text-white text-xs font-semibold px-2.5 py-1 tabular-nums">⏱ {elapsed.toFixed(1)}s</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {round.phase !== 'rank' && last && (
                <Segmented
                  value={highlight}
                  onChange={setHighlight}
                  options={[
                    { value: 'mine', label: 'My #1' },
                    { value: 'engine', label: 'Engine’s best' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              )}
              <Button variant="secondary" size="sm" onClick={openCard} data-testid="open-card">
                Card
              </Button>
            </div>
          </div>
          <div className="px-3 sm:px-4 pb-4 pt-2">
            <Rack
              tiles={round.racks.you}
              selectable={selectable}
              selected={selected}
              onToggle={toggle}
              incoming={round.phase === 'rank' ? game.incoming : []}
              outgoing={game.anim?.outgoing ?? []}
              outgoingDirection={game.anim?.direction}
              focusVariant={rackFocus}
              showLabels={settings.tileLabels}
              disabledIds={jokerIds}
            />
            {round.phase === 'rank' && lastPass && round.decisions.length === round.passes.length && (
              <div className="mt-4">
                <LastPassCard pass={lastPass} showLabels={settings.tileLabels} />
              </div>
            )}
          </div>
          <ActionBar
            game={game}
            step={step}
            selected={selected}
            required={required}
            blind={blind}
            setBlind={(b) => {
              setBlind(b);
              setSelected((s) => s.slice(0, RULES.tilesPerPass - b));
            }}
            onReport={onReport}
            onNextRack={onNextRack}
            level={level}
            drill={drill}
          />
        </Panel>

        {game.reviewing && last && (
          <FeedbackPanel
            key={`${round.startedAt}-${last.index}`}
            card={card}
            decision={last}
            prev={prevDecision}
            pass={prevDecision ? round.passes[last.index - 1] : undefined}
          />
        )}
        {round.phase === 'rank' && round.decisions.length === 0 && (
          <p className="text-xs text-ink-faint px-1">
            Tip: before choosing, count your pairs, Jokers and Flowers, and notice which suit you hold most. Then ask which card sections use those tiles.
          </p>
        )}
        {docked && (
          <CardDock
            ref={dockRef}
            card={card}
            rack={rackCounts}
            revealCounts={!ranking}
            onFocus={setFocus}
            open={dockOpen}
            onToggle={() => setDockOpen((o) => !o)}
            filter={dockFilter}
            onFilter={(f) => {
              setDockFilter(f);
              setDockLine(null);
            }}
            mine={mySections}
            highlightLineId={dockLine}
          />
        )}
      </div>

      <aside className="lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-88px)] flex flex-col min-h-0">
        {round.phase === 'rank' ? (
          <StrategyPanel
            card={card}
            level={level}
            previous={prevPicks}
            rack={rackCounts}
            submitting={game.submitting}
            askConfidence={settings.confidence}
            onSubmit={game.rank}
            onFocus={setFocus}
            decisionId={`${round.startedAt}-${round.decisions.length}`}
            onBrowse={browseCard}
            preferredCategories={level === 'category' ? [] : mySections}
          />
        ) : (
          last && <RankingReview card={card} decision={last} simSettings={simSettings} />
        )}
        {round.phase === 'rank' && game.simEnabled && (
          <p className="mt-2 px-1 text-[11px] text-ink-faint" data-testid="sim-status">
            {game.simStatus === 'running' ? 'Running simulations in the background…' : game.simStatus === 'ready' ? 'Simulations ready — grading will use completion probabilities where precise enough.' : game.simStatus === 'error' ? 'Simulation unavailable — grading uses heuristic scores.' : ''}
          </p>
        )}
      </aside>
    </div>
  );
}

function ActionBar({
  game,
  step,
  selected,
  required,
  blind,
  setBlind,
  onReport,
  onNextRack,
  level,
  drill,
}: {
  game: GameApi;
  step: { label: string; direction: 'right' | 'across' | 'left'; blindAllowed: boolean } | null;
  selected: TileId[];
  required: number;
  blind: number;
  setBlind: (b: number) => void;
  onReport: () => void;
  onNextRack: () => void;
  level: string;
  drill: Drill;
}) {
  const round = game.round!;
  const base = 'border-t border-line px-4 py-3 flex flex-wrap items-center gap-3 bg-paper/50 rounded-b-2xl';
  if (game.error) {
    return (
      <div className={cx(base, 'text-sm text-crak')} role="alert">
        {game.error}
        <Button size="sm" variant="ghost" onClick={() => game.setError(null)}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (round.phase === 'rank') {
    return (
      <div className={base}>
        <span className="text-sm text-ink-soft">
          Rank your top three {level === 'category' ? 'categories' : level === 'line' ? 'card lines' : 'exact hands'} in the panel <span className="hidden lg:inline">on the right, using the card below</span>
          <span className="lg:hidden">below</span>. You’ll pass tiles after you lock it in.
        </span>
      </div>
    );
  }
  if (round.phase === 'pass' && step) {
    return (
      <div className={base}>
        <span className="text-sm font-semibold text-ink">
          {step.label}: select {required} tile{required === 1 ? '' : 's'} to pass {DIR_NAME[step.direction]} {DIR_ARROW[step.direction]}
        </span>
        {step.blindAllowed && (
          <span className="flex items-center gap-1.5 text-xs text-ink-soft" title="Blind pass: forward some of the tiles you are about to receive without looking at them.">
            Blind pass:
            {[0, 1, 2, 3].map((b) => (
              <Chip key={b} active={blind === b} onClick={() => setBlind(b)} className="h-7 w-8 px-0 text-xs" testId={`blind-${b}`}>
                {b}
              </Chip>
            ))}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-faint tabular-nums">
            {selected.length}/{required}
          </span>
          <Button disabled={selected.length !== required || !!game.anim} onClick={() => game.pass(selected, blind)} data-testid="pass-button">
            Pass {DIR_NAME[step.direction]} {DIR_ARROW[step.direction]}
          </Button>
        </span>
      </div>
    );
  }
  if (round.phase === 'vote') {
    return (
      <div className={base}>
        <span className="text-sm text-ink">First Charleston complete. Continue to the optional second Charleston (Left, Across, Right)? Any player may stop it.</span>
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => game.vote(false)} data-testid="vote-stop">
            Stop here
          </Button>
          <Button onClick={() => game.vote(true)} data-testid="vote-continue">
            Continue
          </Button>
        </span>
      </div>
    );
  }
  if (round.phase === 'courtesy-request') {
    const stopped = round.secondCharleston === 'no' && round.votes;
    const who = stopped ? (Object.entries(round.votes!).filter(([, v]) => !v).map(([s]) => (s === 'you' ? 'You' : s[0].toUpperCase() + s.slice(1))) as string[]) : [];
    return (
      <div className={base}>
        {stopped && <span className="text-xs text-ink-faint w-full">{who.join(' and ')} stopped the second Charleston.</span>}
        <span className="text-sm text-ink">Optional courtesy pass with Across — how many tiles would you like to exchange?</span>
        <span className="ml-auto flex gap-1.5">
          {[0, 1, 2, 3].map((n) => (
            <Button key={n} variant={n === 0 ? 'secondary' : 'primary'} size="sm" onClick={() => game.courtesyAsk(n)} data-testid={`courtesy-${n}`}>
              {n === 0 ? 'None' : n}
            </Button>
          ))}
        </span>
      </div>
    );
  }
  if (round.phase === 'courtesy-select') {
    const c = round.courtesy;
    return (
      <div className={base}>
        <span className="text-sm text-ink">
          You asked for {c.requested}, Across asked for {c.partnerWants} — exchanging <strong>{c.agreed}</strong>. Select {c.agreed} tile{c.agreed === 1 ? '' : 's'}.
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-faint">
            {selected.length}/{required}
          </span>
          <Button disabled={selected.length !== required || !!game.anim} onClick={() => game.courtesyPass(selected)} data-testid="courtesy-pass">
            Exchange ↑
          </Button>
        </span>
      </div>
    );
  }
  if (round.phase === 'done') {
    const opening = round.config.length === 'opening';
    const stoppedMsg =
      round.courtesy.status === 'done' && round.courtesy.agreed === 0 && round.courtesy.requested !== undefined
        ? `Courtesy pass: you asked for ${round.courtesy.requested}, Across asked for ${round.courtesy.partnerWants} — no exchange.`
        : round.secondCharleston === 'no' && round.votes
          ? 'The second Charleston was stopped.'
          : null;
    return (
      <div className={base}>
        <span className="text-sm text-ink">
          {stoppedMsg ? `${stoppedMsg} ` : ''}
          {opening ? 'Graded! Ready for the next rack?' : 'Charleston complete — that’s the end of this round.'}
        </span>
        <span className="ml-auto flex gap-2">
          {opening ? (
            <>
              <Button variant="secondary" onClick={onReport} data-testid="see-report">
                Report
              </Button>
              <Button onClick={onNextRack} data-testid="next-rack" autoFocus>
                {drill === 'speed' ? 'Next rack (speed)' : 'Next rack'} →
              </Button>
            </>
          ) : (
            <Button onClick={onReport} data-testid="see-report" autoFocus>
              See round report →
            </Button>
          )}
        </span>
      </div>
    );
  }
  return <div className={base} />;
}


