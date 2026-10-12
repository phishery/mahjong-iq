import { useEffect, useMemo, useState } from 'react';
import { selectionKey, selectionLabel, type Level, type Selection } from '../engine/analysis';
import { lineVariables, resolveVariant } from '../engine/card/parser';
import type { HandLine, HandVariant, LoadedCard, SuitVar } from '../engine/card/schema';
import { SUIT_NAMES, SUITS, type Suit } from '../engine/tiles';
import { Button, Chip, cx, Panel, PatternText, VariantTiles } from './components';

const LEVEL_NOUN: Record<Level, string> = { category: 'categories', line: 'card lines', variant: 'exact hands' };
const LEVEL_HELP: Record<Level, string> = {
  category: 'Which sections of the card look most promising for this rack?',
  line: 'Now pick specific lines on the card.',
  variant: 'Pick exact hands: the line plus its suits and numbers.',
};
const SUITVAR_LABEL: Record<SuitVar, string> = { A: 'Suit 1', B: 'Suit 2', C: 'Suit 3' };
const SUITVAR_DOT: Record<SuitVar, string> = { A: 'bg-bam', B: 'bg-crak', C: 'bg-dot' };

export interface StrategyPanelProps {
  card: LoadedCard;
  level: Level;
  /** Picks from the previous decision (offered for retention when the level matches). */
  previous: Selection[] | null;
  rack: number[];
  submitting: boolean;
  askConfidence: boolean;
  onSubmit: (picks: Selection[], confidence?: number) => void;
  onFocus: (v: HandVariant | null) => void;
  decisionId: string;
}

export function StrategyPanel({ card, level, previous, rack, submitting, askConfidence, onSubmit, onFocus, decisionId }: StrategyPanelProps) {
  const [picks, setPicks] = useState<Selection[]>([]);
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const canRetain = !!previous && previous.length === 3 && previous[0].level === level;

  useEffect(() => {
    // Fresh decision: start from the previous ranking when it is at the same level.
    setPicks(canRetain ? [...previous!] : []);
    setConfidence(undefined);
    onFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionId]);

  const keys = picks.map(selectionKey);
  const add = (s: Selection) => {
    if (keys.includes(selectionKey(s))) return;
    setPicks((p) => (p.length >= 3 ? [...p.slice(0, 2), s] : [...p, s]));
  };
  const remove = (i: number) => setPicks((p) => p.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) =>
    setPicks((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <Panel title={<>Your top 3 · <span className="text-jade-700">{LEVEL_NOUN[level]}</span></>} className="flex flex-col min-h-0">
      <div className="px-4 pb-3">
        <p className="text-sm text-ink-soft mb-3">{LEVEL_HELP[level]}</p>
        <ol className="space-y-2" data-testid="ranking-slots">
          {[0, 1, 2].map((i) => {
            const s = picks[i];
            const v = s?.level === 'variant' ? card.variantById.get(s.id) : null;
            return (
              <li
                key={i}
                className={cx(
                  'flex items-center gap-2 rounded-xl border px-2.5 py-2 min-h-12',
                  s ? 'border-jade-200 bg-jade-50/60' : 'border-dashed border-line bg-paper/60',
                )}
                onMouseEnter={() => v && onFocus(v)}
                onMouseLeave={() => onFocus(null)}
              >
                <span className={cx('w-6 h-6 shrink-0 rounded-full text-xs font-bold flex items-center justify-center', s ? 'bg-jade-600 text-white' : 'bg-line text-ink-faint')}>
                  {i + 1}
                </span>
                {s ? (
                  <>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-ink truncate" data-testid={`slot-${i}`}>
                        {selectionLabel(card, s)}
                      </span>
                      {v && (
                        <span className="block mt-1">
                          <VariantTiles variant={v} rack={rack} />
                        </span>
                      )}
                    </span>
                    <span className="flex flex-col">
                      <button type="button" className="text-ink-faint hover:text-ink text-xs leading-none px-1" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>▲</button>
                      <button type="button" className="text-ink-faint hover:text-ink text-xs leading-none px-1" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === picks.length - 1}>▼</button>
                    </span>
                    <button type="button" className="text-ink-faint hover:text-crak px-1" onClick={() => remove(i)} aria-label="Remove">✕</button>
                  </>
                ) : (
                  <span className="text-sm text-ink-faint">{i === 0 ? 'Strongest choice' : i === 1 ? 'Backup plan' : 'Third option'}</span>
                )}
              </li>
            );
          })}
        </ol>
        {previous && !canRetain && previous.length > 0 && (
          <p className="mt-2 text-xs text-ink-faint">
            Last time: {previous.map((p) => selectionLabel(card, p)).join(' · ')}
          </p>
        )}
      </div>
      <div className="border-t border-line flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3 max-h-[46vh] lg:max-h-none">
        {level === 'category' && <CategoryPicker card={card} selected={keys} onPick={add} />}
        {level === 'line' && <LinePicker card={card} selected={keys} onPick={add} />}
        {level === 'variant' && <VariantPicker card={card} rack={rack} selected={keys} onPick={add} onFocus={onFocus} />}
      </div>
      <div className="border-t border-line p-4 space-y-3">
        {askConfidence && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-soft">Confidence in #1:</span>
            {[
              [1, 'Unsure'],
              [2, 'Fairly sure'],
              [3, 'Confident'],
            ].map(([v, l]) => (
              <Chip key={v} active={confidence === v} onClick={() => setConfidence(v as number)}>
                {l}
              </Chip>
            ))}
          </div>
        )}
        <Button
          size="lg"
          className="w-full"
          disabled={picks.length !== 3 || submitting}
          onClick={() => onSubmit(picks, confidence)}
          data-testid="submit-ranking"
        >
          {submitting ? 'Grading…' : picks.length === 3 ? 'Lock in my ranking' : `Choose ${3 - picks.length} more`}
        </Button>
      </div>
    </Panel>
  );
}

function CategoryPicker({ card, selected, onPick }: { card: LoadedCard; selected: string[]; onPick: (s: Selection) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2" data-testid="category-picker">
      {card.categories.map((c) => {
        const key = `category:${c.id}`;
        const idx = selected.indexOf(key);
        const lines = card.lines.filter((l) => l.category === c.id);
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onPick({ level: 'category', id: c.id })}
            disabled={idx >= 0}
            data-testid={`pick-category-${c.id}`}
            className={cx(
              'text-left rounded-xl border px-3 py-2 transition-colors',
              idx >= 0 ? 'border-jade-400 bg-jade-50' : 'border-line bg-white hover:border-jade-300 hover:bg-jade-50/40',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm">{c.name}</span>
              {idx >= 0 ? (
                <span className="text-[11px] font-bold text-jade-700">#{idx + 1}</span>
              ) : (
                <span className="text-[11px] text-ink-faint">{lines.length} lines</span>
              )}
            </span>
            <span className="block text-xs text-ink-faint mt-0.5 line-clamp-2">{c.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function LinePicker({ card, selected, onPick }: { card: LoadedCard; selected: string[]; onPick: (s: Selection) => void }) {
  const [cat, setCat] = useState(card.categories[0].id);
  return (
    <div data-testid="line-picker">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {card.categories.map((c) => {
          const n = selected.filter((k) => k.startsWith('line:') && card.lineById.get(k.slice(5))?.category === c.id).length;
          return (
            <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} className="h-7 text-xs">
              {c.name}
              {n > 0 && <span className="ml-1 text-[10px]">•{n}</span>}
            </Chip>
          );
        })}
      </div>
      <div className="space-y-1.5">
        {card.lines
          .filter((l) => l.category === cat)
          .map((l) => {
            const key = `line:${l.id}`;
            const idx = selected.indexOf(key);
            return (
              <button
                type="button"
                key={l.id}
                disabled={idx >= 0}
                onClick={() => onPick({ level: 'line', id: l.id })}
                data-testid={`pick-line-${l.id}`}
                className={cx(
                  'w-full text-left rounded-xl border px-3 py-2 transition-colors',
                  idx >= 0 ? 'border-jade-400 bg-jade-50' : 'border-line bg-white hover:border-jade-300',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-faint">
                    #{l.line} {l.concealed ? '· Concealed' : ''} · {l.variants.length} variation{l.variants.length > 1 ? 's' : ''}
                  </span>
                  {idx >= 0 && <span className="text-[11px] font-bold text-jade-700">#{idx + 1}</span>}
                </span>
                <PatternText line={l} className="block text-[13px] mt-0.5" />
                <span className="block text-[11px] text-ink-faint mt-0.5 line-clamp-1">{l.description}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function VariantPicker({
  card,
  rack,
  selected,
  onPick,
  onFocus,
}: {
  card: LoadedCard;
  rack: number[];
  selected: string[];
  onPick: (s: Selection) => void;
  onFocus: (v: HandVariant | null) => void;
}) {
  const [cat, setCat] = useState(card.categories[0].id);
  const [lineId, setLineId] = useState<string | null>(null);
  const line = lineId ? card.lineById.get(lineId)! : null;
  return (
    <div data-testid="variant-picker">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {card.categories.map((c) => (
          <Chip
            key={c.id}
            active={cat === c.id}
            onClick={() => {
              setCat(c.id);
              setLineId(null);
            }}
            className="h-7 text-xs"
          >
            {c.name}
          </Chip>
        ))}
      </div>
      {!line ? (
        <div className="space-y-1.5">
          {card.lines
            .filter((l) => l.category === cat)
            .map((l) => (
              <button
                type="button"
                key={l.id}
                onClick={() => setLineId(l.id)}
                data-testid={`open-line-${l.id}`}
                className="w-full text-left rounded-xl border border-line bg-white hover:border-jade-300 px-3 py-2"
              >
                <span className="text-xs font-semibold text-ink-faint">
                  #{l.line} {l.concealed ? '· Concealed' : ''} · {l.variants.length} variation{l.variants.length > 1 ? 's' : ''}
                </span>
                <PatternText line={l} className="block text-[13px] mt-0.5" />
              </button>
            ))}
        </div>
      ) : (
        <VariantBuilder key={line.id} card={card} line={line} rack={rack} selected={selected} onPick={onPick} onFocus={onFocus} onBack={() => setLineId(null)} />
      )}
    </div>
  );
}

function VariantBuilder({
  card,
  line,
  rack,
  selected,
  onPick,
  onFocus,
  onBack,
}: {
  card: LoadedCard;
  line: HandLine;
  rack: number[];
  selected: string[];
  onPick: (s: Selection) => void;
  onFocus: (v: HandVariant | null) => void;
  onBack: () => void;
}) {
  const [alt, setAlt] = useState(0);
  const vars = useMemo(() => lineVariables(line, alt), [line, alt]);
  const firstOf = (a: number) => line.variants.find((v) => v.alt === a) ?? line.variants[0];
  const [suits, setSuits] = useState<Partial<Record<SuitVar, Suit>>>({ ...firstOf(0).suits });
  const [nums, setNums] = useState<Record<string, number>>({ ...firstOf(0).nums });
  const [showAll, setShowAll] = useState(false);
  const variant = resolveVariant(line, suits, nums, alt);
  const chooseAlt = (a: number) => {
    setAlt(a);
    setSuits({ ...firstOf(a).suits });
    setNums({ ...firstOf(a).nums });
  };
  const taken = variant ? selected.includes(`variant:${variant.id}`) : false;

  useEffect(() => {
    onFocus(variant);
    return () => onFocus(null);
  }, [variant, onFocus]);

  return (
    <div>
      <button type="button" onClick={onBack} className="text-xs font-semibold text-jade-700 mb-2">
        ← All {card.categoryById.get(line.category)?.name} lines
      </button>
      <div className="rounded-xl border border-line bg-white p-3">
        <div className="text-xs font-semibold text-ink-faint mb-1">
          {line.categoryName} #{line.line} {line.concealed ? '· Concealed' : '· Exposed'}
        </div>
        <PatternText line={line} className="text-sm" alt={line.alternatives.length > 1 ? alt : undefined} />
        <p className="text-[11px] text-ink-faint mt-1">{line.description}</p>
        {line.alternatives.length > 1 && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-ink-soft w-20">Version</span>
            {line.alternatives.map((_, a) => (
              <Chip key={a} active={alt === a} onClick={() => chooseAlt(a)} className="h-7 text-xs">
                {a === 0 ? 'First' : a === 1 ? 'Or…' : `Or (${a + 1})`}
              </Chip>
            ))}
          </div>
        )}
        {(vars.suitVars.length > 0 || vars.numVars.length > 0) && (
          <div className="mt-3 space-y-2">
            {vars.numVars.map((nv) => (
              <div key={nv.name} className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-ink-soft w-20">Start ({nv.name})</span>
                {nv.values.map((val) => (
                  <Chip key={val} active={nums[nv.name] === val} onClick={() => setNums({ ...nums, [nv.name]: val })} className="h-7 w-8 px-0 text-xs">
                    {val}
                  </Chip>
                ))}
              </div>
            ))}
            {vars.suitVars.map((sv) => (
              <div key={sv} className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-ink-soft w-20 inline-flex items-center gap-1.5">
                  <span className={cx('w-2 h-2 rounded-full', SUITVAR_DOT[sv])} />
                  {SUITVAR_LABEL[sv]}
                </span>
                {SUITS.map((s) => (
                  <Chip key={s} active={suits[sv] === s} onClick={() => setSuits({ ...suits, [sv]: s })} className="h-7 text-xs" testId={`suit-${sv}-${s}`}>
                    {SUIT_NAMES[s]}
                  </Chip>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 min-h-10">
          {variant ? (
            <VariantTiles variant={variant} rack={rack} size="xs" />
          ) : (
            <p className="text-xs text-crak">That combination isn’t legal for this line (each colour must be a different suit, and different number variables must differ).</p>
          )}
        </div>
        <Button
          size="sm"
          className="mt-3 w-full"
          disabled={!variant || taken}
          onClick={() => variant && onPick({ level: 'variant', id: variant.id })}
          data-testid="add-variant"
        >
          {taken ? 'Already ranked' : 'Add this exact hand'}
        </Button>
      </div>
      {line.variants.length > 1 && (
        <div className="mt-3">
          <button type="button" className="text-xs font-semibold text-jade-700" onClick={() => setShowAll((x) => !x)}>
            {showAll ? 'Hide' : 'Show'} all {line.variants.length} legal variations (learning aid)
          </button>
          {showAll && (
            <ul className="mt-2 space-y-1.5">
              {line.variants.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2 py-1.5">
                  <span>
                    <span className="block text-[11px] text-ink-faint mb-0.5">{v.configLabel}</span>
                    <VariantTiles variant={v} rack={rack} />
                  </span>
                  <Button size="sm" variant="secondary" disabled={selected.includes(`variant:${v.id}`)} onClick={() => onPick({ level: 'variant', id: v.id })}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
