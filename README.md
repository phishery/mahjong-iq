# Mahjong IQ

A rapid strategy trainer for **American Mahjong (NMJL-style)**. Each round shows a 13-tile rack, asks you to rank your three most promising card options, runs a legal Charleston against simulated opponents, and makes you re-rank after **every** exchange. A round ends when the Charleston ends. You never play a full game, so you can get through dozens of racks in one sitting.

> The bundled card is a **fictional demo card** written for training. It is not the official National Mah Jongg League card, which is copyrighted and not bundled. You can load a card you own as JSON (see [docs/CARD_FORMAT.md](docs/CARD_FORMAT.md)).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Requires Node 20+ (developed on Node 22). No API keys or backend are needed. Everything runs in the browser, and Monte Carlo simulation runs in a Web Worker.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` / `npm run preview` | Type-check, build to `dist/`, and serve the build |
| `npm test` | Vitest unit and integration tests for the engine (69 tests) |
| `npx playwright install chromium` then `npm run test:e2e` | Playwright browser tests: a full Beginner round, a full Hybrid round, the opening-rack sprint, and the card reference |
| `npm run validate-card -- path/to/card.json` | Validate a card definition and print variant counts |
| `npm run calibrate` | Re-calibrate the heuristic score against the Monte Carlo engine |

## How to play

1. Choose a mode:
   - **Beginner**: rank card *categories*.
   - **Hybrid** (recommended): categories for the opening rack and after the first pass, card *lines* after the second pass, then *exact hands* (line plus suits plus numbers).
   - **Advanced**: exact hands from the deal onward. A builder lets you pick the starting number and the suit for each colour, and can list every legal variation of a line.
2. Rank your top three and lock it in. You are graded immediately: your choices against the engine's top three, the reasons, backup diversity, and a before/after chart of how the exchange changed your prospects.
3. Select the tiles to pass (blind passes are allowed on the first Left and the last Right). The animation shows what you passed and received, plus the engine's recommended pass.
4. Re-rank. Keeping your previous ranking, rearranging it, and pivoting are all allowed.
5. At the end you get a 100-point report (70 for strategic recognition, 30 for Charleston decisions), lessons, a decision timeline, a step-by-step replay, and a **same-rack challenge code** a friend can use to play the identical deal.

Round lengths: **Quick round** (first Charleston, under 90 seconds), **Full Charleston** (optional second Charleston plus courtesy pass), **Two-pass challenge**, and **Opening rack**. Drills: opening-rack sprint, category speed drill (timed), exact-hand drill, and **targeted practice**. Targeted racks are deliberately selected, are labelled as such, and are weighted toward your weakest categories by spaced repetition.

## Architecture

```
src/engine/            pure TypeScript, no React — fully unit-tested
  tiles.ts             152-tile set, kinds, physical tile ids, count vectors
  rng.ts               seeded PRNG (sfc32), shuffles, sampling without replacement
  card/schema.ts       declarative card schema + pattern DSL docs
  card/parser.ts       DSL parser, variant expansion (suits/numbers), validation (zod + semantic)
  cards/demo-card.json fictional training card (47 lines, 468 concrete variants)
  evaluator.ts         exact hand matching with NMJL joker rules
  heuristic.ts         heuristic opportunity score (0–100) + rack potential
  simulate.ts          Monte Carlo completion-probability engine
  passes.ts            pass evaluation / best-pass search (decision quality)
  charleston.ts        centralised Charleston rules (directions, blind, courtesy, jokers)
  opponents.ts         casual / strategic / random opponent profiles (hidden-info safe)
  analysis.ts          candidates at category / line / variant level, grading basis
  scoring.ts           regret-based 70/30 scoring, flexibility/overlap
  game.ts              round state machine with tile-conservation checks
  feedback.ts          deterministic teaching text (no invented numbers)
  report.ts            end-of-round report and lessons
  progress.ts          local progress, Leitner spaced repetition, session summary
src/worker/sim.worker.ts   Web Worker wrapper for simulations
src/ui/                React + Tailwind v4 UI (SVG tile faces, no image assets)
tests/engine/          Vitest suites      e2e/   Playwright suites
scripts/               card validator, heuristic calibration
```

Stack: React 19, TypeScript, Vite, Tailwind CSS v4, Vitest, and Playwright. Progress, settings and imported cards live in `localStorage`. Every storage access is wrapped so the app still works in private windows.

## Numbers you'll see (and what they mean)

- **Heuristic opportunity score (0–100).** A deterministic relative score. **It is not a probability.** It is the product of per-tile binomial chances of collecting each missing tile (exact pair/single tiles cannot use Jokers; groups of 3+ can, and exposed hands can call), passed through a 4th root to spread the values. Its weights were calibrated against the simulator: mean Spearman rank correlation 0.85 on 80 fresh random racks.
- **Simulated completion probability.** A Monte Carlo estimate of completing the hand within 20 turns from the current rack, under a documented draw-plus-calls model. Each estimate uses 1,000 or 4,000 simulated walls, a fixed seed, and a 95% Wilson interval. It is **not a probability of winning the game**: opponents finishing first is not modelled. For a category or line, the probability is a true union under an adaptive strategy, not a sum.
- Grading uses simulated probabilities only when every candidate was simulated and the leader has at least 25 successes. Otherwise it falls back to the heuristic score. The basis is always shown.

Full details, validation, and a comparison with published research: [docs/PROBABILITY.md](docs/PROBABILITY.md). Rules and simplifications: [docs/RULES.md](docs/RULES.md).

## Implemented vs. future

**Implemented and tested**
- 152-tile set, legal 13/14-tile deals, tile conservation enforced on every transition
- Declarative card schema and DSL, validation, variant expansion, JSON import of user-supplied cards
- Beginner, Hybrid and Advanced modes; mandatory re-ranking after every exchange; Hybrid milestones
- Full Charleston: R/A/L, optional second Charleston with voting, blind passes, courtesy pass (lower number wins), joker restriction
- Three opponent profiles (Strategic, Casual, Random), each using only its own view
- Heuristic score, Monte Carlo engine (validated against exact hypergeometric results), category-level union probabilities
- Regret-based scoring, decision quality vs. actual outcome, best-pass comparison, flexibility/overlap measure
- Deterministic feedback, change chart, round report, replay, lessons
- Rapid-fire drills, targeted practice with selected racks, spaced repetition, local progress, per-mode personal bests, confidence training, same-rack challenge codes
- Card reference drawer with the card's source, every legal variation, and held-tile highlighting

**Follow-on work (not in this build)**
- **AI coach (Claude).** Deferred by request. The feedback layer already produces structured, engine-sourced facts (`feedback.ts`, plus the analysis and grade objects), so a server-side coach can be added that explains those facts without inventing statistics.
- A full-game win-probability model (opponent hands, discards, defence, game termination)
- Opponents that blind pass, and calling-aware opponent discard models in the simulator
- An official NMJL card. It needs a legitimately obtained card entered by the owner; nothing is bundled.
- Accounts (Google or username/password), server-side progress and score trendlines — see [docs/BACKLOG.md](docs/BACKLOG.md)

## Assumptions

See [docs/RULES.md](docs/RULES.md). The main ones: you are always a non-dealer with 13 tiles, and the dealer is a random opponent with 14. Opponents never blind pass. The courtesy pass is offered only after a Full Charleston. Simulated probabilities treat the current rack as if play started now; they do not model the remaining Charleston passes.
