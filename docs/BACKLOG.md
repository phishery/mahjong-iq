# Backlog

Prioritised ideas that are deliberately **not** in the current build.

## 1. Accounts, score trendline, and measured improvement
*Goal: show players their progress, and gather evidence that Mahjong IQ improves hand and category selection. That evidence matters if Mahjong IQ is sold as an app or site.*

- **Sign-in** with Google (OAuth/OIDC) or username + password. Use a hosted auth provider rather than hand-rolled password storage.
- **Server-side progress.** Store every decision (rack, picks, engine candidates, credit, grading basis, mode, card id, timestamp) and every pass, instead of only the `localStorage` summary used today. When a player signs in, migrate their existing local progress (`ProgressData`) into the account.
- **Trendline UI.** Plot score per round over time, per mode and round length (scores are only comparable within a mode), with a rolling average and a per-category recognition rate.
- **Statistics.**
  - Decision credit is already regret-based and relative to each rack's best option, so it controls for rack difficulty.
  - Fit learning curves: credit as a function of the number of rounds played, using a mixed-effects model with a random intercept and slope per player. Report the improvement with confidence intervals.
  - Track category recognition rate and pivot rate over time.
  - Use same-seed benchmark racks (challenge codes) as a fixed pre/post test.
  - Optionally run A/B tests of teaching features, for example whether feedback detail level changes the learning slope.
- **Privacy.** Consent for analytics, data export and deletion, and a minimal set of personal data.
- **Platform.** Currently a static Vite SPA. This feature needs an API, a database and auth, so it would mean adding serverless functions alongside the static site or moving to a full-stack framework.

## 2. AI coach (Claude)
Deferred from the initial build. An optional server-side explainer that receives the engine's structured results (rack, picks, candidates, scores, probabilities, pass grades, and the deterministic feedback facts) and explains them in plain language. It would offer modes such as Quick tip, Explain my mistake, Compare hands, Teach this pattern, and Explain the numbers. Requirements:
- The API key stays in the server environment only.
- Output is validated: every number must come from the payload, or the deterministic text is shown instead.
- Responses are cached per payload.

## 3. Engine fidelity
- A full-game win probability (opponent hands, discards, defence, game termination)
- Opponents that use blind passes, and discards that depend on what opponents need
- Simulating the remaining Charleston passes in the simulator's horizon

## 4. Content
- Loading an official card that the owner has entered themselves (the import already exists)
- More demo cards, and a "Learn the card" memorisation mode with spaced repetition at the line level
