import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameAction,
  availableRoundTwoTrumpSuits,
  createEuchreDeck,
  createInitialGameState,
  effectiveSuit,
  type Card,
  type GameAction,
  type GameState
} from "../../src/index.js";

function mustTransition(state: GameState, action: GameAction): GameState {
  const result = applyGameAction(state, action);
  if (!result.ok) {
    throw new Error(
      `${result.reject.code} (${result.reject.phase}/${result.reject.action}): ${result.reject.message}`
    );
  }

  return result.state;
}

function chooseLegalCardForTurn(state: GameState): Card {
  if (state.phase !== "play" || !state.trick || !state.hands || !state.trump) {
    throw new Error("Expected playable state.");
  }

  const actor = state.trick.turn;
  const hand = state.hands[actor];
  const first = hand[0];
  if (!first) {
    throw new Error(`No cards available for actor ${actor}.`);
  }

  if (state.trick.leadSuit === null) {
    return first;
  }

  for (const entry of hand) {
    if (effectiveSuit(entry, state.trump) === state.trick.leadSuit) {
      return entry;
    }
  }

  return first;
}

test("deterministic full-hand simulation reaches score phase and next deal", () => {
  let state = createInitialGameState({
    dealer: "north",
    targetScore: 10
  });

  // Deal a deterministic hand.
  state = mustTransition(state, {
    type: "deal_hand",
    deck: createEuchreDeck()
  });
  assert.equal(state.phase, "round1_bidding");

  // Round 1 all-pass to force round 2.
  while (state.phase === "round1_bidding") {
    if (!state.bidding) {
      throw new Error("Missing bidding state in round1_bidding.");
    }

    state = mustTransition(state, {
      type: "bidding",
      action: {
        type: "pass",
        actor: state.bidding.turn
      }
    });
  }
  assert.equal(state.phase, "round2_bidding");

  // Round 2 call first allowed suit.
  if (!state.bidding) {
    throw new Error("Missing bidding state in round2_bidding.");
  }
  const callSuit = availableRoundTwoTrumpSuits(state.bidding)[0];
  if (!callSuit) {
    throw new Error("No valid round-two trump options.");
  }
  state = mustTransition(state, {
    type: "bidding",
    action: {
      type: "call_trump",
      actor: state.bidding.turn,
      trump: callSuit
    }
  });

  assert.equal(state.phase, "play");

  // Play all 5 tricks using deterministic legal-card selection.
  let playActions = 0;
  while (state.phase === "play") {
    const actor = state.trick?.turn;
    if (!actor) {
      throw new Error("Missing trick turn during play.");
    }

    state = mustTransition(state, {
      type: "play_card",
      actor,
      card: chooseLegalCardForTurn(state)
    });
    playActions += 1;
    if (playActions > 40) {
      throw new Error("Unexpected play loop; expected 20 card plays.");
    }
  }

  assert.equal(state.phase, "score");
  assert.equal(state.tricksWon.teamA + state.tricksWon.teamB, 5);
  assert.ok(state.lastHand !== null);

  // Score hand and ensure game advances to next deal.
  state = mustTransition(state, { type: "score_hand" });
  assert.equal(state.phase, "deal");
  assert.equal(state.scores.teamA + state.scores.teamB > 0, true);

  state = mustTransition(state, {
    type: "deal_hand",
    deck: createEuchreDeck()
  });
  assert.equal(state.phase, "round1_bidding");
  assert.equal(state.handNumber, 2);
});
