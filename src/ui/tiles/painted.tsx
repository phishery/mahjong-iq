/**
 * "Painted" tile style: porcelain-white faces with hand-painted colours, a striped edge
 * (blush, vermilion, blush) over a glossy olive back — palette taken from a real set the
 * owner plays with, but the drawings are our own.
 *
 * Correct by construction: every pip, stick and character is placed by code from fixed
 * layouts (the same counts as the classic style). Decorative art (flowers, jokers, the
 * 1 Bam bird) may later be replaced by illustrated images, but never anything that carries
 * meaning; the corner index is always drawn by code.
 */

import { isDragon, isSuited, isWind, type TileKind } from '../../engine/tiles';
import falconBack from './art/falcon-back.svg';
import falconBamboo from './art/falcon-bamboo.svg';
import falconJester from './art/falcon-jester.svg';
import camellia from './art/flower-camellia.svg';
import cherry from './art/flower-cherry.svg';
import chrysanthemum from './art/flower-chrysanthemum.svg';
import lotus from './art/flower-lotus.svg';
import morningGlory from './art/flower-morning-glory.svg';
import orchid from './art/flower-orchid.svg';
import peony from './art/flower-peony.svg';
import plum from './art/flower-plum.svg';

/**
 * Illustrations made with Higgsfield (GPT Image, SVG output) and checked by hand. They are
 * decoration only: Flowers, the Joker ornament, the 1 Bam bird and the back emblem. Nothing
 * that identifies a tile depends on them — the corner index and the word JOKER are drawn here.
 */
const FLOWER_ART = [plum, peony, chrysanthemum, orchid, lotus, cherry, camellia, morningGlory];

export const P = {
  face: '#f6f7fb',
  faceShade: '#e7eaf3',
  blush: '#f6d8d3',
  vermilion: '#ee5a2a',
  olive: '#9aad2c',
  oliveDark: '#7f9022',
  ink: '#262a33',
  blue: '#3f8fd6',
  pink: '#ea7fab',
  pinkPale: '#f9d3e2',
  red: '#e2452b',
  green: '#5f9a35',
  greenDark: '#3f7424',
  gold: '#e3a72f',
};

const BRUSH = '"Ma Shan Zheng","Songti SC","Noto Serif SC","SimSun",serif';
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_WIND: Record<string, string> = { N: '北', E: '東', W: '西', S: '南' };

/** Height of the face; the striped edge fills the rest of the 82-unit tile. */
export const FACE_H = 71;

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/** Tile body: striped edge plus face. `uid` keeps gradient ids unique per tile. */
export function PaintedBody({ uid, selected, children }: { uid: string; selected?: boolean; children: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id={`pf-${uid}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor={P.face} />
          <stop offset="1" stopColor={P.faceShade} />
        </linearGradient>
        <clipPath id={`pc-${uid}`}>
          <rect x={0.5} y={0.5} width={59} height={81} rx={9} />
        </clipPath>
      </defs>
      <g clipPath={`url(#pc-${uid})`}>
        {/* Edge layers, seen from the front: blush, vermilion, blush, then the olive back. */}
        <rect x={0} y={60} width={60} height={22} fill={P.olive} />
        <rect x={0} y={60} width={60} height={19.4} fill={P.blush} />
        <rect x={0} y={60} width={60} height={17.6} fill={P.vermilion} />
        <rect x={0} y={60} width={60} height={15.2} fill={P.blush} />
        <rect x={0.5} y={0.5} width={59} height={FACE_H} rx={9} fill={`url(#pf-${uid})`} />
        {/* Soft gloss along the top edge. */}
        <path d="M8 3.2 H52 Q56.6 3.2 56.6 7.4" stroke="#ffffff" strokeWidth={1.6} fill="none" opacity={0.9} strokeLinecap="round" />
      </g>
      <rect
        x={0.5}
        y={0.5}
        width={59}
        height={81}
        rx={9}
        fill="none"
        stroke={selected ? P.olive : '#cfd3de'}
        strokeWidth={selected ? 2 : 0.8}
      />
      {children}
    </>
  );
}

/** The back of a tile: glossy olive with the falcon emblem. */
export function PaintedBack({ uid }: { uid: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`pb-${uid}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#b2c43e" />
          <stop offset="1" stopColor={P.oliveDark} />
        </linearGradient>
        <clipPath id={`pbc-${uid}`}>
          <rect x={0.5} y={0.5} width={59} height={81} rx={9} />
        </clipPath>
      </defs>
      <g clipPath={`url(#pbc-${uid})`}>
        <rect x={0} y={60} width={60} height={22} fill={P.blush} />
        <rect x={0} y={60} width={60} height={19.4} fill={P.vermilion} />
        <rect x={0} y={60} width={60} height={17.6} fill={P.blush} />
        <rect x={0.5} y={0.5} width={59} height={77} rx={9} fill={`url(#pb-${uid})`} />
        <path d="M8 3.2 H52 Q56.6 3.2 56.6 7.4" stroke="#ffffff" strokeWidth={1.6} fill="none" opacity={0.55} strokeLinecap="round" />
      </g>
      <image href={falconBack} x={9} y={13} width={42} height={42} preserveAspectRatio="xMidYMid meet" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

function Corner({ text, color }: { text: string; color: string }) {
  return (
    <text x={6.4} y={12.6} fontSize={9.5} fontWeight={700} fontFamily="Inter, system-ui, sans-serif" fill={color}>
      {text}
    </text>
  );
}

/** A painted coin: coloured ring, pale body, petal-like centre. */
function Coin({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#ffffff" stroke={color} strokeWidth={r * 0.32} />
      <circle cx={x} cy={y} r={r * 0.5} fill={color} opacity={0.85} />
      <circle cx={x - r * 0.16} cy={y - r * 0.16} r={r * 0.17} fill="#ffffff" />
    </g>
  );
}

// Same positions and counts as the classic style; y values shifted to the shorter face.
const DOTS: Record<number, [number, number, number][]> = {
  1: [[30, 37, 14]],
  2: [[30, 23, 8.6], [30, 51, 8.6]],
  3: [[17, 19, 7.2], [30, 37, 7.2], [43, 55, 7.2]],
  4: [[19, 25, 8.2], [41, 25, 8.2], [19, 50, 8.2], [41, 50, 8.2]],
  5: [[18, 21, 7.2], [42, 21, 7.2], [30, 37, 7.2], [18, 53, 7.2], [42, 53, 7.2]],
  6: [[19, 19, 6.8], [41, 19, 6.8], [19, 37, 6.8], [41, 37, 6.8], [19, 55, 6.8], [41, 55, 6.8]],
  7: [[15, 15, 5.3], [30, 22, 5.3], [45, 29, 5.3], [20, 43, 6], [40, 43, 6], [20, 57, 6], [40, 57, 6]],
  8: [[19, 15, 5.8], [41, 15, 5.8], [19, 29, 5.8], [41, 29, 5.8], [19, 44, 5.8], [41, 44, 5.8], [19, 58, 5.8], [41, 58, 5.8]],
  9: [[16, 19, 5.8], [30, 19, 5.8], [44, 19, 5.8], [16, 37, 5.8], [30, 37, 5.8], [44, 37, 5.8], [16, 55, 5.8], [30, 55, 5.8], [44, 55, 5.8]],
};

function coinColor(n: number, i: number): string {
  if (n === 1) return P.pink;
  if (n === 3) return [P.blue, P.red, P.green][i];
  if (n === 5 && i === 2) return P.red;
  if (n === 7) return i < 3 ? P.green : i % 2 ? P.blue : P.red;
  if (n === 9) return i < 3 ? P.blue : i < 6 ? P.red : P.green;
  return i % 2 === 0 ? P.blue : P.green;
}

/** A bamboo stick with two nodes. */
function Stick({ x, y, h = 18, color = P.green }: { x: number; y: number; h?: number; color?: string }) {
  return (
    <g>
      <rect x={x - 3.2} y={y - h / 2} width={6.4} height={h} rx={3.2} fill={color} />
      <path d={`M${x - 3.8} ${y - h / 6} h7.6 M${x - 3.8} ${y + h / 6} h7.6`} stroke={P.greenDark} strokeWidth={1.2} strokeLinecap="round" />
      <path d={`M${x - 0.9} ${y - h / 2 + 2.2} v${h - 4.4}`} stroke="#ffffff" strokeWidth={0.9} opacity={0.55} strokeLinecap="round" />
    </g>
  );
}

const STICKS: Record<number, [number, number, string?][]> = {
  2: [[30, 24], [30, 50]],
  3: [[30, 24], [21, 50], [39, 50]],
  4: [[21, 24], [39, 24], [21, 50], [39, 50]],
  5: [[19, 22], [41, 22], [30, 37, P.red], [19, 52], [41, 52]],
  6: [[18, 26], [30, 26], [42, 26], [18, 50], [30, 50], [42, 50]],
  7: [[30, 17, P.red], [18, 38], [30, 38], [42, 38], [18, 57], [30, 57], [42, 57]],
  8: [[14.5, 25], [25, 25], [35, 25], [45.5, 25], [14.5, 50], [25, 50], [35, 50], [45.5, 50]],
  9: [[18, 19, P.red], [30, 19, P.blue], [42, 19, P.red], [18, 37], [30, 37, P.blue], [42, 37], [18, 55, P.red], [30, 55, P.blue], [42, 55, P.red]],
};

function JokerArt() {
  const letters = ['J', 'O', 'K', 'E', 'R'];
  const colors = [P.red, P.green, P.blue, P.pink, P.vermilion];
  return (
    <g>
      <image href={falconJester} x={8} y={5} width={44} height={44} preserveAspectRatio="xMidYMid meet" />
      <text x={30} y={63} textAnchor="middle" fontSize={12.5} fontWeight={800} fontFamily="Fraunces, Georgia, serif" letterSpacing={0.3}>
        {letters.map((l, i) => (
          <tspan key={l} fill={colors[i]}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function SoapFrame() {
  return (
    <g fill="none" stroke={P.blue}>
      <rect x={13} y={13} width={34} height={48} rx={5} strokeWidth={3} />
      <rect x={18.5} y={18.5} width={23} height={37} rx={3} strokeWidth={1.3} />
      {[22, 37, 52].map((y) => (
        <g key={y}>
          <circle cx={15.6} cy={y} r={0.9} fill={P.blue} stroke="none" />
          <circle cx={44.4} cy={y} r={0.9} fill={P.blue} stroke="none" />
        </g>
      ))}
    </g>
  );
}

function Brush({ text, y, size, color }: { text: string; y: number; size: number; color: string }) {
  return (
    <text x={30} y={y} textAnchor="middle" fontSize={size} fill={color} fontFamily={BRUSH}>
      {text}
    </text>
  );
}

/** Face artwork for a kind. `variant` picks one of the eight Flower designs. */
export function PaintedFace({ kind, variant = 0 }: { kind: TileKind; variant?: number }) {
  if (isSuited(kind)) {
    const n = Number(kind[0]);
    const s = kind[1];
    if (s === 'D') {
      return (
        <>
          {DOTS[n].map(([x, y, r], i) => (
            <Coin key={i} x={x} y={y} r={r} color={coinColor(n, i)} />
          ))}
          <Corner text={String(n)} color={P.blue} />
        </>
      );
    }
    if (s === 'B') {
      return (
        <>
          {n === 1 ? <Art href={falconBamboo} /> : STICKS[n].map(([x, y, c], i) => <Stick key={i} x={x} y={y} color={c ?? P.green} />)}
          <Corner text={String(n)} color={P.green} />
        </>
      );
    }
    return (
      <>
        <Brush text={CN_NUM[n]} y={33} size={22} color={P.ink} />
        <Brush text="萬" y={62} size={25} color={P.red} />
        <Corner text={String(n)} color={P.red} />
      </>
    );
  }
  if (isWind(kind)) {
    return (
      <>
        <Brush text={CN_WIND[kind]} y={50} size={33} color={P.ink} />
        <Corner text={kind} color={P.ink} />
      </>
    );
  }
  if (isDragon(kind)) {
    if (kind === 'WD') {
      return (
        <>
          <SoapFrame />
          <Corner text="Wh" color={P.blue} />
        </>
      );
    }
    const red = kind === 'RD';
    return (
      <>
        <Brush text={red ? '中' : '發'} y={51} size={red ? 37 : 33} color={red ? P.red : P.green} />
        <Corner text={red ? 'R' : 'G'} color={red ? P.red : P.green} />
      </>
    );
  }
  if (kind === 'F') {
    return (
      <>
        <Art href={FLOWER_ART[variant % FLOWER_ART.length]} />
        <Corner text="F" color={P.pink} />
      </>
    );
  }
  return <JokerArt />;
}

/** An illustration filling the face below the corner index. */
function Art({ href }: { href: string }) {
  return <image href={href} x={6} y={13} width={48} height={56} preserveAspectRatio="xMidYMid meet" />;
}
