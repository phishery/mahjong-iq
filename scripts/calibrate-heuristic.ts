/**
 * Calibrates the heuristic opportunity score against the Monte Carlo engine.
 *
 *   npx tsx scripts/calibrate-heuristic.ts [racks=60] [trials=600]
 *
 * For random 13-tile racks it computes line-level completion probabilities with the
 * simulator (draws + calls model, adaptive within each line), then grid-searches the
 * heuristic weights to maximise the mean Spearman rank correlation between "best heuristic
 * score in the line" and "simulated line completion probability". It also reports how much
 * simulated probability is lost by trusting the heuristic's top line (top-pick ratio).
 */

import cardJson from '../src/engine/cards/demo-card.json';
import { loadCard } from '../src/engine/card/parser';
import {
  DEFAULT_HEURISTIC,
  evaluateOpportunity,
  knowledgeFromRack,
  unseenCount,
  type HeuristicParams,
} from '../src/engine/heuristic';
import { createRng, shuffle } from '../src/engine/rng';
import { DEFAULT_SIM, simulate } from '../src/engine/simulate';
import { allTileIds, countsFromIds, emptyCounts } from '../src/engine/tiles';

const card = loadCard(cardJson);
const N = Number(process.argv[2] ?? 60);
const TRIALS = Number(process.argv[3] ?? 600);

function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

const lineTargets = card.lines.map((l) => ({ key: l.id, variantIndices: l.variants.map((v) => v.index) }));
const racks: number[][] = [];
const mc: number[][] = [];
const t0 = performance.now();
for (let s = 0; s < N; s++) {
  const rack = countsFromIds(shuffle(allTileIds(), createRng(Number(process.env.RACK_SEED ?? 5000) + s)).slice(0, 13));
  racks.push(rack);
  const res = simulate(card, {
    ...DEFAULT_SIM,
    trials: TRIALS,
    seed: s,
    rack,
    knownElsewhere: emptyCounts(),
    targets: lineTargets,
  });
  mc.push(res.map((r) => r.p));
}
console.log(`simulated ${N} racks × ${lineTargets.length} lines in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

function evaluate(P: HeuristicParams) {
  let rho = 0;
  let ratio = 0;
  for (let r = 0; r < racks.length; r++) {
    const know = knowledgeFromRack(racks[r]);
    const U = unseenCount(know);
    const h = card.lines.map((l) =>
      Math.max(...l.variants.map((v) => evaluateOpportunity(know, v, l.concealed, U, P).score)),
    );
    rho += spearman(h, mc[r]);
    const top = h.indexOf(Math.max(...h));
    const best = Math.max(...mc[r]);
    ratio += best > 0 ? mc[r][top] / best : 1;
  }
  return { rho: rho / racks.length, ratio: ratio / racks.length };
}

const base = evaluate(DEFAULT_HEURISTIC);
console.log(`current defaults: spearman=${base.rho.toFixed(3)} top-pick ratio=${base.ratio.toFixed(3)}`);

let best = { P: DEFAULT_HEURISTIC, ...base };
const consider = (P: HeuristicParams) => {
  const r = evaluate(P);
  if (r.rho + 0.5 * r.ratio > best.rho + 0.5 * best.ratio) best = { P, ...r };
};
for (const exactMult of [0.75, 1, 1.5, 2])
  for (const callBoost of [1, 1.5, 2.5])
    for (const jokerWeight of [0.5, 1])
      for (const flexMult of [0.5, 1]) consider({ ...DEFAULT_HEURISTIC, form: 'waits', exactMult, callBoost, jokerWeight, flexMult });
const bestWaits = best;
console.log(`best 'waits': spearman=${bestWaits.rho.toFixed(3)} ratio=${bestWaits.ratio.toFixed(3)}`);
// Only the ratio exactMult/flexMult affects rankings, so flexMult stays at 1.
for (const exactMult of [0.6, 0.8, 1, 1.2, 1.5])
  for (const callLooks of [0.5, 0.75, 1, 1.5])
    for (const jokerWeight of [0.25, 0.5, 0.75, 1])
      consider({ ...DEFAULT_HEURISTIC, form: 'analytic', exactMult, callLooks, jokerWeight, flexMult: 1, callBoost: 1 });
console.log('best params:', JSON.stringify(best.P));
console.log(`best: spearman=${best.rho.toFixed(3)} top-pick ratio=${best.ratio.toFixed(3)}`);
