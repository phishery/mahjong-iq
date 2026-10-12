import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCard } from '../engine/card/parser';
import type { HandVariant, LoadedCard } from '../engine/card/schema';
import { DEMO_CARD_JSON, getDemoCard } from '../engine/cards';
import { MODE_INFO, type RoundState } from '../engine/game';
import { emptyProgress, pickPracticeCategory, type ProgressData } from '../engine/progress';
import { createRng, randomSeed } from '../engine/rng';
import { countsFromIds } from '../engine/tiles';
import { CardReference } from './CardReference';
import { cx } from './components';
import { ProgressDialog, SettingsDialog } from './Dialogs';
import { GameScreen, type Drill } from './GameScreen';
import { Home, type StartRequest } from './Home';
import {
  loadCustomCard,
  loadProgress,
  loadSettings,
  resetProgress,
  saveCustomCard,
  saveProgress,
  saveSettings,
  SimClient,
  type Settings,
} from './lib';
import { Report } from './Report';
import { useGame } from './useGame';

type Screen = 'home' | 'game' | 'report';

function initialCard(): { card: LoadedCard; json: unknown; custom: boolean } {
  const custom = loadCustomCard();
  if (custom) {
    try {
      return { card: loadCard(custom), json: custom, custom: true };
    } catch {
      saveCustomCard(null);
    }
  }
  return { card: getDemoCard(), json: DEMO_CARD_JSON, custom: false };
}

export function App() {
  const [{ card, json: cardJson, custom }, setCardState] = useState(initialCard);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [progress, setProgressState] = useState<ProgressData>(loadProgress);
  const [screen, setScreen] = useState<Screen>('home');
  const [drill, setDrill] = useState<Drill>('none');
  const [lastStart, setLastStart] = useState<StartRequest | null>(null);
  const [roundNo, setRoundNo] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [focus, setFocus] = useState<HandVariant | null>(null);
  const sessionStart = useRef(loadProgress().history.length);

  const simRef = useRef<SimClient | null>(null);
  if (!simRef.current && typeof Worker !== 'undefined') simRef.current = new SimClient(cardJson, card.def.id);
  useEffect(() => {
    simRef.current?.setCard(cardJson, card.def.id);
  }, [cardJson, card]);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);
  const updateProgress = useCallback((fn: (p: ProgressData) => ProgressData) => {
    setProgressState((p) => {
      const next = fn(p);
      saveProgress(next);
      return next;
    });
  }, []);

  const game = useGame(card, simRef.current, settings, updateProgress);

  const start = useCallback(
    (req: StartRequest) => {
      let targets = req.targetCategories;
      if (req.drill === 'targeted' && (!targets || targets.length === 0)) {
        targets = [pickPracticeCategory(progress, card, createRng(randomSeed()))];
      }
      setDrill(req.drill);
      setLastStart({ ...req, targetCategories: req.drill === 'targeted' && !req.targetCategories?.length ? [] : req.targetCategories });
      setFocus(null);
      setRoundNo((n) => n + 1);
      game.start({
        mode: req.mode,
        length: req.length,
        seed: req.seed ?? randomSeed(),
        opponents: settings.opponents,
        courtesy: settings.courtesy,
        targetCategories: targets,
      });
      setScreen('game');
    },
    [game, settings, progress, card],
  );

  const again = useCallback(() => {
    if (lastStart) start({ ...lastStart, seed: undefined });
  }, [lastStart, start]);

  // Keyboard shortcut: Enter on the "done" state goes to the next rack in drills.
  const round = game.round;

  const importCard = (json: unknown) => {
    const loaded = loadCard(json);
    saveCustomCard(json);
    setCardState({ card: loaded, json, custom: true });
    game.quit();
    setScreen('home');
  };
  const resetCard = () => {
    saveCustomCard(null);
    setCardState({ card: getDemoCard(), json: DEMO_CARD_JSON, custom: false });
    game.quit();
    setScreen('home');
  };

  const rackCounts = useMemo(() => (round ? countsFromIds(round.racks.you) : null), [round]);
  const anim = settings.animations === 'off' ? 'no-anim' : '';

  return (
    <div className={cx('min-h-full flex flex-col', anim)}>
      <Header
        screen={screen}
        round={round}
        roundNo={roundNo}
        onHome={() => {
          setScreen('home');
          setFocus(null);
        }}
        onCard={() => setCardOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        official={card.def.source.official}
      />
      <main className="flex-1">
        {screen === 'home' && (
          <Home
            card={card}
            settings={settings}
            setSettings={setSettings}
            progress={progress}
            onStart={start}
            onOpenCard={() => setCardOpen(true)}
            onOpenProgress={() => setProgressOpen(true)}
            sessionStart={sessionStart.current}
          />
        )}
        {screen === 'game' && round && (
          <GameScreen
            card={card}
            game={game}
            settings={settings}
            drill={drill}
            onReport={() => setScreen('report')}
            onNextRack={again}
            onOpenCard={() => setCardOpen(true)}
            focus={focus}
            setFocus={setFocus}
          />
        )}
        {screen === 'report' && round && (
          <Report card={card} round={round} progress={progress} onAgain={again} onHome={() => setScreen('home')} />
        )}
      </main>
      <footer className="text-center text-[11px] text-ink-faint py-4 px-4">
        Mahjong IQ is an independent training tool. {card.def.source.official ? card.def.source.attribution : 'The bundled card is fictional and not affiliated with the National Mah Jongg League.'}
      </footer>

      <CardReference
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        card={card}
        rack={screen === 'game' ? rackCounts : null}
        onFocus={setFocus}
        onImport={importCard}
        onResetCard={resetCard}
        customActive={custom}
        revealCounts={!round || round.phase !== 'rank'}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />
      <ProgressDialog
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        progress={progress}
        card={card}
        onReset={() => {
          resetProgress();
          setProgressState(emptyProgress());
        }}
      />
    </div>
  );
}

function Header({
  screen,
  round,
  roundNo,
  onHome,
  onCard,
  onSettings,
  official,
}: {
  screen: Screen;
  round: RoundState | null;
  roundNo: number;
  onHome: () => void;
  onCard: () => void;
  onSettings: () => void;
  official: boolean;
}) {
  const inGame = screen !== 'home' && round;
  const steps = round ? stageSteps(round) : [];
  const credit = round && round.decisions.length ? round.decisions.reduce((a, d) => a + d.grade.credit, 0) / round.decisions.length : null;
  return (
    <header className="sticky top-0 z-30 bg-ivory/90 backdrop-blur border-b border-line">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
        <button type="button" onClick={onHome} className="flex items-center gap-2 shrink-0" aria-label="Mahjong IQ home">
          <span className="w-8 h-9 rounded-lg bg-jade-600 text-white font-display font-bold flex items-center justify-center text-sm shadow-sm">IQ</span>
          <span className="font-display text-xl font-semibold hidden sm:inline">
            Mahjong <span className="text-jade-600">IQ</span>
          </span>
        </button>
        {inGame && (
          <>
            <span className="hidden md:inline rounded-full bg-jade-50 text-jade-700 text-xs font-semibold px-2.5 py-1" data-testid="mode-pill">
              {MODE_INFO[round!.config.mode].name}
            </span>
            <span className="hidden md:inline text-xs text-ink-faint">Round {roundNo}</span>
            <ol className="flex items-center gap-1 overflow-x-auto mx-auto" aria-label="Charleston stages" data-testid="stepper">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 && <span className={cx('w-2 sm:w-4 h-px', s.state === 'todo' ? 'bg-line' : 'bg-jade-300')} />}
                  <span
                    title={s.title}
                    className={cx(
                      'h-6 min-w-6 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center',
                      s.state === 'done' && 'bg-jade-600 text-white',
                      s.state === 'current' && 'bg-white text-jade-700 ring-2 ring-jade-500',
                      s.state === 'todo' && 'bg-line/70 text-ink-faint',
                      s.optional && s.state === 'todo' && 'border border-dashed border-ink-faint/40 bg-transparent',
                    )}
                  >
                    {s.short}
                  </span>
                </li>
              ))}
            </ol>
            {credit !== null && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-ink-soft shrink-0" title="Average decision credit so far this round">
                <span className="w-16 h-1.5 rounded-full bg-line overflow-hidden">
                  <span className="block h-full bg-jade-500" style={{ width: `${credit * 100}%` }} />
                </span>
                {Math.round(credit * 100)}
              </span>
            )}
          </>
        )}
        <div className={cx('flex items-center gap-1 shrink-0', !inGame && 'ml-auto')}>
          {!official && <span className="hidden lg:inline text-[11px] text-[#7a5a14] bg-[#fbf3e1] rounded-full px-2 py-0.5 mr-1">Demo card</span>}
          <button type="button" onClick={onCard} className="h-9 px-3 rounded-lg text-sm font-medium text-ink-soft hover:bg-black/5" data-testid="header-card">
            Card
          </button>
          <button type="button" onClick={onSettings} className="h-9 w-9 rounded-lg text-ink-soft hover:bg-black/5" aria-label="Settings" data-testid="settings">
            ⚙
          </button>
        </div>
      </div>
    </header>
  );
}

interface StageStep {
  short: string;
  title: string;
  state: 'done' | 'current' | 'todo';
  optional?: boolean;
}

function stageSteps(round: RoundState): StageStep[] {
  const steps: StageStep[] = [{ short: 'Deal', title: 'Opening rack', state: 'todo' }];
  round.schedule.forEach((s) => steps.push({ short: s.short, title: s.label, state: 'todo' }));
  if (round.secondCharleston === 'pending') {
    ['L', 'A', 'R'].forEach((x, i) => steps.push({ short: x, title: ['Second Left', 'Second Across', 'Last Right'][i], state: 'todo', optional: true }));
  }
  if (round.courtesy.status !== 'na' && !(round.courtesy.status === 'done' && round.courtesy.agreed === 0)) {
    steps.push({ short: 'C', title: 'Courtesy pass', state: 'todo', optional: round.courtesy.status === 'pending' });
  }
  // Decision points completed = decisions made; current = the next one.
  const doneCount = round.phase === 'done' ? steps.length : round.decisions.length;
  return steps.map((s, i) => ({ ...s, state: i < doneCount ? 'done' : i === doneCount ? 'current' : 'todo' }));
}
