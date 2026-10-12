/**
 * Round state machine (pure, serialisable, React-free).
 *
 *   rank ──submitRanking──▶ pass ──submitPass──▶ rank ──▶ … ──▶ vote ──▶ pass … ──▶
 *   courtesy-request ──▶ courtesy-select ──▶ rank ──▶ done
 *
 * After every exchange the player MUST submit a fresh ranking before anything else can
 * happen (critical training requirement). Tile ownership is tracked by physical id; every
 * transition preserves all 152 tiles (see assertConservation).
 */

import { buildCandidates, type DecisionAnalysis, type Level, type Selection } from './analysis';
import type { LoadedCard } from './card/schema';
import {
  COURTESY_STEP,
  courtesyAgreement,
  executeCourtesy,
  executePass,
  FIRST_CHARLESTON,
  giverTo,
  ownTilesRequired,
  PassError,
  RULES,
  SEAT_ORDER,
  SECOND_CHARLESTON,
  secondCharlestonProceeds,
  validatePass,
  type PassStep,
  type Racks,
  type Seat,
} from './charleston';
import { analyzeRack, type PlayerKnowledge } from './heuristic';
import { choosePass, courtesyRequest, wantsSecondCharleston, type OpponentProfile } from './opponents';
import { gradePass, type PassGrade } from './passes';
import { createRng, mixSeed, sample, shuffle } from './rng';
import type { RankingGrade } from './scoring';
import { allTileIds, countsFromIds, KIND_OF_ID, TOTAL_TILES, type TileId } from './tiles';

export type Mode = 'beginner' | 'hybrid' | 'advanced';
export type RoundLength = 'opening' | 'two-pass' | 'first' | 'full';

export const MODE_INFO: Record<Mode, { name: string; blurb: string }> = {
  beginner: { name: 'Beginner', blurb: 'Rank card categories after every pass.' },
  hybrid: { name: 'Hybrid', blurb: 'Start with categories, then narrow to card lines and exact hands.' },
  advanced: { name: 'Advanced', blurb: 'Rank exact hands — line, suits and numbers — from the deal onward.' },
};

export const LENGTH_INFO: Record<RoundLength, { name: string; blurb: string }> = {
  opening: { name: 'Opening rack', blurb: 'One decision, instant grading — the fastest drill.' },
  'two-pass': { name: 'Two-pass challenge', blurb: 'Opening rack plus the first two passes.' },
  first: { name: 'Quick round', blurb: 'First Charleston only (under 90 seconds).' },
  full: { name: 'Full Charleston', blurb: 'Both Charlestons, blind passes and a courtesy pass.' },
};

export interface RoundConfig {
  mode: Mode;
  length: RoundLength;
  seed: number;
  opponents: OpponentProfile;
  courtesy: boolean;
  /** Targeted practice: deal is selected so one of these categories is the strongest. */
  targetCategories?: string[];
}

export type Phase = 'rank' | 'pass' | 'vote' | 'courtesy-request' | 'courtesy-select' | 'done';

export interface DecisionRecord {
  index: number;
  level: Level;
  stepLabel: string;
  rack: TileId[];
  knownElsewhere: number[];
  picks: Selection[];
  grade: RankingGrade;
  analysis: DecisionAnalysis;
  confidence?: number;
  ms?: number;
}

export interface PassRecord {
  step: PassStep;
  rackBefore: TileId[];
  passed: TileId[];
  blind: number;
  forwarded: TileId[];
  received: TileId[];
  rackAfter: TileId[];
  grade: PassGrade;
  /** Best heuristic opportunity before passing vs after receiving (actual outcome). */
  outcome: { before: number; after: number };
}

export interface RoundState {
  config: RoundConfig;
  cardId: string;
  racks: Racks;
  wall: TileId[];
  dealer: Seat;
  phase: Phase;
  schedule: PassStep[];
  /** Index of the next pass in `schedule`. */
  stepIndex: number;
  decisions: DecisionRecord[];
  passes: PassRecord[];
  /** Every tile each seat has passed (from their own rack) during the round. */
  passHistory: Record<Seat, TileId[]>;
  secondCharleston: 'na' | 'pending' | 'yes' | 'no';
  votes?: Record<Seat, boolean>;
  courtesy: { status: 'na' | 'pending' | 'agreed' | 'done'; requested?: number; partnerWants?: number; agreed?: number };
  /** Tiles received in the most recent exchange (for highlighting). */
  lastReceived: TileId[];
  /** True when the deal was deliberately selected (targeted practice), not unbiased random. */
  selectedDeal: boolean;
  startedAt: number;
}

export function levelFor(mode: Mode, decisionIndex: number): Level {
  if (mode === 'beginner') return 'category';
  if (mode === 'advanced') return 'variant';
  if (decisionIndex <= 1) return 'category';
  if (decisionIndex === 2) return 'line';
  return 'variant';
}

export function initialSchedule(length: RoundLength): PassStep[] {
  if (length === 'opening') return [];
  if (length === 'two-pass') return FIRST_CHARLESTON.slice(0, 2);
  return [...FIRST_CHARLESTON];
}

function deal(seed: number): { racks: Racks; wall: TileId[]; dealer: Seat } {
  const rng = createRng(mixSeed(seed, 1));
  const ids = shuffle(allTileIds(), rng);
  const dealer = SEAT_ORDER[1 + rng.int(3)]; // the player is always a non-dealer
  const racks: Racks = { you: [], right: [], across: [], left: [] };
  let p = 0;
  for (const seat of SEAT_ORDER) {
    const n = seat === dealer ? RULES.dealerTiles : RULES.playerTiles;
    racks[seat] = ids.slice(p, p + n);
    p += n;
  }
  return { racks, wall: ids.slice(p), dealer };
}

export function startRound(card: LoadedCard, config: RoundConfig): RoundState {
  let dealt = deal(config.seed);
  let selectedDeal = false;
  if (config.targetCategories?.length) {
    const targets = new Set(config.targetCategories);
    for (let attempt = 0; attempt < 300; attempt++) {
      const candidate = deal(mixSeed(config.seed, 1000 + attempt));
      const a = analyzeRack(card, { rack: countsFromIds(candidate.racks.you), knownElsewhere: countsFromIds([]) });
      if (targets.has(a.ranked[0].variant.categoryId)) {
        dealt = candidate;
        selectedDeal = true;
        break;
      }
    }
  }
  const state: RoundState = {
    config,
    cardId: card.def.id,
    ...dealt,
    phase: 'rank',
    schedule: initialSchedule(config.length),
    stepIndex: 0,
    decisions: [],
    passes: [],
    passHistory: { you: [], right: [], across: [], left: [] },
    secondCharleston: config.length === 'full' ? 'pending' : 'na',
    courtesy: { status: config.length === 'full' && config.courtesy ? 'pending' : 'na' },
    lastReceived: [],
    selectedDeal,
    startedAt: Date.now(),
  };
  assertConservation(state);
  return state;
}

/** Everything the player legitimately knows. Opponent racks are never included. */
export function playerKnowledge(state: RoundState): PlayerKnowledge {
  const inRack = new Set(state.racks.you);
  const away = state.passHistory.you.filter((id) => !inRack.has(id));
  return { rack: countsFromIds(state.racks.you), knownElsewhere: countsFromIds(away) };
}

function opponentView(state: RoundState, seat: Seat) {
  const inRack = new Set(state.racks[seat]);
  return { rack: state.racks[seat], passedAway: state.passHistory[seat].filter((id) => !inRack.has(id)) };
}

export function currentLevel(state: RoundState): Level {
  return levelFor(state.config.mode, state.decisions.length);
}

export function currentStep(state: RoundState): PassStep | null {
  if (state.phase === 'courtesy-request' || state.phase === 'courtesy-select') return COURTESY_STEP;
  return state.schedule[state.stepIndex] ?? null;
}

export function decisionLabel(state: RoundState): string {
  if (state.decisions.length === 0) return 'Opening rack';
  const last = state.passes[state.passes.length - 1];
  return last ? `After ${last.step.label}` : 'Opening rack';
}

/** Analysis for the current decision (heuristic only; simulation is attached by the caller). */
export function analyzeCurrent(card: LoadedCard, state: RoundState): DecisionAnalysis {
  return buildCandidates(card, playerKnowledge(state), currentLevel(state));
}

function nextPhaseAfterDecision(state: RoundState): Phase {
  if (state.stepIndex < state.schedule.length) return 'pass';
  if (state.secondCharleston === 'pending') return 'vote';
  if (state.courtesy.status === 'pending') return 'courtesy-request';
  return 'done';
}

export function submitRanking(
  state: RoundState,
  picks: Selection[],
  analysis: DecisionAnalysis,
  grade: RankingGrade,
  extra: { confidence?: number; ms?: number } = {},
): RoundState {
  if (state.phase !== 'rank') throw new Error(`Cannot rank during phase "${state.phase}"`);
  const level = currentLevel(state);
  if (picks.length !== 3 || picks.some((p) => p.level !== level)) {
    throw new Error(`Rank exactly three ${level} selections`);
  }
  const know = playerKnowledge(state);
  const record: DecisionRecord = {
    index: state.decisions.length,
    level,
    stepLabel: decisionLabel(state),
    rack: [...state.racks.you],
    knownElsewhere: know.knownElsewhere,
    picks,
    grade,
    analysis,
    ...extra,
  };
  const next = { ...state, decisions: [...state.decisions, record] };
  next.phase = nextPhaseAfterDecision(next);
  return next;
}

function bestScore(card: LoadedCard, know: PlayerKnowledge): number {
  return analyzeRack(card, know).ranked[0]?.score ?? 0;
}

export function submitPass(card: LoadedCard, state: RoundState, ownTiles: TileId[], blind = 0): RoundState {
  if (state.phase !== 'pass') throw new Error(`Cannot pass during phase "${state.phase}"`);
  const step = state.schedule[state.stepIndex];
  const required = ownTilesRequired(step, blind);
  validatePass(state.racks.you, ownTiles, required);

  const rng = createRng(mixSeed(state.config.seed, 100 + state.stepIndex));
  const chosen: Record<Seat, TileId[]> = { you: ownTiles, right: [], across: [], left: [] };
  for (const seat of SEAT_ORDER) {
    if (seat === 'you') continue;
    chosen[seat] = choosePass(card, opponentView(state, seat), RULES.tilesPerPass, state.config.opponents, rng);
  }
  const incoming = chosen[giverTo('you', step.direction)];
  const forwarded = blind > 0 ? sample(incoming, blind, rng) : [];

  const knowBefore = playerKnowledge(state);
  const grade = gradePass(card, knowBefore, ownTiles.map((id) => KIND_OF_ID[id]));
  const res = executePass(state.racks, chosen, step.direction, forwarded);

  const passHistory = { ...state.passHistory };
  for (const seat of SEAT_ORDER) passHistory[seat] = [...passHistory[seat], ...chosen[seat]];
  const next: RoundState = {
    ...state,
    racks: res.racks,
    passHistory,
    stepIndex: state.stepIndex + 1,
    phase: 'rank',
    lastReceived: res.received.you,
  };
  const knowAfter = playerKnowledge(next);
  next.passes = [
    ...state.passes,
    {
      step,
      rackBefore: [...state.racks.you],
      passed: [...ownTiles],
      blind,
      forwarded,
      received: res.received.you,
      rackAfter: [...res.racks.you],
      grade,
      outcome: { before: bestScore(card, knowBefore), after: bestScore(card, knowAfter) },
    },
  ];
  assertConservation(next);
  return next;
}

export function voteSecondCharleston(card: LoadedCard, state: RoundState, youContinue: boolean): RoundState {
  if (state.phase !== 'vote') throw new Error('No vote is pending');
  const rng = createRng(mixSeed(state.config.seed, 500));
  const votes = { you: youContinue } as Record<Seat, boolean>;
  for (const seat of SEAT_ORDER) {
    if (seat !== 'you') votes[seat] = wantsSecondCharleston(card, opponentView(state, seat), state.config.opponents, rng);
  }
  const proceeds = secondCharlestonProceeds(votes);
  const next: RoundState = {
    ...state,
    votes,
    secondCharleston: proceeds ? 'yes' : 'no',
    schedule: proceeds ? [...state.schedule, ...SECOND_CHARLESTON] : state.schedule,
  };
  next.phase = proceeds ? 'pass' : state.courtesy.status === 'pending' ? 'courtesy-request' : 'done';
  return next;
}

export function requestCourtesy(card: LoadedCard, state: RoundState, requested: number): RoundState {
  if (state.phase !== 'courtesy-request') throw new Error('No courtesy pass is pending');
  const rng = createRng(mixSeed(state.config.seed, 600));
  const partnerWants = courtesyRequest(card, opponentView(state, 'across'), state.config.opponents, rng);
  const agreed = courtesyAgreement(requested, partnerWants);
  return {
    ...state,
    courtesy: { status: agreed > 0 ? 'agreed' : 'done', requested, partnerWants, agreed },
    phase: agreed > 0 ? 'courtesy-select' : 'done',
  };
}

export function submitCourtesy(card: LoadedCard, state: RoundState, ownTiles: TileId[]): RoundState {
  if (state.phase !== 'courtesy-select') throw new Error('Courtesy tiles are not being selected');
  const n = state.courtesy.agreed ?? 0;
  validatePass(state.racks.you, ownTiles, n);
  const rng = createRng(mixSeed(state.config.seed, 700));
  const profile = state.config.opponents;
  const sideN = courtesyAgreement(
    courtesyRequest(card, opponentView(state, 'right'), profile, rng),
    courtesyRequest(card, opponentView(state, 'left'), profile, rng),
  );
  const chosen: Record<Seat, TileId[]> = {
    you: ownTiles,
    across: choosePass(card, opponentView(state, 'across'), n, profile, rng),
    right: choosePass(card, opponentView(state, 'right'), sideN, profile, rng),
    left: choosePass(card, opponentView(state, 'left'), sideN, profile, rng),
  };
  const knowBefore = playerKnowledge(state);
  const grade = gradePass(card, knowBefore, ownTiles.map((id) => KIND_OF_ID[id]));
  const res = executeCourtesy(state.racks, chosen);
  const passHistory = { ...state.passHistory };
  for (const seat of SEAT_ORDER) passHistory[seat] = [...passHistory[seat], ...chosen[seat]];
  const next: RoundState = {
    ...state,
    racks: res.racks,
    passHistory,
    phase: 'rank',
    courtesy: { ...state.courtesy, status: 'done' },
    lastReceived: res.received.you,
  };
  next.passes = [
    ...state.passes,
    {
      step: COURTESY_STEP,
      rackBefore: [...state.racks.you],
      passed: [...ownTiles],
      blind: 0,
      forwarded: [],
      received: res.received.you,
      rackAfter: [...res.racks.you],
      grade,
      outcome: { before: bestScore(card, knowBefore), after: bestScore(card, playerKnowledge(next)) },
    },
  ];
  assertConservation(next);
  return next;
}

/** Throws if any tile was created, duplicated or lost, or a rack has an illegal size. */
export function assertConservation(state: RoundState): void {
  const all = [...state.wall, ...SEAT_ORDER.flatMap((s) => state.racks[s])];
  if (all.length !== TOTAL_TILES) throw new Error(`Tile count ${all.length} ≠ ${TOTAL_TILES}`);
  if (new Set(all).size !== TOTAL_TILES) throw new Error('Duplicate tile detected');
  for (const seat of SEAT_ORDER) {
    const expected = seat === state.dealer ? RULES.dealerTiles : RULES.playerTiles;
    if (state.racks[seat].length !== expected) {
      throw new Error(`${seat} holds ${state.racks[seat].length} tiles, expected ${expected}`);
    }
  }
}

export { PassError };
