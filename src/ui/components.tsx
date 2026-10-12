import { useEffect, type ReactNode } from 'react';
import type { Basis } from '../engine/analysis';
import type { HandLine, HandVariant, SuitVar } from '../engine/card/schema';
import { patternDisplayTokens } from '../engine/card/parser';
import { matchVariant } from '../engine/evaluator';
import type { SimResult } from '../engine/simulate';
import { type Counts, type TileKind } from '../engine/tiles';
import { Tile } from './Tile';

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-jade-600 text-white hover:bg-jade-700 shadow-sm disabled:bg-jade-200 disabled:text-white',
    secondary: 'bg-white text-jade-700 border border-jade-200 hover:bg-jade-50 disabled:opacity-50',
    ghost: 'bg-transparent text-ink-soft hover:bg-black/5 disabled:opacity-40',
    danger: 'bg-white text-crak border border-red-200 hover:bg-red-50',
  };
  const s = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[size];
  return (
    <button
      type="button"
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors', v[variant], s, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('bg-white rounded-2xl border border-line shadow-[var(--shadow-card)]', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({
  active,
  children,
  onClick,
  className,
  disabled,
  testId,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={active}
      className={cx(
        'h-8 px-3 rounded-full text-sm font-medium border transition-colors',
        active ? 'bg-jade-600 border-jade-600 text-white' : 'bg-white border-line text-ink-soft hover:border-jade-300 hover:text-jade-700',
        disabled && 'opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2 cursor-pointer">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-faint mt-0.5">{hint}</span>}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="block w-10 h-6 rounded-full bg-line peer-checked:bg-jade-500 transition-colors" />
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-paper border border-line" data-testid={testId}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 px-3 rounded-lg text-sm font-medium transition-colors',
            value === o.value ? 'bg-white shadow-sm text-jade-700' : 'text-ink-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-[2px] p-0 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className={cx('bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col animate-fade-up', wide ? 'sm:max-w-4xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-black/5 text-ink-soft" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="overflow-y-auto scrollbar-thin p-5">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <div className={cx('fixed inset-0 z-40 transition-opacity', open ? 'opacity-100' : 'opacity-0 pointer-events-none')} aria-hidden={!open}>
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside
        className={cx(
          'absolute right-0 top-0 h-full w-full sm:w-[560px] bg-ivory shadow-2xl flex flex-col transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-label="Card reference"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-line bg-white">
          <div className="font-display text-xl font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-black/5 text-ink-soft" aria-label="Close card reference">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
      </aside>
    </div>
  );
}

const SUITVAR_COLOR: Record<SuitVar, string> = { A: 'text-bam', B: 'text-crak', C: 'text-dot' };

function joinsPrevious(tokens: { count: number; suitVar: SuitVar | null }[], i: number): boolean {
  const a = tokens[i - 1];
  const b = tokens[i];
  return a.count === 1 && b.count === 1 && (a.suitVar === b.suitVar || a.suitVar === null || b.suitVar === null);
}

/** NMJL-style colour-coded pattern text, e.g. "FF 1111 2222 3333". */
export function PatternText({ line, className, alt }: { line: HandLine; className?: string; alt?: number }) {
  const alts = alt === undefined ? line.alternatives.map((_, i) => i) : [alt];
  return (
    <span className={cx('font-mono font-semibold tracking-wide', className)}>
      {alts.map((a, ai) => {
        const tokens = patternDisplayTokens(line, a);
        return (
          <span key={a}>
            {ai > 0 && <span className="mx-2 font-sans text-[0.75em] font-normal italic text-ink-faint">-or-</span>}
            {tokens.map((t, i) => (
              // Adjacent singles (e.g. the year "2026") are written together, as on the card.
              <span key={i} className={cx(t.suitVar ? SUITVAR_COLOR[t.suitVar] : 'text-ink', i > 0 && !joinsPrevious(tokens, i) && 'ml-2')}>
                {t.text}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

/** A concrete hand variant drawn as mini tiles, dimming tiles the rack does not hold. */
export function VariantTiles({ variant, rack, size = 'xs' }: { variant: HandVariant; rack?: Counts; size?: 'xs' | 'sm' }) {
  const m = rack ? matchVariant(rack, variant) : null;
  return (
    <span className="inline-flex flex-wrap items-end gap-x-2 gap-y-1">
      {variant.groups.map((g, gi) => {
        const fill = m?.groups[gi];
        return (
          <span key={gi} className="inline-flex gap-px">
            {Array.from({ length: g.count }, (_, i) => {
              const held = fill ? i < fill.naturals : true;
              const joker = fill ? !held && i < fill.naturals + fill.jokers : false;
              return <Tile key={i} kind={joker ? 'J' : (g.kind as TileKind)} size={size} dimmed={!!fill && !held && !joker} />;
            })}
          </span>
        );
      })}
    </span>
  );
}

export function BasisBadge({ basis }: { basis: Basis }) {
  return basis === 'simulation' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-dot/10 text-dot px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" title="Monte Carlo completion probability under the documented draw/call model">
      ◷ Simulated probability
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-[#8a6a1c] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" title="Deterministic heuristic opportunity score (0–100). Not a probability.">
      ◆ Heuristic score
    </span>
  );
}

export function SimValue({ sim }: { sim?: SimResult }) {
  if (!sim) return <span className="text-ink-faint">—</span>;
  return (
    <span title={`95% interval ${(sim.lo * 100).toFixed(1)}–${(sim.hi * 100).toFixed(1)}% · ${sim.trials.toLocaleString()} simulations`}>
      {(sim.p * 100).toFixed(1)}%
      <span className="text-ink-faint text-[11px] ml-1">±{(((sim.hi - sim.lo) / 2) * 100).toFixed(1)}</span>
    </span>
  );
}

export function CreditBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? 'bg-jade-500' : value >= 0.7 ? 'bg-jade-400' : value >= 0.45 ? 'bg-gold' : 'bg-crak/70';
  return (
    <span className={cx('block h-1.5 rounded-full bg-line overflow-hidden', className)}>
      <span className={cx('block h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </span>
  );
}
