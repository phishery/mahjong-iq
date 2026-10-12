import { useState } from 'react';
import type { LoadedCard } from '../engine/card/schema';
import { LENGTH_INFO, MODE_INFO, type Mode, type RoundLength } from '../engine/game';
import { summarize, type ProgressData } from '../engine/progress';
import { Button, Chip, cx, Panel } from './components';
import type { Drill } from './GameScreen';
import type { Settings } from './lib';
import { Tile } from './Tile';

export interface StartRequest {
  mode: Mode;
  length: RoundLength;
  drill: Drill;
  targetCategories?: string[];
  seed?: number;
}

export function parseChallengeCode(code: string): { mode: Mode; length: RoundLength; seed: number } | null {
  const m = /^MIQ-([BHA])([OTQF])-([0-9A-Z]+)$/i.exec(code.trim());
  if (!m) return null;
  const mode = ({ B: 'beginner', H: 'hybrid', A: 'advanced' } as const)[m[1].toUpperCase() as 'B'];
  const length = ({ O: 'opening', T: 'two-pass', Q: 'first', F: 'full' } as const)[m[2].toUpperCase() as 'O'];
  const seed = parseInt(m[3], 36);
  return Number.isFinite(seed) ? { mode, length, seed: seed >>> 0 } : null;
}

const MODE_ICON: Record<Mode, string> = { beginner: '①', hybrid: '②', advanced: '③' };

export function Home({
  card,
  settings,
  setSettings,
  progress,
  onStart,
  onOpenCard,
  onUnlockCard,
  onOpenProgress,
  sessionStart,
}: {
  card: LoadedCard;
  settings: Settings;
  setSettings: (s: Settings) => void;
  progress: ProgressData;
  onStart: (r: StartRequest) => void;
  onOpenCard: () => void;
  onUnlockCard: () => void;
  onOpenProgress: () => void;
  sessionStart: number;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState(false);
  const summary = summarize(progress, card, sessionStart);
  const lengths: RoundLength[] = ['first', 'full', 'two-pass', 'opening'];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10 space-y-6">
      <section className="grid lg:grid-cols-[1.1fr_1fr] gap-6 items-center">
        <div>
          <p className="text-sm font-semibold text-jade-700 tracking-wide uppercase">American Mahjong · Charleston trainer</p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.05] mt-2">
            Read the rack. <span className="text-jade-600">Spot the hand.</span>
          </h1>
          <p className="text-ink-soft mt-3 text-lg max-w-xl">
            Short rounds that train you to recognise which card hands your tiles favour — and how that changes with every pass of the Charleston.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => onStart({ mode: settings.mode, length: settings.length, drill: 'none' })} data-testid="start-round">
              Start {MODE_INFO[settings.mode].name} round →
            </Button>
            <Button size="lg" variant="secondary" onClick={onOpenCard}>
              Browse the card
            </Button>
          </div>
          {card.def.source.kind === 'demo' ? (
            <p className="mt-3 text-xs text-[#7a5a14] bg-[#fbf3e1] inline-block rounded-lg px-2.5 py-1.5">
              Using the fictional <strong>{card.def.title}</strong> — not an official NMJL card.{' '}
              <button type="button" onClick={onUnlockCard} className="underline font-semibold" data-testid="home-unlock">
                Have a passcode?
              </button>
            </p>
          ) : (
            <p className="mt-3 text-xs text-jade-800 bg-jade-50 inline-block rounded-lg px-2.5 py-1.5">
              Using your imported card: <strong>{card.def.title}</strong>
            </p>
          )}
        </div>
        <div className="hidden lg:flex justify-center">
          <div className="flex gap-1.5 rotate-[-4deg] drop-shadow-xl">
            {(['F', 'N', '3D', '4D', '5D', 'RD', 'J'] as const).map((k, i) => (
              <span key={k} style={{ transform: `translateY(${Math.sin(i) * 8}px)` }}>
                <Tile kind={k} size="lg" />
              </span>
            ))}
          </div>
        </div>
      </section>

      <Panel title="1 · Choose a mode">
        <div className="px-4 pb-4 grid md:grid-cols-3 gap-3" data-testid="mode-select">
          {(['beginner', 'hybrid', 'advanced'] as Mode[]).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setSettings({ ...settings, mode: m })}
              data-testid={`mode-${m}`}
              aria-pressed={settings.mode === m}
              className={cx(
                'text-left rounded-2xl border-2 p-4 transition-colors',
                settings.mode === m ? 'border-jade-500 bg-jade-50' : 'border-line bg-white hover:border-jade-200',
              )}
            >
              <span className="flex items-center justify-between">
                <span className="font-display text-xl font-semibold">
                  <span className="text-jade-600 mr-1.5">{MODE_ICON[m]}</span>
                  {MODE_INFO[m].name}
                </span>
                {m === 'hybrid' && <span className="text-[11px] font-semibold text-jade-700 bg-white border border-jade-200 rounded-full px-2 py-0.5">Recommended</span>}
              </span>
              <span className="block text-sm text-ink-soft mt-1">{MODE_INFO[m].blurb}</span>
            </button>
          ))}
        </div>
        <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink-soft mr-1">Round length</span>
          {lengths.map((l) => (
            <Chip key={l} active={settings.length === l} onClick={() => setSettings({ ...settings, length: l })} testId={`length-${l}`}>
              {LENGTH_INFO[l].name}
            </Chip>
          ))}
          <span className="text-xs text-ink-faint w-full sm:w-auto sm:ml-2">{LENGTH_INFO[settings.length].blurb}</span>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Rapid-fire practice" className="lg:col-span-2">
          <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
            <DrillCard
              title="Opening-rack sprint"
              text="See a rack, rank three, get graded, next. The fastest way to learn the card."
              onClick={() => onStart({ mode: settings.mode, length: 'opening', drill: 'none' })}
              testId="drill-opening"
            />
            <DrillCard
              title="Category speed drill"
              text="Beginner categories against the clock."
              onClick={() => onStart({ mode: 'beginner', length: 'opening', drill: 'speed' })}
              testId="drill-speed"
            />
            <DrillCard
              title="Exact-hand drill"
              text="Name exact suits and numbers from the opening rack."
              onClick={() => onStart({ mode: 'advanced', length: 'opening', drill: 'exact' })}
              testId="drill-exact"
            />
            <DrillCard
              title="Two-pass challenge"
              text="Opening rack plus two passes — practise pivoting."
              onClick={() => onStart({ mode: settings.mode, length: 'two-pass', drill: 'none' })}
              testId="drill-two-pass"
            />
          </div>
        </Panel>

        <Panel title="Your progress">
          <div className="px-4 pb-4 text-sm space-y-2">
            {progress.rounds === 0 ? (
              <p className="text-ink-soft">Play a round and your strengths and blind spots will appear here.</p>
            ) : (
              <>
                <p>
                  <strong>{progress.rounds}</strong> rounds total · <strong>{summary.rounds}</strong> this session
                  {summary.rounds > 0 && <> · avg {summary.averageScore.toFixed(0)}</>}
                </p>
                {summary.bestCategories.length > 0 && <p className="text-ink-soft">Strong at: {summary.bestCategories.join(', ')}</p>}
                {summary.missedPatterns.length > 0 && <p className="text-ink-soft">Often missed: {summary.missedPatterns.join(', ')}</p>}
                <p className="rounded-lg bg-jade-50 text-jade-800 px-2.5 py-2 text-xs">{summary.recommendation}</p>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onOpenProgress} className="-ml-2">
              Details & personal bests
            </Button>
          </div>
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Targeted practice">
          <div className="px-4 pb-4">
            <p className="text-sm text-ink-soft mb-2">
              Pick sections to study. Racks are <strong>deliberately selected</strong> so one of them is the strongest option (not an unbiased random deal). Leave empty to let spaced repetition choose your weakest section.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {card.categories.map((c) => (
                <Chip
                  key={c.id}
                  active={targets.includes(c.id)}
                  onClick={() => setTargets((t) => (t.includes(c.id) ? t.filter((x) => x !== c.id) : [...t, c.id]))}
                  className="h-7 text-xs"
                  testId={`target-${c.id}`}
                >
                  {c.name}
                </Chip>
              ))}
            </div>
            <Button variant="secondary" onClick={() => onStart({ mode: settings.mode, length: 'opening', drill: 'targeted', targetCategories: targets })} data-testid="start-targeted">
              Start targeted practice
            </Button>
          </div>
        </Panel>
        <Panel title="Same-rack challenge">
          <div className="px-4 pb-4">
            <p className="text-sm text-ink-soft mb-2">Enter a friend’s challenge code to play exactly the same deal and passes, then compare scores.</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = parseChallengeCode(code);
                if (!parsed) return setCodeErr(true);
                setCodeErr(false);
                onStart({ ...parsed, drill: 'none' });
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="MIQ-HQ-1A2B3C"
                className={cx('flex-1 h-10 rounded-xl border px-3 text-sm bg-white', codeErr ? 'border-crak' : 'border-line')}
                aria-label="Challenge code"
              />
              <Button type="submit" variant="secondary">
                Play
              </Button>
            </form>
            {codeErr && <p className="text-xs text-crak mt-1">That code doesn’t look right — it should look like MIQ-HQ-1A2B3C.</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DrillCard({ title, text, onClick, testId }: { title: string; text: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="text-left rounded-xl border border-line bg-white hover:border-jade-300 hover:bg-jade-50/40 p-3 transition-colors">
      <span className="block font-semibold">{title} →</span>
      <span className="block text-sm text-ink-soft mt-0.5">{text}</span>
    </button>
  );
}
