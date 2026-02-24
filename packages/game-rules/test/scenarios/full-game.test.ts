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

type SimulationResult = {
  finalState: GameState;
  trace: string[];
};

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

function summarize(state: GameState): string {
  const tricks = `${state.tricksWon.teamA}-${state.tricksWon.teamB}`;
  const scores = `${state.scores.teamA}-${state.scores.teamB}`;
  const trump = state.trump ?? "none";
  return `${state.phase}|hand=${state.handNumber}|dealer=${state.dealer}|trump=${trump}|tricks=${tricks}|score=${scores}`;
}

function runDeterministicGame(targetScore = 4): SimulationResult {
  let state = createInitialGameState({
    dealer: "north",
    targetScore
  });

  const trace: string[] = [summarize(state)];
  let guard = 0;
  while (state.phase !== "completed") {
    guard += 1;
    if (guard > 400) {
      throw new Error("Simulation exceeded guard limit.");
    }

    if (state.phase === "deal") {
      state = mustTransition(state, { type: "deal_hand", deck: createEuchreDeck() });
      trace.push(summarize(state));
      continue;
    }

    if (state.phase === "round1_bidding") {
      if (!state.bidding) {
        throw new Error("Missing bidding state in round1_bidding.");
      }
      state = mustTransition(state, {
        type: "bidding",
        action: {
          type: "order_up",
          actor: state.bidding.turn
        }
      });
      trace.push(summarize(state));
      continue;
    }

    if (state.phase === "round2_bidding") {
      if (!state.bidding) {
        throw new Error("Missing bidding state in round2_bidding.");
      }
      const suit = availableRoundTwoTrumpSuits(state.bidding)[0];
      if (!suit) {
        throw new Error("Expected a valid round-two trump option.");
      }

      state = mustTransition(state, {
        type: "bidding",
        action: {
          type: "call_trump",
          actor: state.bidding.turn,
          trump: suit
        }
      });
      trace.push(summarize(state));
      continue;
    }

    if (state.phase === "play") {
      const actor = state.trick?.turn;
      if (!actor) {
        throw new Error("Missing trick turn in play phase.");
      }
      state = mustTransition(state, {
        type: "play_card",
        actor,
        card: chooseLegalCardForTurn(state)
      });
      if (state.phase === "score") {
        trace.push(summarize(state));
      }
      continue;
    }

    if (state.phase === "score") {
      state = mustTransition(state, { type: "score_hand" });
      trace.push(summarize(state));
      continue;
    }

    throw new Error(`Unhandled phase ${state.phase}`);
  }

  trace.push(summarize(state));
  return { finalState: state, trace };
}

test("deterministic full-game simulation runs to completion", () => {
  const first = runDeterministicGame(4);

  assert.equal(first.finalState.phase, "completed");
  assert.ok(first.finalState.winner !== null);
  assert.equal(first.finalState.scores.teamA >= 4 || first.finalState.scores.teamB >= 4, true);
});

test("full-game simulation is reproducible with fixed inputs", () => {
  const first = runDeterministicGame(4);
  const second = runDeterministicGame(4);

  assert.deepEqual(second.trace, first.trace);
  assert.deepEqual(second.finalState.scores, first.finalState.scores);
  assert.equal(second.finalState.winner, first.finalState.winner);
});
