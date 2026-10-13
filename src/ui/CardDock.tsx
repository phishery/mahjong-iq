import { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import type { HandVariant, LoadedCard } from '../engine/card/schema';
import { CardHands, type CardFilter } from './CardHands';
import { cx } from './components';

/** Smallest height for the docked card's scroll area before the page itself scrolls instead. */
const MIN_BODY_HEIGHT = 320;

/**
 * The card docked under the rack on larger screens. Its list scrolls inside a box sized to the
 * space left in the window, so the rack stays in view; it folds to a single bar when closed.
 */
export const CardDock = forwardRef<
  HTMLElement,
  {
    card: LoadedCard;
    rack: number[];
    revealCounts: boolean;
    onFocus: (v: HandVariant | null) => void;
    open: boolean;
    onToggle: () => void;
    filter: CardFilter;
    onFilter: (f: CardFilter) => void;
    mine: string[];
    highlightLineId: string | null;
  }
>(function CardDock({ card, rack, revealCounts, onFocus, open, onToggle, filter, onFilter, mine, highlightLineId }, ref) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = bodyRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setMaxHeight(Math.max(MIN_BODY_HEIGHT, Math.floor(window.innerHeight - top - 16)));
    };
    measure();
    // Content above the dock (pass summaries, banners) changes its position.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  return (
    <section ref={ref} className="rounded-2xl bg-white border border-line shadow-sm overflow-hidden" data-testid="card-dock">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cx('w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper/60', open && 'border-b border-line')}
        data-testid="card-dock-toggle"
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-display text-lg font-semibold">Card</span>
          <span className="text-xs text-ink-faint truncate">
            {card.def.title} · {card.lines.length} lines
          </span>
        </span>
        <span className="text-sm font-semibold text-jade-700 shrink-0">{open ? 'Hide ▴' : 'Show ▾'}</span>
      </button>
      {open && (
        <div ref={bodyRef} className="overflow-y-auto scrollbar-thin px-4 py-3" style={{ maxHeight }}>
          <CardHands
            card={card}
            rack={rack}
            revealCounts={revealCounts}
            onFocus={onFocus}
            filter={filter}
            onFilter={onFilter}
            mine={mine}
            highlightLineId={highlightLineId}
          />
        </div>
      )}
    </section>
  );
});
