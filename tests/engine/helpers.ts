import { buildCandidates, type Selection } from '../../src/engine/analysis';
import { getDemoCard } from '../../src/engine/cards';
import {
  currentLevel,
  playerKnowledge,
  requestCourtesy,
  startRound,
  submitCourtesy,
  submitPass,
  submitRanking,
  voteSecondCharleston,
  type RoundConfig,
  type RoundState,
} from '../../src/engine/game';
import { gradeRanking } from '../../src/engine/scoring';
import { JOKER_INDEX, KIND_OF_ID, parseKinds, countsFromKinds, type TileKind } from '../../src/engine/tiles';

export const card = getDemoCard();

export function rackOf(text: string): number[] {
  return countsFromKinds(parseKinds(text));
}

export function variantByLabel(lineId: string, cfg: Record<string, string | number>) {
  const line = card.lineById.get(lineId)!;
  const v = line.variants.find((v) =>
    Object.entries(cfg).every(([k, val]) =>
      typeof val === 'number' ? v.nums[k] === val : v.suits[k as 'A'] === val,
    ),
  );
  if (!v) throw new Error(`No variant ${lineId} ${JSON.stringify(cfg)}`);
  return v;
}

/** Rank the engine's top three (or a deliberately poor choice) for the current decision. */
export function autoRank(state: RoundState, poor = false): RoundState {
  const an = buildCandidates(card, playerKnowledge(state), currentLevel(state));
  const list = poor ? [...an.candidates].reverse() : an.candidates;
  const picks: Selection[] = list.slice(0, 3).map((c) => ({ level: c.level, id: c.id }));
  return submitRanking(state, picks, an, gradeRanking(an, picks, 'heuristic'));
}

export function firstPassable(state: RoundState, n: number) {
  return state.racks.you.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX).slice(0, n);
}

/** Play an entire round automatically, returning every intermediate state. */
export function playRound(config: Partial<RoundConfig> = {}, opts: { blind?: number; continueSecond?: boolean; courtesy?: number } = {}) {
  const cfg: RoundConfig = { mode: 'hybrid', length: 'full', seed: 42, opponents: 'competent', courtesy: true, ...config };
  let s = startRound(card, cfg);
  const states = [s];
  let guard = 0;
  while (s.phase !== 'done' && guard++ < 50) {
    if (s.phase === 'rank') s = autoRank(s);
    else if (s.phase === 'pass') {
      const step = s.schedule[s.stepIndex];
      const blind = step.blindAllowed ? (opts.blind ?? 0) : 0;
      s = submitPass(card, s, firstPassable(s, 3 - blind), blind);
    } else if (s.phase === 'vote') s = voteSecondCharleston(card, s, opts.continueSecond ?? true);
    else if (s.phase === 'courtesy-request') s = requestCourtesy(card, s, opts.courtesy ?? 3);
    else if (s.phase === 'courtesy-select') s = submitCourtesy(card, s, firstPassable(s, s.courtesy.agreed!));
    states.push(s);
  }
  return { final: s, states };
}

export const k = (t: string) => t as TileKind;
