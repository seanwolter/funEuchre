# @fun-euchre/game-rules

Pure deterministic Euchre domain logic used by server/game orchestration layers.

## Purpose

This package models:
- Card identity and rank/suit primitives.
- Trump and bower behavior.
- Deck creation, shuffling, and dealing.
- Bidding transitions (round 1 / round 2 / redeal / alone).
- Trick play validation and winner resolution.
- Hand/game scoring.
- Top-level game-state transitions via `applyGameAction`.

No transport or UI concerns live here.

## Public API Surface

Primary exports are grouped by module:
- `types`: `Suit`, `Rank`, `Seat`, `Team`, `Card`, parser/type-guard helpers.
- `cards`: card-id formatting/parsing and rank ordering helpers.
- `trump`: `isRightBower`, `isLeftBower`, `effectiveSuit`, trick card comparison.
- `deck`: `createEuchreDeck`, `shuffleDeck`, deck clone/id helpers.
- `deal`: seat rotation/order and deterministic deal helpers.
- `bidding`: bidding state + `applyBiddingAction`.
- `trick`: trick state + `applyTrickAction` + winner helpers.
- `scoring`: `scoreHand`, `applyHandScore`, `isGameOver`, `winningTeam`.
- `gameState`: full reducer-style phase transitions via `applyGameAction`.

## Invariants

- All reducers are pure and return new state objects.
- Inputs are validated and invalid transitions are returned as structured rejects.
- Game flow phases are explicit and finite:
  - `deal`
  - `round1_bidding`
  - `round2_bidding`
  - `play`
  - `score`
  - `completed`
- Bower/effective-suit behavior is authoritative for follow-suit and trick resolution.
- Scoring aligns with MVP defaults (including lone 4-point march and euchre defender points).

## Example: Apply Action and Handle Rejection

```ts
import { applyGameAction, createInitialGameState, createEuchreDeck } from "@fun-euchre/game-rules";

let state = createInitialGameState({ dealer: "north" });

const dealt = applyGameAction(state, {
  type: "deal_hand",
  deck: createEuchreDeck()
});

if (!dealt.ok) {
  console.error(dealt.reject.code, dealt.reject.message);
} else {
  state = dealt.state;
}
```

## Package Commands

From repository root:

```bash
pnpm --filter @fun-euchre/game-rules lint
pnpm --filter @fun-euchre/game-rules typecheck
pnpm --filter @fun-euchre/game-rules test
```
