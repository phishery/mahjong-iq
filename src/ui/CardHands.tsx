import { useEffect, useMemo, useRef, useState } from 'react';
import type { HandVariant, LoadedCard } from '../engine/card/schema';
import { matchVariant } from '../engine/evaluator';
import { Chip, cx, PatternText, VariantTiles } from './components';

/** 'all', 'mine' (the player's current sections) or a category id. */
export type CardFilter = string;

/**
 * The browsable list of card lines with section filters. Used by the card drawer and by the
 * card docked under the rack on larger screens.
 */
export function CardHands({
  card,
  rack,
  revealCounts,
  onFocus,
  filter: filterProp,
  onFilter,
  mine = [],
  highlightLineId = null,
}: {
  card: LoadedCard;
  rack: number[] | null;
  /** Show per-line "tiles held" counts (hidden while the player is ranking, to avoid giving answers away). */
  revealCounts: boolean;
  onFocus: (v: HandVariant | null) => void;
  /** Controlled filter; when omitted the component keeps its own. */
  filter?: CardFilter;
  onFilter?: (f: CardFilter) => void;
  /** Category ids offered as a "Your sections" filter. */
  mine?: string[];
  /** A line to scroll to and outline. */
  highlightLineId?: string | null;
}) {
  const [ownFilter, setOwnFilter] = useState<CardFilter>('all');
  const filter = filterProp ?? ownFilter;
  const setFilter = onFilter ?? setOwnFilter;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const lineRefs = useRef(new Map<string, HTMLLIElement>());

  const lines = useMemo(
    () => card.lines.filter((l) => filter === 'all' || (filter === 'mine' ? mine.includes(l.category) : l.category === filter)),
    [card, filter, mine],
  );
  const variantCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of card.variants) m.set(v.categoryId, (m.get(v.categoryId) ?? 0) + 1);
    return m;
  }, [card]);

  useEffect(() => {
    if (highlightLineId) lineRefs.current.get(highlightLineId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightLineId, filter]);

  const isCategory = filter !== 'all' && filter !== 'mine';

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3" data-testid="card-filters">
        {mine.length > 0 && (
          <Chip active={filter === 'mine'} onClick={() => setFilter('mine')} className="h-7 text-xs" testId="card-filter-mine">
            Your sections
          </Chip>
        )}
        <Chip active={filter === 'all'} onClick={() => setFilter('all')} className="h-7 text-xs" testId="card-filter-all">
          All
        </Chip>
        {card.categories.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)} className="h-7 text-xs" testId={`card-filter-${c.id}`}>
            {c.name}
          </Chip>
        ))}
      </div>
      {isCategory && (
        <p className="text-sm text-ink-soft mb-3">
          {card.categoryById.get(filter)?.description}{' '}
          <span className="text-ink-faint">({variantCounts.get(filter)} legal variations across {lines.length} lines — more variations means more ways in, but not necessarily an easier hand.)</span>
        </p>
      )}
      {filter === 'mine' && (
        <p className="text-xs text-ink-faint mb-3">
          Showing the sections from your last ranking: {mine.map((id) => card.categoryById.get(id)?.name ?? id).join(', ')}.
        </p>
      )}
      <ul className="space-y-2">
        {lines.map((l) => {
          const isOpen = expanded === l.id;
          const best =
            rack && revealCounts
              ? l.variants.reduce((b, v) => {
                  const m = matchVariant(rack, v);
                  return m.naturals + m.jokersUsed > b ? m.naturals + m.jokersUsed : b;
                }, 0)
              : null;
          return (
            <li
              key={l.id}
              ref={(el) => {
                if (el) lineRefs.current.set(l.id, el);
                else lineRefs.current.delete(l.id);
              }}
              className={cx('rounded-xl bg-white border transition-shadow', highlightLineId === l.id ? 'border-jade-400 ring-2 ring-jade-200' : 'border-line')}
            >
              <button type="button" className="w-full text-left px-3 py-2.5" onClick={() => setExpanded(isOpen ? null : l.id)} data-testid={`ref-line-${l.id}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-faint">
                    {l.categoryName} #{l.line} · {l.concealed ? 'Concealed (C)' : 'Exposed (X)'}
                    {l.value ? ` · ${l.value} pts` : ''}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    {l.variants.length} var.{best !== null && <> · you hold up to <strong className="text-ink">{best}</strong>/14</>}
                  </span>
                </span>
                <PatternText line={l} className="block text-[15px] mt-1" />
                <span className="block text-xs text-ink-soft mt-0.5">{l.description}</span>
              </button>
              {isOpen && (
                <div className="border-t border-line px-3 py-2 max-h-80 overflow-y-auto scrollbar-thin">
                  <p className="text-[11px] text-ink-faint mb-2">Every legal variation. Faded tiles are ones you don’t hold; Jokers fill groups of 3+ where you have them. Tap one to highlight it in your rack.</p>
                  <ul className="space-y-1.5">
                    {l.variants.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const next = focusId === v.id ? null : v.id;
                            setFocusId(next);
                            onFocus(next ? v : null);
                          }}
                          className={cx('w-full text-left rounded-lg px-2 py-1.5', focusId === v.id ? 'bg-jade-50 ring-1 ring-jade-300' : 'hover:bg-paper')}
                        >
                          <span className="block text-[11px] text-ink-faint mb-0.5">{v.configLabel}</span>
                          <VariantTiles variant={v} rack={rack ?? undefined} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
