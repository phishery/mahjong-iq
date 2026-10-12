# Probability, scoring and their validation

Mahjong IQ never fabricates numbers. Every figure shown comes from one of two engines, and each is labelled in the UI.

## 1. Heuristic opportunity score (`src/engine/heuristic.ts`)

A fast, deterministic **relative** score (0–100) for one concrete hand variant given what the player knows: their rack, plus the tiles they passed away, which sit in opponents' racks.

For each tile kind the variant still needs:

- **Exact needs (singles and pairs):** outs are the live copies only. That is 4 minus the copies held, or 8 for Flowers. Tiles the player passed away count only 25% as live. Exact needs get a weight of 1.2.
- **Flexible needs (groups of 3+):** outs are the live copies plus a share of the live Jokers (Joker weight 0.3). For exposed hands, these groups also get one extra "look" per turn, for calling discards.
- p_k = P(Binomial(looks, outs/unseen) ≥ missing_k), with a 20-turn horizon.
- score = 100 · (Π p_k^w)^(1/4). If an exact need can't be met from live tiles, the hand is dead (score 0).

Its weights were tuned by `scripts/calibrate-heuristic.ts`. That script simulates line-level completion for random racks and grid-searches the weights. On 80 fresh racks (seed 13000, 800 trials each):

| Metric | Result |
|---|---|
| Mean Spearman rank correlation (heuristic best-in-line vs. simulated line completion) | **0.85** |
| Simulated probability of the heuristic's top line, relative to the best simulated line | **0.85** |
| Older "sum of expected waits" form (kept as `form: 'waits'`) | 0.68 Spearman, 0.47 ratio |

The calibration figures are limited by simulation noise: individual line probabilities are often only 1–5%.

## 2. Monte Carlo completion probability (`src/engine/simulate.ts`)

**Model (default "draws + calls"):**
1. Unknown tiles = the full set − the player's rack − tiles the player passed away (those are known to be in opponents' racks).
2. The wall is a uniformly shuffled sequence of unknown tiles, sampled without replacement (partial Fisher–Yates).
3. Each turn the player draws a tile. Then three opponents each draw, and discard that tile. Jokers are never discarded.
4. The player may call a discard for Mahjong (any tile), or to expose a pung, kong or quint of an exposed target when holding count−1 of that group. Exposed tiles are locked, and later targets must contain every exposed group.
5. After each acquisition the player discards a tile the current target doesn't need, preferring tiles the runner-up target doesn't need either.
6. Success means the hand is complete within T turns (default 20).

**Not modelled:** opponents winning first, defensive discarding, joker exchanges, opponents calling tiles, and the remaining Charleston passes. The engine treats the current rack as if play started now. It therefore estimates **hand completion under a simplified model**, never the probability of winning a game.

**Adaptive category and line targets:** the simulated player retargets after every acquisition to the closest variant still eligible. Success means any variant completes. That is a genuine union probability under a documented strategy, not a sum of overlapping chances.

**Reproducibility and noise control:** results are seeded. Trial *t* uses the same wall for every target (common random numbers), so a target's result never depends on what else was simulated. Each result carries a Wilson 95% interval.

**Validation (`tests/engine/simulate-scoring.test.ts`):**
- One missing exact pair tile under the draw-only model matches the hypergeometric 1 − C(136,18)/C(139,18) to within 4 standard errors (20,000 trials).
- With calls, Mahjong on any discard gives 4 looks per turn, and the result matches the hypergeometric value with 40 looks.
- A missing kong tile with 1 live copy plus 8 Jokers matches the hypergeometric value with 9 outs.
- Tiles known to be elsewhere are never drawn.

**Performance:** the simulator runs in a Web Worker. It starts as soon as a rack is shown and is cached per rack, target and settings. Results for a superseded rack are discarded. At 1,000 trials it takes about 0.3 s for all 9 categories and about 0.6 s for all 47 lines.

## 3. Comparison with published research

Before the engine was built, methodology was checked against:
- **EightBam** ([best-sections](https://eightbam.com/best-sections/), [probability](https://eightbam.com/probability/)): 10 million simulated full NMJL games on the official 2026 card, with calls. The best single hand completes 13.2% of the time, typical hands 1–4%, and Quints about 0%. Section "shows up" rates run from 46.9% for Runs down to 0.04% for Quints. Hands get harder with concealment, singles and pairs, kongs (compared with pungs), quints and one-suit structures.
- **Missy Mahjong** ([2026 card statistics](https://www.missymahjong.com/post/nmjl-2026-card-statistics)): 1,077 concrete variants on the 2026 card, mostly Runs (315) and Quints (264). A section can have many variants yet still be hard to complete, as Quints shows.
- **riichi_advanced** ([GitHub](https://github.com/EpicOrange/riichi_advanced), AGPL-3.0): a general mahjong engine that solves joker assignment with Z3. No code was used. NMJL groups have a fixed structure, so a greedy "naturals first, then Jokers in groups of 3+" assignment is optimal here.

As a result, the simulator models calls. The UI distinguishes a "best hand in category" approximation from a true category union, and shows variant counts per category. The demo card shows the same qualitative pattern as EightBam: Quints and Singles & Pairs are rarely completed, and concealed hands come lowest. Absolute rates are not comparable, because the cards differ and the horizon differs: this engine starts from the current rack, while EightBam simulates full games.

## 4. Scoring (`src/engine/scoring.ts`, `src/engine/passes.ts`)

- **Strategic recognition (70 points):** each pick earns min(1, value / best value for that slot)^γ, with γ = 1.5 for simulated probabilities and 3 for heuristic scores. The slots are weighted 45/27/18, plus 10% for consistent ordering. For example, picking a hand at 18% when the best is 19% earns about 92% credit; picking one at 4% earns about 10%.
- **Charleston decisions (30 points):** each pass is judged only on what was known when passing, by the potential of the kept tiles (a weighted blend of the best five lines). Credit is half the pass's percentile among all legal passes and half its normalised closeness to the best pass. The actual outcome (the change in best opportunity after receiving tiles) is shown separately and never scored.
- Opening-rack drills have no passes, so recognition counts for the full 100.
- Scores are stored and compared per mode and per round length only.
