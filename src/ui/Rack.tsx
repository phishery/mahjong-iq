import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { HandVariant } from '../engine/card/schema';
import { matchVariant } from '../engine/evaluator';
import { countsFromIds, KIND_INDEX, KIND_OF_ID, kindOfTile, type TileId } from '../engine/tiles';
import { cx, Segmented } from './components';
import { Tile } from './Tile';

export type SortMode = 'suit' | 'groups' | 'manual';

export interface RackProps {
  tiles: TileId[];
  selectable: boolean;
  selected: TileId[];
  onToggle?: (id: TileId) => void;
  incoming?: TileId[];
  outgoing?: TileId[];
  outgoingDirection?: 'right' | 'across' | 'left';
  focusVariant?: HandVariant | null;
  showLabels?: boolean;
  disabledIds?: Set<TileId>;
}

/** Pixels the pointer must travel before a press becomes a drag (smaller moves are taps). */
const DRAG_THRESHOLD = 6;

/** Move `id` to `to` in `order`. */
export function moveTile(order: TileId[], id: TileId, to: number): TileId[] {
  const next = order.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

function sortTiles(tiles: TileId[], mode: SortMode, prevOrder: TileId[]): TileId[] {
  if (mode === 'manual') {
    const kept = prevOrder.filter((id) => tiles.includes(id));
    const added = tiles.filter((id) => !kept.includes(id));
    return [...kept, ...added];
  }
  const counts = countsFromIds(tiles);
  return [...tiles].sort((a, b) => {
    if (mode === 'groups') {
      const d = counts[KIND_OF_ID[b]] - counts[KIND_OF_ID[a]];
      if (d) return d;
    }
    return KIND_OF_ID[a] - KIND_OF_ID[b] || a - b;
  });
}

export function Rack({
  tiles,
  selectable,
  selected,
  onToggle,
  incoming = [],
  outgoing = [],
  outgoingDirection = 'right',
  focusVariant,
  showLabels,
  disabledIds,
}: RackProps) {
  const [mode, setMode] = useState<SortMode>('suit');
  const [order, setOrder] = useState<TileId[]>(() => sortTiles(tiles, 'suit', []));
  const boxRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<TileId, HTMLDivElement>());
  /** The tile being dragged (set once the pointer has moved past the threshold). */
  const [dragging, setDragging] = useState<TileId | null>(null);
  /** A drag just ended: swallow the click the browser sends afterwards. */
  const suppressClick = useRef(false);
  const orderRef = useRef<TileId[]>([]);
  const [tileW, setTileW] = useState(56);

  // Size tiles to fit the rack on one row where possible (44–60px), wrapping only on phones.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const n = Math.max(13, tiles.length);
      const w = Math.floor((e.contentRect.width - (n - 1) * 4) / n);
      setTileW(Math.max(44, Math.min(60, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tiles.length]);

  useEffect(() => {
    setOrder((prev) => sortTiles(tiles, mode, prev));
  }, [tiles, mode]);

  // Which tiles contribute to the focused hand, and which fill exact (pair/single) groups.
  const roles = useMemo(() => {
    const role = new Map<TileId, 'exact' | 'flex' | 'joker'>();
    if (!focusVariant) return role;
    const m = matchVariant(countsFromIds(tiles), focusVariant);
    const needExact = new Map<number, number>();
    const needFlex = new Map<number, number>();
    for (const g of m.groups) {
      const ki = KIND_INDEX[g.kind];
      const target = g.jokerable ? needFlex : needExact;
      target.set(ki, (target.get(ki) ?? 0) + g.naturals);
    }
    let jokers = m.jokersUsed;
    for (const id of order) {
      const ki = KIND_OF_ID[id];
      if (kindOfTile(id) === 'J') {
        if (jokers > 0) {
          role.set(id, 'joker');
          jokers--;
        }
        continue;
      }
      if ((needExact.get(ki) ?? 0) > 0) {
        role.set(id, 'exact');
        needExact.set(ki, needExact.get(ki)! - 1);
      } else if ((needFlex.get(ki) ?? 0) > 0) {
        role.set(id, 'flex');
        needFlex.set(ki, needFlex.get(ki)! - 1);
      }
    }
    return role;
  }, [focusVariant, tiles, order]);

  orderRef.current = order;

  /**
   * Pointer-based dragging (mouse, touch and pen alike). The browser's native drag-and-drop
   * was unreliable here: it does not start from buttons in some browsers, never fires for
   * touch, and could be interrupted when the rack re-rendered mid-drag. While dragging, the
   * tile moves live to the slot nearest the pointer, so rows that wrap work too.
   */
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, id: TileId) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        setDragging(id);
        setMode('manual');
      }
      ev.preventDefault();
      // Nearest slot by distance to each tile's centre.
      let best = -1;
      let bestD = Infinity;
      orderRef.current.forEach((tid, i) => {
        const el = itemRefs.current.get(tid);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0 && orderRef.current[best] !== id) setOrder((prev) => moveTile(prev, id, best));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (started) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        setDragging(null);
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);

  const flyClass = outgoingDirection === 'right' ? '[animation:fly-right_0.45s_ease-in_forwards]' : outgoingDirection === 'left' ? '[animation:fly-left_0.45s_ease-in_forwards]' : '[animation:fly-up_0.45s_ease-in_forwards]';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <Segmented
          value={mode}
          onChange={setMode}
          testId="sort-mode"
          options={[
            { value: 'suit', label: 'By suit' },
            { value: 'groups', label: 'Pairs first' },
            { value: 'manual', label: 'Manual' },
          ]}
        />
        <span className="text-xs text-ink-faint hidden sm:inline">Drag tiles to rearrange</span>
      </div>
      <div ref={boxRef} className="flex flex-wrap justify-center gap-1 min-h-[96px] pt-3" data-testid="rack">
        {order.map((id) => {
          const kind = kindOfTile(id);
          const isSel = selected.includes(id);
          const isOut = outgoing.includes(id);
          const isNew = incoming.includes(id);
          const role = roles.get(id);
          const disabled = disabledIds?.has(id);
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) itemRefs.current.set(id, el);
                else itemRefs.current.delete(id);
              }}
              data-tile-id={id}
              draggable={false}
              onPointerDown={(e) => onPointerDown(e, id)}
              onClickCapture={(e) => {
                if (suppressClick.current) {
                  e.stopPropagation();
                  e.preventDefault();
                }
              }}
              onDragStart={(e) => e.preventDefault()}
              className={cx(
                'relative touch-none select-none cursor-grab',
                dragging === id && 'z-10 scale-105 cursor-grabbing drop-shadow-lg',
                isOut && flyClass,
                isNew && !isOut && 'animate-pop-in rounded-[18%]',
              )}
              style={isNew ? { animationDelay: `${incoming.indexOf(id) * 90}ms` } : undefined}
            >
              <Tile
                kind={kind}
                id={id}
                width={tileW}
                selected={isSel}
                dimmed={(!!focusVariant && !role && !isSel) || (selectable && disabled)}
                highlight={isNew ? 'gold' : role ? 'jade' : null}
                badge={role === 'exact' ? '◆' : null}
                showLabel={showLabels}
                ariaPressed={selectable ? isSel : undefined}
                testId={`tile-${kind}`}
                title={
                  disabled && selectable
                    ? 'Jokers can never be passed'
                    : role === 'exact'
                      ? `${kind}: fills an exact pair/single — no Joker can replace it`
                      : undefined
                }
                onClick={selectable && onToggle && !disabled ? () => onToggle(id) : undefined}
              />
              {isNew && <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wide text-[#a07a20]">new</span>}
            </div>
          );
        })}
      </div>
      {focusVariant && (
        <div className="mt-4 flex flex-wrap gap-4 justify-center text-[11px] text-ink-faint">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded ring-2 ring-jade-400" /> used by the highlighted hand</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-gold text-white text-[8px] flex items-center justify-center">◆</span> fills an exact pair/single (no Jokers)</span>
        </div>
      )}
    </div>
  );
}
