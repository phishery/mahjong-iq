/**
 * Small, fast, seedable PRNG (sfc32) plus helpers. All randomness in the engine flows
 * through an Rng instance so deals, opponent behaviour and simulations are reproducible.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** The seed this generator was created from (for display / challenge codes). */
  readonly seed: number;
}

export function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix several integers into one 32-bit seed (splitmix-style). */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = 0x9e3779b9 ^ seed;
  let b = 0x243f6a88 ^ Math.imul(seed, 0x85ebca6b);
  let c = 0xb7e15162 ^ Math.imul(seed, 0xc2b2ae35);
  let d = seed >>> 0;
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up to decorrelate similar seeds.
  for (let i = 0; i < 12; i++) next();
  return {
    seed,
    next,
    int: (n: number) => Math.floor(next() * n),
  };
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Choose k distinct elements uniformly (sampling without replacement). */
export function sample<T>(arr: readonly T[], k: number, rng: Rng): T[] {
  const copy = arr.slice();
  const n = copy.length;
  const m = Math.min(k, n);
  for (let i = 0; i < m; i++) {
    const j = i + rng.int(n - i);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, m);
}

export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}
