import { useMemo, useState } from 'react';
import { metricOf, rankedBy, selectionLabel, type Candidate } from '../engine/analysis';
import type { LoadedCard } from '../engine/card/schema';
import { changeTable, decisionFeedback, formatMetric } from '../engine/feedback';
import type { DecisionRecord, PassRecord } from '../engine/game';
import { describeSimModel, type SimSettings } from '../engine/simulate';
import { KIND_OF_ID, KINDS, type TileKind } from '../engine/tiles';
import { BasisBadge, CreditBar, cx, Panel, SimValue } from './components';
import { Tile } from './Tile';

const TONE_STYLE = {
  great: 'bg-jade-50 border-jade-200 text-jade-800',
  good: 'bg-jade-50/60 border-jade-100 text-jade-800',
  ok: 'bg-[#fbf3e1] border-[#ecd9a6] text-[#7a5a14]',
  miss: 'bg-red-50 border-red-100 text-[#8f2d22]',
};

/** Right-column summary: your ranking against the engine's. */
export function RankingReview({ card, decision, simSettings }: { card: LoadedCard; decision: DecisionRecord; simSettings: SimSettings | null }) {
  const { grade } = decision;
  const basis = grade.basis;
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(() => rankedBy(decision.analysis, basis), [decision, basis]);
  const pts = Math.round(grade.credit * 100);
  return (
    <Panel title="How your ranking compares" actions={<BasisBadge basis={basis} />} className="flex flex-col min-h-0" >
      <div className="px-4 pb-4 overflow-y-auto scrollbar-thin" data-testid="ranking-review">
        <div className="flex items-end justify-between mb-1">
          <span className="text-sm text-ink-soft">Decision credit</span>
          <span className="font-display text-3xl font-semibold text-jade-700" data-testid="decision-credit">
            {pts}
            <span className="text-base text-ink-faint">/100</span>
          </span>
        </div>
        <CreditBar value={grade.credit} className="mb-4" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">You chose</h3>
            <ol className="space-y-1.5">
              {grade.picks.map((p, i) => (
                <li key={p.key} className="rounded-lg bg-paper px-2 py-1.5">
                  <span className="flex items-start gap-1.5">
                    <span className="text-xs font-bold text-ink-faint mt-px">{i + 1}</span>
                    <span className="text-[13px] font-semibold leading-tight">{selectionLabel(card, p.selection)}</span>
                  </span>
                  <span className="flex items-center justify-between mt-1 text-[11px] text-ink-faint">
                    <span>engine rank #{p.rank}</span>
                    <span className="font-semibold text-ink">{formatMetric(p.value, basis)}</span>
                  </span>
                  <CreditBar value={p.credit} className="mt-1" />
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1.5">Engine’s top 3</h3>
            <ol className="space-y-1.5">
              {grade.top.map((c, i) => {
                const yours = grade.recognized.includes(c.key);
                return (
                  <li key={c.key} className={cx('rounded-lg px-2 py-1.5 border', yours ? 'border-jade-200 bg-jade-50' : 'border-dashed border-line')}>
                    <span className="flex items-start gap-1.5">
                      <span className="text-xs font-bold text-ink-faint mt-px">{i + 1}</span>
                      <span className="text-[13px] font-semibold leading-tight">{c.label}</span>
                    </span>
                    <span className="flex items-center justify-between mt-1 text-[11px]">
                      <span className={yours ? 'text-jade-700 font-semibold' : 'text-[#8a6a1c]'}>{yours ? '✓ you found it' : 'overlooked'}</span>
                      <span className="font-semibold text-ink">{formatMetric(metricOf(c, basis), basis)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
          <span className="font-semibold text-ink">Backup diversity:</span> your three choices {grade.yourFlexibility.overlap > 0.6 ? 'overlap heavily' : grade.yourFlexibility.overlap > 0.35 ? 'share some key tiles' : 'use different tiles'} (overlap{' '}
          {Math.round(grade.yourFlexibility.overlap * 100)}% vs {Math.round(grade.topFlexibility.overlap * 100)}% for the engine’s top three). The strongest single target and the most diversified set of backups are not always the same.
        </div>

        <button type="button" className="mt-3 text-xs font-semibold text-jade-700" onClick={() => setShowAll((x) => !x)} data-testid="toggle-all-candidates">
          {showAll ? 'Hide' : 'Show'} all {ordered.length} candidates and the numbers
        </button>
        {showAll && (
          <div className="mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-ink-faint text-left">
                  <th className="font-medium py-1">#</th>
                  <th className="font-medium">Candidate</th>
                  <th className="font-medium text-right" title="Heuristic opportunity score, 0–100, not a probability">Score</th>
                  <th className="font-medium text-right pl-3" title="Simulated completion probability with 95% interval">Sim.</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((c, i) => (
                  <CandidateRow key={c.key} c={c} i={i} picked={grade.picks.some((p) => p.key === c.key)} />
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-snug text-ink-faint">
              <strong>Score</strong> = heuristic opportunity (relative, 0–100). {decision.level !== 'variant' ? 'For a category or line it is the score of its best hand (an approximation).' : ''}{' '}
              {simSettings ? (
                <>
                  <strong>Sim.</strong> = {describeSimModel(simSettings)}{' '}
                  {decision.level !== 'variant' && 'Category and line probabilities are a true union: the simulated player adapts among every hand in the group.'}
                </>
              ) : (
                'Simulation is turned off in settings, so probabilities are unavailable.'
              )}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function CandidateRow({ c, i, picked }: { c: Candidate; i: number; picked: boolean }) {
  return (
    <tr className={cx('border-t border-line', picked && 'bg-jade-50/70')}>
      <td className="py-1 text-ink-faint">{i + 1}</td>
      <td className="py-1 pr-2">
        <span className="font-medium">{c.label}</span>
        {c.level === 'category' && <span className="text-ink-faint"> · {c.strongVariants} strong / {c.variantCount}</span>}
      </td>
      <td className="py-1 text-right tabular-nums">{c.heuristic.toFixed(0)}</td>
      <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">
        <SimValue sim={c.sim} />
      </td>
    </tr>
  );
}

/** Before/after chart for leading candidates across the last exchange. */
export function ChangeChart({ card, prev, cur }: { card: LoadedCard; prev: DecisionRecord; cur: DecisionRecord }) {
  const { rows } = useMemo(() => changeTable(card, prev, cur), [card, prev, cur]);
  const max = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]));
  return (
    <div data-testid="change-chart">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">How the exchange changed your prospects</h3>
        <BasisBadge basis="heuristic" />
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink-faint text-left">
            <th className="font-medium py-1">Candidate</th>
            <th className="font-medium w-[38%]">Before → After</th>
            <th className="font-medium text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = r.after - r.before;
            return (
              <tr key={r.key} className="border-t border-line">
                <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                <td className="py-1.5">
                  <span className="relative block h-3.5 rounded bg-paper">
                    <span className="absolute inset-y-0 left-0 rounded bg-ink/15" style={{ width: `${(r.before / max) * 100}%` }} />
                    <span
                      className={cx('absolute top-1 bottom-1 left-0 rounded', d >= 0 ? 'bg-jade-500' : 'bg-crak/70')}
                      style={{ width: `${(r.after / max) * 100}%` }}
                    />
                  </span>
                  <span className="text-[10px] text-ink-faint tabular-nums">
                    {r.before.toFixed(0)} → {r.after.toFixed(0)}
                  </span>
                </td>
                <td className={cx('py-1.5 text-right font-semibold tabular-nums', d > 0.5 ? 'text-jade-700' : d < -0.5 ? 'text-crak' : 'text-ink-faint')}>
                  {d > 0 ? '+' : ''}
                  {d.toFixed(0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-ink-faint">A strategy is only as good as the tiles you hold right now — re-rank after every pass.</p>
    </div>
  );
}

/** Main-column teaching panel: concise feedback, expandable details and the change chart. */
export function FeedbackPanel({
  card,
  decision,
  prev,
  pass,
}: {
  card: LoadedCard;
  decision: DecisionRecord;
  prev?: DecisionRecord;
  pass?: PassRecord;
}) {
  const fb = useMemo(() => decisionFeedback(card, decision, prev, pass), [card, decision, prev, pass]);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Panel
      title="Coach’s notes"
      actions={
        <button type="button" className="text-xs font-semibold text-ink-faint hover:text-ink" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? 'Show' : 'Skip'}
        </button>
      }
    >
      {!collapsed && (
        <div className="px-4 pb-4 space-y-3" data-testid="feedback-panel">
          <div className={cx('rounded-xl border px-3 py-2.5', TONE_STYLE[fb.tone])}>
            <p className="font-display text-lg font-semibold leading-tight" data-testid="feedback-headline">
              {fb.headline}
            </p>
            {fb.summary.map((s, i) => (
              <p key={i} className="text-sm mt-1 leading-snug text-ink">
                {s}
              </p>
            ))}
          </div>
          {prev && <ChangeChart card={card} prev={prev} cur={decision} />}
          <div>
            <button type="button" className="text-xs font-semibold text-jade-700" onClick={() => setOpen((o) => !o)} data-testid="toggle-details">
              {open ? 'Hide' : 'Why?'} details
            </button>
            {open && (
              <ul className="mt-2 space-y-1.5 text-sm text-ink-soft list-disc pl-5">
                {fb.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Small card shown right after a pass: what you passed and received, and the engine's best pass. */
export function LastPassCard({ pass, showLabels }: { pass: PassRecord; showLabels: boolean }) {
  const kinds = (ids: number[]) => ids.map((id) => KINDS[KIND_OF_ID[id]] as TileKind);
  const same = [...pass.grade.yourKinds].sort().join() === [...pass.grade.bestKinds].sort().join();
  return (
    <div className="rounded-xl border border-line bg-paper/70 px-3 py-2.5 text-sm" data-testid="last-pass">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-ink-faint">Passed {pass.step.direction}</span>
          {kinds(pass.passed).map((k, i) => (
            <Tile key={i} kind={k} size="sm" showLabel={showLabels} />
          ))}
          {pass.blind > 0 && <span className="text-xs text-ink-faint">+{pass.blind} blind</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-ink-faint">Received</span>
          {kinds(pass.received).map((k, i) => (
            <Tile key={i} kind={k} size="sm" highlight="gold" showLabel={showLabels} />
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-ink-faint">Engine’s pass</span>
          {pass.grade.bestKinds.map((k, i) => (
            <Tile key={i} kind={k} size="sm" showLabel={showLabels} />
          ))}
        </span>
      </div>
      <p className="text-xs text-ink-soft mt-1.5">
        <span className="font-semibold text-ink">Decision quality {Math.round(pass.grade.credit * 100)}/100</span> — better than {Math.round(pass.grade.percentile * 100)}% of the {pass.grade.optionsCount} possible passes
        {same ? ' (you matched the engine).' : '.'} Judged only on what you knew when passing; what you received is luck.
      </p>
    </div>
  );
}

