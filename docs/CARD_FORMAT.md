# Card definition format

Cards are JSON documents that are validated before use. The engine and the card are independent, so adding a new year means writing one file.

> **Copyright:** the official NMJL card is copyrighted. Mahjong IQ bundles only a fictional demo card. If you own a card, you may enter it for personal practice, but do not redistribute it. Cards you import are stored only in your own browser.

## Structure

```json
{
  "schemaVersion": 1,
  "id": "my-card-2027",
  "year": 2027,
  "title": "My 2027 card",
  "source": {
    "kind": "user-supplied",
    "attribution": "Entered by me from my own copy of the card",
    "official": false
  },
  "categories": [{ "id": "run", "name": "Consecutive Run", "description": "…" }],
  "hands": [
    {
      "id": "RUN-1",
      "category": "run",
      "line": 1,
      "pattern": "2F 4x:A 4x+1:A 4x+2:A",
      "concealed": false,
      "value": 25,
      "description": "FF 1111 2222 3333 — any 3 consecutive numbers, one suit"
    }
  ]
}
```

`source.kind` is one of `demo`, `licensed` or `user-supplied`. A demo card can never be marked `official`.

## Pattern DSL

A pattern is a list of groups separated by spaces. Each group is written `COUNT TILE[:SUITVAR]`.

| Part | Meaning |
|---|---|
| `COUNT` | 1 single, 2 pair, 3 pung, 4 kong, 5 quint, 6 sextet |
| `1`–`9` | a fixed number (needs a suit variable) |
| `x`, `x+1`, `y-2` | a number variable with an offset (needs a suit variable) |
| `D` | the dragon matching the group's suit (Bam→Green, Crak→Red, Dot→White) |
| `N` `E` `W` `S` `F` | winds and Flowers |
| `GD` `RD` `WD` | fixed dragons |
| `0` | the White Dragon used as zero (year hands) |
| `:A` `:B` `:C` | suit variables. Different letters must be different suits (they are the card's colours). |

Optional fields on a hand:
- `vars`: an explicit domain for a number variable, e.g. `{"x": [1, 3, 5]}`. The default is every value that keeps all its tiles within 1–9.
- `distinctVars`: defaults to `true`, which means `x` and `y` must differ.
- `jokers`: `"standard"` (the default; Jokers are allowed in groups of 3+) or `"none"`.

Joker eligibility comes from the group size, following NMJL practice. Each line is expanded into every concrete suit and number assignment, and duplicates (for example, symmetric suit swaps) are removed.

## Entering a complete card

1. Copy `src/engine/cards/demo-card.json` and replace its metadata.
2. Add one category per section of the card, in card order.
3. For each line, write the pattern. Use one suit variable per colour on the printed card, and a number variable wherever the card says "any".
4. Run `npm run validate-card -- my-card.json`. It checks the structure, that every variant has 14 tiles, the supply limits (pairs and singles can't exceed 4 copies, or 8 for Flowers), the Joker limits, unknown categories and duplicate ids, and it prints variant counts per category.
5. In the app, open **Card → Load a card → Import card JSON…**.
