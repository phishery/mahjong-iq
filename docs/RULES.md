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
- A training round ends after the Charleston. Full games are covered below.
- Hidden information: the player's analysis receives only the player's rack and the tiles they have passed away. Opponents see only their own rack and their own passes.

# Full games (play)

Live play lives in `src/engine/table/` and is covered by `tests/engine/table.test.ts` and `tests/server/room.test.ts`. Seats are absolute: East (the dealer) is seat 0, then South, West and North in turn order. Play passes to the right.

## Charleston at the table
The same passes as above, with any number of people. Every pass is simultaneous.
- **Blind passes for people:** on the first Left and the last Right, a person may forward 1–3 of the incoming tiles unseen. The forwarded tiles are chosen at random from the incoming three (they are face down). If forwards chain all the way around the table, that slot carries no tile, so each seat in the loop passes and receives one tile fewer and rack sizes stay the same.
- Bots never blind pass, and decide passes, votes and courtesy requests as the trainer's opponents do.

## Play
- East discards first, without drawing. After each discard the other seats may call it; a seat that has no legal call passes automatically.
- **Calls:** a discard can be called to expose a pung, kong, quint or sextet (the called tile plus matching tiles or Jokers from the rack), or for Mahjong. Mahjong beats an exposure; otherwise the seat next in turn order wins the call. The caller then discards without drawing, and play continues to their right.
- Pairs and singles can only be called for Mahjong. Concealed hands can only call for Mahjong.
- A discarded Joker can't be called.
- **Joker swaps:** on your turn, before discarding, you may give the exact tile a Joker stands for in any exposure (yours or another player's) and take the Joker.
- **Mahjong:** 14 tiles that exactly match a hand on the card, with exposures matching joker-eligible groups of that hand. Self-drawn Mahjong is declared on your turn.
- **Wall game:** if the wall runs out, nobody wins.

## Settlement
The hand's card value (25 if the card gives none), doubled when the hand is jokerless (except hands that can never use Jokers). On a discard, the discarder pays double and the other two pay single. When self-drawn, all three pay double.

## Simplifications
- Exposures that no hand on the card could use are refused rather than allowed and later called dead, so dead hands and Mahjong-in-error penalties are not modelled.
- Seats that cannot call a discard pass automatically, so how long a call window stays open can reveal that someone is able to call.
- In online play, people have 12 seconds to call; then they pass. A bot plays for anyone disconnected for 45 seconds or more, until they reconnect.
- No East-doubling, "pay for all" or other house rules.
