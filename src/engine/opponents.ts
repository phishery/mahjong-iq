/**
 * Simulated opponents. Each opponent decides using ONLY its own view (its rack and the
 * tiles it has passed) — never the player's rack or other opponents' racks.
 *
 * Profiles:
 *  - competent: passes the tiles that preserve the most rack potential (with a small chance
 *    of a slightly sub-optimal choice), stops the second Charleston when its rack is strong.
 *  - casual: focuses on one or two favourite hands, frequently makes a human-like slip
 *    (keeps a tile it doesn't need, passes a useful one), votes somewhat randomly.
 *  - random (experimental): uniformly random legal passes, for comparison only.
 */

import type { LoadedCard } from './card/schema';
import { analyzeRack, type PlayerKnowledge } from './heuristic';
import { evaluatePasses } from './passes';
import type { Rng } from './rng';
import { sample } from './rng';
import { countsFromIds, JOKER_INDEX, KIND_OF_ID, NUM_KINDS, type TileId } from './tiles';

export type OpponentProfile = 'casual' | 'competent' | 'random';

export const OPPONENT_PROFILES: Record<OpponentProfile, { name: string; description: string }> = {
  competent: {
    name: 'Strategic',
    description: 'Keeps tiles for its most promising hands and rarely slips.',
  },
  casual: {
    name: 'Casual',
    description: 'Chases a favourite hand, makes human-like mistakes.',
  },
  random: {
    name: 'Random (experimental)',
    description: 'Passes uniformly random legal tiles — a baseline for comparison.',
  },
};

export interface OpponentView {
  rack: readonly TileId[];
  passedAway: readonly TileId[];
}

function knowledgeOf(view: OpponentView): PlayerKnowledge {
  return { rack: countsFromIds(view.rack), knownElsewhere: countsFromIds(view.passedAway) };
}

/** Map chosen kinds back to concrete tile ids in the rack. */
function idsForKindsInRack(rack: readonly TileId[], kinds: number[]): TileId[] {
  const pool = [...rack];
  return kinds.map((k) => {
    const i = pool.findIndex((id) => KIND_OF_ID[id] === k);
    if (i < 0) throw new Error('Kind not in rack');
    return pool.splice(i, 1)[0];
  });
}

function passable(rack: readonly TileId[]): TileId[] {
  return rack.filter((id) => KIND_OF_ID[id] !== JOKER_INDEX);
}

export function choosePass(
  card: LoadedCard,
  view: OpponentView,
  count: number,
  profile: OpponentProfile,
  rng: Rng,
): TileId[] {
  if (count === 0) return [];
  const legal = passable(view.rack);
  if (legal.length < count) throw new Error('Opponent cannot make a legal pass');
  if (profile === 'random') return sample(legal, count, rng);

  const know = knowledgeOf(view);
  if (profile === 'competent') {
    const ev = evaluatePasses(card, know, count);
    // 85%: best pass; otherwise one of the next few good options.
    const pick = rng.next() < 0.85 ? 0 : Math.min(ev.options.length - 1, 1 + rng.int(3));
    return idsForKindsInRack(view.rack, ev.options[pick].kinds);
  }

  // Casual: tunnel vision on its top two variants; passes what those don't need.
  const a = analyzeRack(card, know);
  const favourites = a.ranked.slice(0, 2).map((o) => o.variant);
  const needed = new Array(NUM_KINDS).fill(0);
  for (const v of favourites) for (const k of v.kinds) needed[k] = Math.max(needed[k], v.needNJ[k] + v.needJ[k]);
  const spare: TileId[] = [];
  const keepish: TileId[] = [];
  const seen = new Array(NUM_KINDS).fill(0);
  for (const id of legal) {
    const k = KIND_OF_ID[id];
    seen[k]++;
    if (seen[k] > needed[k]) spare.push(id);
    else keepish.push(id);
  }
  let chosen = sample(spare, Math.min(count, spare.length), rng);
  if (chosen.length < count) chosen = chosen.concat(sample(keepish, count - chosen.length, rng));
  // Human-like slip: 35% of the time swap one passed tile for a random kept tile.
  if (rng.next() < 0.35) {
    const others = legal.filter((id) => !chosen.includes(id));
    if (others.length) chosen[rng.int(chosen.length)] = others[rng.int(others.length)];
  }
  return chosen;
}

/** Does this opponent want to continue to the second Charleston? */
export function wantsSecondCharleston(card: LoadedCard, view: OpponentView, profile: OpponentProfile, rng: Rng): boolean {
  if (profile === 'random') return rng.next() < 0.75;
  const best = analyzeRack(card, knowledgeOf(view)).ranked[0]?.score ?? 0;
  if (profile === 'competent') return best < 42 || rng.next() < 0.2;
  return rng.next() < 0.8;
}

/** How many tiles this opponent asks for in the courtesy pass. */
export function courtesyRequest(card: LoadedCard, view: OpponentView, profile: OpponentProfile, rng: Rng): number {
  if (profile === 'random') return rng.int(4);
  if (profile === 'casual') return 1 + rng.int(3);
  const know = knowledgeOf(view);
  const top = analyzeRack(card, know).ranked[0];
  if (!top) return 3;
  // Ask for as many tiles as the top hand cannot use (capped at 3).
  const v = top.variant;
  let spare = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (k === JOKER_INDEX) continue;
    spare += Math.max(0, know.rack[k] - (v.needNJ[k] + v.needJ[k]));
  }
  return Math.min(3, spare);
}
