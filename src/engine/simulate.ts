/**
 * Monte Carlo completion-probability engine.
 *
 * Two documented models are available (both surfaced in the UI next to every number):
 *
 * "calls" (default) — draws + calls
 *  - Start from the player's current rack, as if regular play began now.
 *  - Unknown tiles = full set − player's rack − tiles the player passed away (known to be
 *    in opponents' racks, so never drawn from the wall in this model).
 *  - The wall is a uniformly shuffled sequence of unknown tiles (finite-population sampling
 *    WITHOUT replacement). Each turn the player draws one tile, then each of the three
 *    opponents draws and discards one tile. Opponents' discards are modelled as their drawn
 *    tile (a random unknown tile); Jokers are never discarded.
 *  - The player may call a discard for Mahjong (any group, including pairs/singles), or to
 *    expose a pung/kong/quint of a non-concealed target when already holding count−1 of
 *    that group (naturals or Jokers), following NMJL calling rules. Exposed tiles are locked
 *    and the hand may only adapt to variants containing every exposed group.
 *  - Concealed hands can never expose; they can still win on a discard.
 *  - After each acquisition the player discards a tile the current best target does not need.
 *  - Ignored: opponents' wins, defensive play, joker exchanges, opponents calling tiles.
 *
 * "draws" — draw-only: the same, but no discards are ever called.
 *
 * Success = the targeted hand is complete (14 tiles) within T player turns. This estimates a
 * hand COMPLETION probability under a simplified model. It is NOT a probability of winning a
 * Mahjong game (that would require modelling opponents finishing first).
 *
 * Adaptive targets: a target may contain many variants (a whole line or category). The
 * simulated player re-targets after every acquisition toward whichever eligible variant is
 * closest and succeeds if ANY variant completes — a genuine union probability under a
 * documented adaptive strategy, not a sum of overlapping individual chances.
 *
 * Common random numbers: trial t uses the same wall for every target, so comparisons between
 * candidate hands are much less noisy than independent runs.
 *
 * Methodology was informed by the published EightBam 2026 card simulations
 * (eightbam.com/probability), which model full NMJL games with calls; see docs/PROBABILITY.md.
 */

import type { HandVariant, LoadedCard } from './card/schema';
import { HAND_SIZE } from './card/parser';
import { createRng, mixSeed } from './rng';
import { JOKER_INDEX, KINDS, NUM_KINDS, SUPPLY } from './tiles';

export type SimModel = 'calls' | 'draws';

export interface SimTarget {
  key: string;
  variantIndices: number[];
}

export interface SimSettings {
  /** Player turns modelled (each turn: one draw plus three opponent discards). */
  draws: number;
  trials: number;
  seed: number;
  model: SimModel;
}

export const DEFAULT_SIM: SimSettings = { draws: 20, trials: 1000, seed: 20260, model: 'calls' };

export interface SimInput extends SimSettings {
  rack: number[];
  knownElsewhere: number[];
  targets: SimTarget[];
}

export interface SimResult {
  key: string;
  successes: number;
  trials: number;
  p: number;
  /** Wilson 95% interval. */
  lo: number;
  hi: number;
  /** Mean player turn at which completion happened (successful trials only). */
  meanTurnsToComplete: number | null;
}

export function wilson(successes: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Distance (tiles still needed) for a 13/14-tile hand. */
function distance(hand: Int16Array, v: HandVariant): number {
  let naturals = 0;
  let flexMissing = 0;
  const kinds = v.kinds;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    const h = hand[k];
    const nj = v.needNJ[k];
    const j = v.needJ[k];
    const a = h < nj ? h : nj;
    const rem = h - a;
    const b = rem < j ? rem : j;
    naturals += a + b;
    flexMissing += j - b;
  }
  const jk = hand[JOKER_INDEX];
  return HAND_SIZE - naturals - (jk < flexMissing ? jk : flexMissing);
}

/** Distance plus missing exact tiles, packed into one sortable number (lower is closer). */
function closeness(hand: Int16Array, v: HandVariant): number {
  let naturals = 0;
  let flexMissing = 0;
  let exactMissing = 0;
  const kinds = v.kinds;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    const h = hand[k];
    const nj = v.needNJ[k];
    const j = v.needJ[k];
    const a = h < nj ? h : nj;
    const rem = h - a;
    const b = rem < j ? rem : j;
    naturals += a + b;
    flexMissing += j - b;
    exactMissing += nj - a;
  }
  const jk = hand[JOKER_INDEX];
  const dist = HAND_SIZE - naturals - (jk < flexMissing ? jk : flexMissing);
  return dist * 32 + exactMissing;
}

/** How many tiles of kind k variant v can use given the hand (for jokers: open flexible slots). */
function usefulOf(hand: Int16Array, v: HandVariant, k: number): number {
  if (k !== JOKER_INDEX) return v.needNJ[k] + v.needJ[k];
  let flexMissing = 0;
  const kinds = v.kinds;
  for (let i = 0; i < kinds.length; i++) {
    const kk = kinds[i];
    const h = hand[kk];
    const nj = v.needNJ[kk];
    const a = h < nj ? h : nj;
    const rem = h - a;
    const j = v.needJ[kk];
    flexMissing += j - (rem < j ? rem : j);
  }
  return flexMissing;
}

/**
 * Choose a tile kind to discard from a 14-tile hand: a tile the primary target cannot use;
 * among those prefer one the backup target cannot use either. Jokers go last. Exposed
 * (locked) tiles are never discarded.
 */
function chooseDiscard(hand: Int16Array, locked: Int16Array, primary: HandVariant, backup: HandVariant | null): number {
  let fallback = -1;
  for (let k = 0; k < NUM_KINDS; k++) {
    const h = hand[k];
    if (h - locked[k] <= 0) continue;
    if (h <= usefulOf(hand, primary, k)) continue;
    if (k === JOKER_INDEX) {
      if (fallback < 0) fallback = k;
      continue;
    }
    if (backup && h <= usefulOf(hand, backup, k)) {
      if (fallback < 0 || fallback === JOKER_INDEX) fallback = k;
      continue;
    }
    return k;
  }
  if (fallback >= 0) return fallback;
  for (let k = 0; k < NUM_KINDS; k++) if (hand[k] - locked[k] > 0 && k !== JOKER_INDEX) return k;
  return JOKER_INDEX;
}

export function buildUnknownPool(rack: number[], knownElsewhere: number[]): number[] {
  const pool: number[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    const n = SUPPLY[k] - rack[k] - knownElsewhere[k];
    if (n < 0) throw new Error('Inconsistent knowledge: more tiles than the set contains');
    for (let c = 0; c < n; c++) pool.push(k);
  }
  return pool;
}

/** Fill `out` with the first out.length tiles of a uniformly shuffled pool (partial Fisher–Yates). */
function shuffledPrefix(pool: number[], seed: number, out: Int16Array): number {
  const rng = createRng(seed);
  const n = pool.length;
  const m = Math.min(out.length, n);
  for (let i = 0; i < m; i++) {
    const j = i + rng.int(n - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    out[i] = pool[i];
  }
  return m;
}

/** Does variant v contain a joker-eligible group of exactly (kind, count)? */
function hasGroup(v: HandVariant, kind: number, count: number, kindsByIndex: readonly string[]): boolean {
  const name = kindsByIndex[kind];
  return v.groups.some((g) => g.jokerable && g.count === count && g.kind === name);
}

export function simulate(card: LoadedCard, input: SimInput): SimResult[] {
  const kindNames: readonly string[] = KINDS;
  const pool = buildUnknownPool(input.rack, input.knownElsewhere);
  const basePool = pool.slice();
  const T = input.draws;
  const allowCalls = input.model === 'calls';
  const streamLen = Math.min(pool.length, T * (allowCalls ? 4 : 1));
  const stream = new Int16Array(streamLen);
  const concealedOf = card.variants.map((v) => card.lineById.get(v.lineId)!.concealed);
  const targets = input.targets.map((t) => ({ key: t.key, vs: t.variantIndices.map((i) => card.variants[i]) }));
  const successes = new Array(targets.length).fill(0);
  const turnSums = new Array(targets.length).fill(0);
  const hand = new Int16Array(NUM_KINDS);
  const locked = new Int16Array(NUM_KINDS);

  for (let t = 0; t < input.trials; t++) {
    for (let i = 0; i < basePool.length; i++) pool[i] = basePool[i];
    const len = shuffledPrefix(pool, mixSeed(input.seed, t), stream);

    for (let ti = 0; ti < targets.length; ti++) {
      let eligible = targets[ti].vs;
      if (eligible.length === 0) continue;
      for (let k = 0; k < NUM_KINDS; k++) {
        hand[k] = input.rack[k];
        locked[k] = 0;
      }
      let pos = 0;
      let done = false;

      // Select the closest and runner-up eligible variants for the current hand.
      let bestV: HandVariant = eligible[0];
      let secondV: HandVariant | null = null;
      let bestC = 0;
      const rank = () => {
        bestV = eligible[0];
        bestC = closeness(hand, bestV);
        secondV = null;
        let secondC = Infinity;
        for (let i = 1; i < eligible.length; i++) {
          const c = closeness(hand, eligible[i]);
          if (c < bestC) {
            secondV = bestV;
            secondC = bestC;
            bestV = eligible[i];
            bestC = c;
          } else if (c < secondC) {
            secondV = eligible[i];
            secondC = c;
          }
        }
      };

      for (let turn = 0; turn < T && !done && pos < len; turn++) {
        // --- Player draws ---
        hand[stream[pos++]]++;
        rank();
        if (bestC < 32) {
          successes[ti]++;
          turnSums[ti] += turn + 1;
          done = true;
          break;
        }
        hand[chooseDiscard(hand, locked, bestV, secondV)]--;
        if (!allowCalls) continue;

        // Variants one tile from Mahjong (only computed when the best target is that close;
        // discarding a tile the best target cannot use never changes its distance).
        let near: HandVariant[] | null = null;
        if (bestC >> 5 <= 1) near = eligible.filter((v) => distance(hand, v) === 1);
        const primary: HandVariant = bestV;
        const primaryExposable = !concealedOf[primary.index];

        // --- Three opponents draw and discard ---
        for (let o = 0; o < 3 && pos < len; o++) {
          const tile = stream[pos++];
          if (tile === JOKER_INDEX) continue; // jokers are kept, never discarded
          // Mahjong on the discard?
          if (near && near.length) {
            hand[tile]++;
            let wins = false;
            for (let i = 0; i < near.length; i++) {
              if (distance(hand, near[i]) === 0) {
                wins = true;
                break;
              }
            }
            hand[tile]--;
            if (wins) {
              successes[ti]++;
              turnSums[ti] += turn + 1;
              done = true;
              break;
            }
          }
          // Exposure call for the current primary target?
          if (!primaryExposable || primary.needJ[tile] === 0) continue;
          hand[tile]++;
          let called = false;
          {
            for (const g of primary.groups) {
              if (!g.jokerable || g.kind !== kindNames[tile]) continue;
              const k = tile;
              const freeNat = hand[k] - locked[k];
              const freeJok = hand[JOKER_INDEX] - locked[JOKER_INDEX];
              const usableNat = Math.min(freeNat, g.count);
              // Hand must hold count−1 tiles besides the called one, and the tile must be
              // genuinely needed (not a spare copy).
              if (usableNat + freeJok >= g.count && hand[k] <= usefulOf(hand, primary, k)) {
                const jk = g.count - usableNat;
                locked[k] += usableNat;
                locked[JOKER_INDEX] += jk;
                const ek = k;
                const ec = g.count;
                eligible = eligible.filter((v) => !concealedOf[v.index] && hasGroup(v, ek, ec, kindNames));
                called = true;
              }
              break;
            }
          }
          if (!called) {
            hand[tile]--;
            continue;
          }
          rank();
          hand[chooseDiscard(hand, locked, bestV, secondV)]--;
          break; // turn order jumps to the player; remaining opponents are skipped this round
        }
      }
    }
  }

  return targets.map((t, i) => {
    const { lo, hi } = wilson(successes[i], input.trials);
    return {
      key: t.key,
      successes: successes[i],
      trials: input.trials,
      p: successes[i] / input.trials,
      lo,
      hi,
      meanTurnsToComplete: successes[i] ? turnSums[i] / successes[i] : null,
    };
  });
}

/** Human-readable description of the model, shown next to every simulated probability. */
export function describeSimModel(s: SimSettings): string {
  const model =
    s.model === 'calls'
      ? 'draws plus calls on random opponent discards for exposures and Mahjong'
      : 'draws only, no calls';
  return (
    `Chance to complete the hand within ${s.draws} turns from the current rack (${model}; ` +
    `opponents' own progress, defence and joker swaps are ignored). ` +
    `${s.trials.toLocaleString()} simulated walls, seed ${s.seed}. Not a probability of winning the game.`
  );
}
