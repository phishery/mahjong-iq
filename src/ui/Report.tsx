import { useMemo, useState } from 'react';
import { selectionLabel } from '../engine/analysis';
import type { LoadedCard } from '../engine/card/schema';
import { formatMetric } from '../engine/feedback';
import { LENGTH_INFO, MODE_INFO, type RoundState } from '../engine/game';
import { modeKey, type ProgressData } from '../engine/progress';
import { buildReport } from '../engine/report';
import { kindOfTile, sortKinds } from '../engine/tiles';
import { BasisBadge, Button, CreditBar, cx, Panel } from './components';
import { Tile } from './Tile';

export function challengeCode(round: RoundState): string {
  const m = { beginner: 'B', hybrid: 'H', advanced: 'A' }[round.config.mode];
  const l = { opening: 'O', 'two-pass': 'T', first: 'Q', full: 'F' }[round.config.length];
  return `MIQ-${m}${l}-${round.config.seed.toString(36).toUpperCase()}`;
}

function ScoreRing({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 128 128" className="w-36 h-36">
      <circle cx="64" cy="64" r={r} fill="none" stroke="#e4ded0" strokeWidth="10" />
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke="#1f6f5c"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform="rotate(-90 64 64)"
        style={{ transition: 'stroke-dasharray 0.8s ease-out' }}
      />
      <text data-testid="score-total" x="64" y="70" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="34" fontWeight="600" fill="#1d2a26">
        {value}
      </text>
      <text x="64" y="90" textAnchor="middle" fontSize="11" fill="#7b8a85">
        out of 100
      </text>
    </svg>
  );
}

export function Report({
  card,
  round,
  progress,
  onAgain,
  onHome,
}: {
  card: LoadedCard;
  round: RoundState;
  progress: ProgressData;
  onAgain: () => void;
  onHome: () => void;
}) {
  const report = useMemo(() => buildReport(card, round), [card, round]);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const mk = modeKey(round.config.mode, round.config.length);
  const ms = progress.byMode[mk];
  const isBest = ms && ms.rounds > 1 && report.score.total >= ms.best;
  const d = round.decisions[step];
  const code = challengeCode(round);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4" data-testid="report">
      <Panel>
        <div className="p-5 flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing value={report.score.total} />
          <div className="flex-1 w-full">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {MODE_INFO[round.config.mode].name} · {LENGTH_INFO[round.config.length].name}
            </p>
            <h1 className="font-display text-3xl font-semibold mt-1" data-testid="report-score">
              {report.score.total >= 85 ? 'Outstanding round' : report.score.total >= 70 ? 'Strong round' : report.score.total >= 50 ? 'Good progress' : 'Learning round'}
              {isBest && <span className="ml-2 align-middle text-sm rounded-full bg-gold/20 text-[#7a5a14] px-2 py-0.5">Personal best!</span>}
            </h1>
            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-soft">Strategic recognition</span>
                  <span className="font-semibold">
                    {report.score.strategy.toFixed(0)} / {report.score.strategyMax}
                  </span>
                </div>
                <CreditBar value={report.score.strategy / report.score.strategyMax} className="mt-1.5" />
              </div>
              {report.score.passing !== null && (
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-soft">Charleston decisions</span>
                    <span className="font-semibold">
                      {report.score.passing.toFixed(0)} / {report.score.passingMax}
                    </span>
                  </div>
                  <CreditBar value={report.score.passing / report.score.passingMax} className="mt-1.5" />
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              {ms ? `This mode: ${ms.rounds} round${ms.rounds > 1 ? 's' : ''}, best ${ms.best}, average ${(ms.total / ms.rounds).toFixed(0)}. ` : ''}
              Scores are compared only within the same mode and round length. {report.durationSec}s this round.
            </p>
          </div>
        </div>
        <div className="border-t border-line px-5 py-3 flex flex-wrap items-center gap-2">
          <Button onClick={onAgain} data-testid="play-again" autoFocus>
            Play again →
          </Button>
          <Button variant="secondary" onClick={onHome}>
            Change mode
          </Button>
          <span className="ml-auto text-xs text-ink-faint flex items-center gap-2">
            Same-rack challenge code:
            <code className="bg-paper px-2 py-1 rounded font-semibold text-ink">{code}</code>
            <button
              type="button"
              className="text-jade-700 font-semibold"
              onClick={() => {
                navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </span>
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Lessons from this round">
          <ul className="px-5 pb-4 space-y-2 text-sm text-ink" data-testid="lessons">
            {report.lessons.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-jade-600 font-bold">{i + 1}.</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Your strategy over the round">
          <div className="px-5 pb-4 text-sm space-y-1.5">
            <p>
              <span className="text-ink-faint">Started with:</span> <strong>{report.initialStrategy}</strong>
            </p>
            <p>
              <span className="text-ink-faint">Finished with:</span> <strong>{report.finalStrategy}</strong>
            </p>
            {report.strongestPass && (
              <p>
                <span className="text-ink-faint">Best pass:</span> {report.strongestPass.label} ({Math.round(report.strongestPass.credit * 100)}/100)
              </p>
            )}
            {report.weakestPass && (
              <p>
                <span className="text-ink-faint">Weakest pass:</span> {report.weakestPass.label} ({Math.round(report.weakestPass.credit * 100)}/100) — engine would pass {report.weakestPass.better}
              </p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Decision timeline">
        <div className="px-5 pb-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-ink-faint">
                <th className="font-medium py-1.5">Step</th>
                <th className="font-medium">Your #1</th>
                <th className="font-medium">Engine’s #1</th>
                <th className="font-medium w-28">Credit</th>
                <th className="font-medium">Pass quality / outcome</th>
              </tr>
            </thead>
            <tbody>
              {report.timeline.map((t, i) => {
                const p = round.passes[i];
                return (
                  <tr key={i} className={cx('border-t border-line cursor-pointer hover:bg-paper', step === i && 'bg-jade-50/60')} onClick={() => setStep(i)}>
                    <td className="py-2 pr-2">
                      <span className="font-medium">{t.stepLabel}</span>
                      {t.pivotJustified && <span className="block text-[11px] text-[#8a6a1c]">{t.pivoted ? 'pivot ✓' : 'pivot was justified'}</span>}
                    </td>
                    <td className="pr-2">{t.yourPicks[0]}</td>
                    <td className="pr-2">{t.engineTop[0]}</td>
                    <td>
                      <span className="text-xs font-semibold">{Math.round(t.credit * 100)}</span>
                      <CreditBar value={t.credit} className="mt-1" />
                    </td>
                    <td className="text-xs text-ink-soft">
                      {p ? (
                        <>
                          {p.step.label}: decision {Math.round(p.grade.credit * 100)}/100 · outcome {p.outcome.before.toFixed(0)}→{p.outcome.after.toFixed(0)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-ink-faint mt-2">
            Decision quality judges each pass on what you knew at the time; “outcome” shows how the best opportunity actually changed after receiving tiles. They measure different things.
          </p>
        </div>
      </Panel>

      {d && (
        <Panel
          title={`Replay · step ${step + 1} of ${round.decisions.length}`}
          actions={
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                ← Prev
              </Button>
              <Button size="sm" variant="ghost" disabled={step === round.decisions.length - 1} onClick={() => setStep((s) => s + 1)} data-testid="replay-next">
                Next →
              </Button>
            </span>
          }
        >
          <div className="px-5 pb-5">
            <p className="font-display text-lg font-semibold">{d.stepLabel}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {sortKinds(d.rack.map(kindOfTile)).map((k, i) => (
                <Tile key={i} kind={k} size="md" />
              ))}
            </div>
            <div className="mt-3 grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">Your ranking</p>
                <ol className="space-y-1">
                  {d.grade.picks.map((p, i) => (
                    <li key={i}>
                      {i + 1}. {selectionLabel(card, p.selection)} <span className="text-ink-faint">({formatMetric(p.value, d.grade.basis)})</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1 flex items-center gap-2">
                  Engine’s top three <BasisBadge basis={d.grade.basis} />
                </p>
                <ol className="space-y-1">
                  {d.grade.top.map((c, i) => (
                    <li key={i}>
                      {i + 1}. {c.label} <span className="text-ink-faint">({formatMetric(d.grade.basis === 'simulation' ? (c.sim?.p ?? 0) : c.heuristic, d.grade.basis)})</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {round.passes[step] && (
              <div className="mt-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">Then you passed ({round.passes[step].step.label})</p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex gap-1">
                    {round.passes[step].passed.map((id) => (
                      <Tile key={id} kind={kindOfTile(id)} size="sm" />
                    ))}
                  </span>
                  <span className="text-ink-faint text-xs">engine suggested</span>
                  <span className="flex gap-1">
                    {round.passes[step].grade.bestKinds.map((k, i) => (
                      <Tile key={i} kind={k} size="sm" />
                    ))}
                  </span>
                  <span className="text-ink-faint text-xs">and received</span>
                  <span className="flex gap-1">
                    {round.passes[step].received.map((id) => (
                      <Tile key={id} kind={kindOfTile(id)} size="sm" highlight="gold" />
                    ))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
