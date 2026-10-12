import { memo } from 'react';
import { isDragon, isSuited, isWind, kindName, type TileKind } from '../engine/tiles';

/**
 * American Mahjong tile faces drawn as SVG (no image assets): Dots, Bams (1 Bam is a bird),
 * Craks (Chinese numeral over 萬), Winds, Dragons (中 / 發 / blue-framed Soap), Flowers and
 * Jokers. Every tile also carries an American-style corner index for quick recognition.
 */

export type TileSize = 'xs' | 'sm' | 'md' | 'lg';

const WIDTH: Record<TileSize, number> = { xs: 22, sm: 30, md: 44, lg: 56 };

const C = {
  bam: '#1f7a4d',
  bamDark: '#145a37',
  crak: '#c0392b',
  dot: '#2257a6',
  ink: '#1c2b4a',
  gold: '#c99a2e',
  pink: '#d95f8c',
};

const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_WIND: Record<string, string> = { N: '北', E: '東', W: '西', S: '南' };

function Dot({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={r * 0.28} />
      <circle cx={x} cy={y} r={r * 0.52} fill={color} />
      <circle cx={x} cy={y} r={r * 0.18} fill="#fbf8f1" />
    </g>
  );
}

const DOT_LAYOUT: Record<number, [number, number, number][]> = {
  1: [[30, 41, 15]],
  2: [[30, 26, 9], [30, 56, 9]],
  3: [[17, 22, 7.5], [30, 41, 7.5], [43, 60, 7.5]],
  4: [[19, 28, 8.5], [41, 28, 8.5], [19, 54, 8.5], [41, 54, 8.5]],
  5: [[18, 24, 7.5], [42, 24, 7.5], [30, 41, 7.5], [18, 58, 7.5], [42, 58, 7.5]],
  6: [[19, 22, 7], [41, 22, 7], [19, 41, 7], [41, 41, 7], [19, 60, 7], [41, 60, 7]],
  7: [[15, 17, 5.5], [30, 24, 5.5], [45, 31, 5.5], [20, 47, 6.2], [40, 47, 6.2], [20, 62, 6.2], [40, 62, 6.2]],
  8: [[19, 17, 6], [41, 17, 6], [19, 32, 6], [41, 32, 6], [19, 48, 6], [41, 48, 6], [19, 63, 6], [41, 63, 6]],
  9: [[16, 22, 6], [30, 22, 6], [44, 22, 6], [16, 41, 6], [30, 41, 6], [44, 41, 6], [16, 60, 6], [30, 60, 6], [44, 60, 6]],
};

function dotColor(n: number, i: number): string {
  if (n === 1) return C.crak;
  if (n === 5 && i === 2) return C.crak;
  if (n === 7 && i < 3) return C.bam;
  if (n === 9 && i >= 3 && i < 6) return C.crak;
  if (n === 3 && i === 1) return C.crak;
  return i % 2 === 0 ? C.dot : C.bam;
}

function Stick({ x, y, h = 15, color = C.bam }: { x: number; y: number; h?: number; color?: string }) {
  return (
    <g>
      <rect x={x - 2.6} y={y - h / 2} width={5.2} height={h} rx={2.4} fill={color} />
      <rect x={x - 3.2} y={y - 0.9} width={6.4} height={1.8} rx={0.9} fill={C.bamDark} />
      <line x1={x} y1={y - h / 2 + 2} x2={x} y2={y + h / 2 - 2} stroke="#fbf8f1" strokeWidth={0.8} opacity={0.6} />
    </g>
  );
}

const BAM_LAYOUT: Record<number, [number, number, string?][]> = {
  2: [[30, 28], [30, 54]],
  3: [[30, 28], [21, 54], [39, 54]],
  4: [[21, 28], [39, 28], [21, 54], [39, 54]],
  5: [[19, 26], [41, 26], [30, 41, C.crak], [19, 56], [41, 56]],
  6: [[18, 30], [30, 30], [42, 30], [18, 54], [30, 54], [42, 54]],
  7: [[30, 20, C.crak], [18, 42], [30, 42], [42, 42], [18, 62], [30, 62], [42, 62]],
  8: [[15, 30], [25, 30], [35, 30], [45, 30], [15, 54], [25, 54], [35, 54], [45, 54]],
  9: [[18, 22, C.crak], [30, 22, C.dot], [42, 22, C.crak], [18, 41], [30, 41, C.dot], [42, 41], [18, 60, C.crak], [30, 60, C.dot], [42, 60, C.crak]],
};

function Bird() {
  return (
    <g>
      <path d="M18 58 Q14 44 24 36 Q30 32 36 36 Q44 42 40 54 Q36 62 26 62 Z" fill={C.bam} />
      <path d="M24 36 Q20 26 28 22 Q34 20 35 27 Q33 31 30 32" fill={C.bam} />
      <circle cx={31} cy={25} r={1.6} fill="#fbf8f1" />
      <path d="M35 25 L41 23 L36 28 Z" fill={C.gold} />
      <path d="M38 50 Q48 46 50 36 M40 54 Q50 54 52 46 M38 58 Q46 62 50 58" stroke={C.crak} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d="M22 50 Q28 46 34 50" stroke="#fbf8f1" strokeWidth={1.4} fill="none" />
      <path d="M24 62 L22 68 M28 62 L28 68" stroke={C.gold} strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

function Flower() {
  const petals = [0, 72, 144, 216, 288];
  return (
    <g>
      <path d="M30 46 Q28 58 32 68" stroke={C.bam} strokeWidth={2.2} fill="none" />
      <path d="M31 58 Q38 52 42 56 Q37 61 31 60" fill={C.bam} />
      {petals.map((a) => (
        <ellipse
          key={a}
          cx={30}
          cy={26}
          rx={6}
          ry={10}
          fill={C.pink}
          opacity={0.9}
          transform={`rotate(${a} 30 38)`}
        />
      ))}
      <circle cx={30} cy={38} r={5} fill={C.gold} />
      <circle cx={30} cy={38} r={2} fill="#fbf8f1" />
    </g>
  );
}

function Joker() {
  const letters = ['J', 'O', 'K', 'E', 'R'];
  const colors = [C.crak, C.bam, C.dot, C.crak, C.bam];
  return (
    <g>
      <path d="M30 6 L33 12 L40 12 L35 16 L37 22 L30 18 L23 22 L25 16 L20 12 L27 12 Z" fill={C.gold} />
      {letters.map((l, i) => (
        <text
          key={l}
          x={30}
          y={33 + i * 10}
          textAnchor="middle"
          fontSize={11}
          fontWeight={800}
          fontFamily="Inter, system-ui, sans-serif"
          fill={colors[i]}
        >
          {l}
        </text>
      ))}
    </g>
  );
}

function Soap() {
  return (
    <g>
      <rect x={13} y={16} width={34} height={50} rx={3} fill="none" stroke={C.dot} strokeWidth={3.2} />
      <rect x={18.5} y={21.5} width={23} height={39} rx={2} fill="none" stroke={C.dot} strokeWidth={1.4} />
      <path d="M13 28 h5 M13 41 h5 M13 54 h5 M42 28 h5 M42 41 h5 M42 54 h5" stroke={C.dot} strokeWidth={1.6} />
    </g>
  );
}

function CornerIndex({ text, color }: { text: string; color: string }) {
  return (
    <text x={6.5} y={13} fontSize={9.5} fontWeight={700} fontFamily="Inter, system-ui, sans-serif" fill={color}>
      {text}
    </text>
  );
}

function Face({ kind }: { kind: TileKind }) {
  if (isSuited(kind)) {
    const n = Number(kind[0]);
    const s = kind[1];
    if (s === 'D') {
      return (
        <>
          {DOT_LAYOUT[n].map(([x, y, r], i) => (
            <Dot key={i} x={x} y={y} r={r} color={dotColor(n, i)} />
          ))}
          <CornerIndex text={String(n)} color={C.dot} />
        </>
      );
    }
    if (s === 'B') {
      return (
        <>
          {n === 1 ? <Bird /> : BAM_LAYOUT[n].map(([x, y, col], i) => <Stick key={i} x={x} y={y} color={col ?? C.bam} />)}
          <CornerIndex text={String(n)} color={C.bam} />
        </>
      );
    }
    return (
      <>
        <text x={30} y={38} textAnchor="middle" fontSize={22} fontWeight={700} fill={C.ink} fontFamily='"Songti SC","Noto Serif SC","SimSun",serif'>
          {CN_NUM[n]}
        </text>
        <text x={30} y={66} textAnchor="middle" fontSize={23} fontWeight={700} fill={C.crak} fontFamily='"Songti SC","Noto Serif SC","SimSun",serif'>
          萬
        </text>
        <CornerIndex text={String(n)} color={C.crak} />
      </>
    );
  }
  if (isWind(kind)) {
    return (
      <>
        <text x={30} y={54} textAnchor="middle" fontSize={30} fontWeight={700} fill={C.ink} fontFamily='"Songti SC","Noto Serif SC","SimSun",serif'>
          {CN_WIND[kind]}
        </text>
        <CornerIndex text={kind} color={C.ink} />
      </>
    );
  }
  if (isDragon(kind)) {
    if (kind === 'WD') return <><Soap /><CornerIndex text="Wh" color={C.dot} /></>;
    const red = kind === 'RD';
    return (
      <>
        <text x={30} y={54} textAnchor="middle" fontSize={red ? 34 : 30} fontWeight={800} fill={red ? C.crak : C.bam} fontFamily='"Songti SC","Noto Serif SC","SimSun",serif'>
          {red ? '中' : '發'}
        </text>
        <CornerIndex text={red ? 'R' : 'G'} color={red ? C.crak : C.bam} />
      </>
    );
  }
  if (kind === 'F') return <><Flower /><CornerIndex text="F" color={C.pink} /></>;
  return <Joker />;
}

export interface TileProps {
  kind: TileKind;
  size?: TileSize;
  selected?: boolean;
  dimmed?: boolean;
  highlight?: 'gold' | 'jade' | null;
  badge?: string | null;
  showLabel?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
  ariaPressed?: boolean;
  testId?: string;
  /** Explicit pixel width (overrides size). */
  width?: number;
}

/** Short label shown under tiles when "tile labels" is on. */
export function shortLabel(kind: TileKind): string {
  if (isSuited(kind)) return `${kind[0]} ${kind[1] === 'B' ? 'Bam' : kind[1] === 'C' ? 'Crak' : 'Dot'}`;
  if (isWind(kind)) return kindName(kind);
  if (kind === 'RD') return 'Red';
  if (kind === 'GD') return 'Green';
  if (kind === 'WD') return 'Soap';
  return kind === 'F' ? 'Flower' : 'Joker';
}

export const Tile = memo(function Tile({
  kind,
  size = 'lg',
  selected,
  dimmed,
  highlight,
  badge,
  showLabel,
  onClick,
  className = '',
  title,
  ariaPressed,
  testId,
  width,
}: TileProps) {
  const w = width ?? WIDTH[size];
  const h = Math.round((w * 82) / 60);
  const interactive = !!onClick;
  const ring =
    highlight === 'gold'
      ? 'ring-2 ring-[color:var(--color-gold)]'
      : highlight === 'jade'
        ? 'ring-2 ring-jade-400'
        : '';
  const body = (
    <span
      className={`relative inline-block transition-transform duration-150 ${selected ? '-translate-y-3' : ''} ${
        interactive && !selected ? 'group-hover:-translate-y-1' : ''
      } ${dimmed ? 'opacity-40' : ''}`}
      style={{ width: w, height: h }}
    >
      <svg viewBox="0 0 60 82" width={w} height={h} className={`block rounded-[18%] ${ring}`} style={{ boxShadow: 'var(--shadow-tile)' }} aria-hidden>
        <defs>
          <linearGradient id="tileFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="1" stopColor="#f3eee2" />
          </linearGradient>
        </defs>
        <rect x={0.5} y={3} width={59} height={78.5} rx={9} fill={selected ? '#2f876a' : '#1f6f5c'} />
        <rect x={0.5} y={0.5} width={59} height={76} rx={9} fill="url(#tileFace)" stroke={selected ? '#2f876a' : '#d8d0bf'} strokeWidth={selected ? 2 : 1} />
        <Face kind={kind} />
      </svg>
      {badge && (
        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-[color:var(--color-gold)] text-[9px] font-bold text-white flex items-center justify-center shadow">
          {badge}
        </span>
      )}
    </span>
  );
  const label = showLabel ? (
    <span className="block text-center text-[10px] leading-tight text-ink-soft mt-1 whitespace-nowrap">{shortLabel(kind)}</span>
  ) : null;
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? kindName(kind)}
        aria-label={kindName(kind)}
        aria-pressed={ariaPressed}
        data-testid={testId}
        data-kind={kind}
        className={`group inline-flex flex-col items-center bg-transparent border-0 p-0 ${className}`}
      >
        {body}
        {label}
      </button>
    );
  }
  return (
    <span className={`inline-flex flex-col items-center ${className}`} title={title ?? kindName(kind)} data-kind={kind} data-testid={testId}>
      {body}
      {label}
    </span>
  );
});
