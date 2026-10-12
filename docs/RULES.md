# Rules implemented

All Charleston rules live in `src/engine/charleston.ts`. The round flow lives in `src/engine/game.ts`. Both are covered by `tests/engine/charleston-game.test.ts`.

## Tile set
152 tiles: 108 suited (Bam, Crak, Dot × 1–9 × 4), 16 winds, 12 dragons (Green with Bam, Red with Crak, White/"Soap" with Dot), 8 Flowers and 8 Jokers.

## Deal
- The dealer (East) receives 14 tiles and everyone else 13.
- **Assumption:** the player is always a non-dealer. The dealer is chosen at random from the three opponents by the round seed.

## Charleston (standard NMJL practice)
| Step | Direction | Blind pass allowed |
|---|---|---|
| First Charleston (mandatory) | Right, Across, Left | First Left only |
| Second Charleston (optional) | Left, Across, Right | Last Right only |
| Courtesy pass (optional) | Across | — |

- Every Charleston pass is exactly **3 tiles**.
- **Blind pass ("steal"):** on the first Left and the last Right, a player may forward 1–3 of the tiles arriving to them, unseen, and make up the rest from their own rack. In the simulation the forwarded tiles are chosen at random, because they are face down.
- **Second Charleston:** happens only if *all four* players agree. Any single player may stop it.
- **Courtesy pass:** players across from each other exchange 0–3 tiles. If they ask for different numbers, the lower number is used. The right/left pair performs its own courtesy exchange too.
- **Jokers can never be passed**, in the Charleston or the courtesy pass. Flowers can be passed freely.

## Hands and Jokers
- Every hand is exactly 14 tiles.
- Jokers may substitute for any tile in a group of three or more identical tiles (pung, kong, quint, sextet). They never substitute in a single or a pair. This includes Flower groups of 3+.
- A quint of a numbered tile or a wind therefore always needs at least one Joker.
- Exposed (X) hands may call discards to complete pungs, kongs and quints. Concealed (C) hands may only call the final tile for Mahjong.

## Simplifications
- Opponents never blind pass. This keeps pass resolution free of circular dependencies.
- The courtesy pass is offered only in Full Charleston rounds. The Quick and Two-pass rounds stop earlier.
- The round ends after the Charleston. Play, calls, dead hands, joker exchanges and scoring of a full game are out of scope.
- Hidden information: the player's analysis receives only the player's rack and the tiles they have passed away. Opponents see only their own rack and their own passes.
