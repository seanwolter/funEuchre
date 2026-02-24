import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBiddingAction,
  availableRoundTwoTrumpSuits,
  createBiddingState,
  type BiddingTransitionResult,
  type BiddingState
} from "../src/index.js";

function mustApply(state: BiddingState, action: Parameters<typeof applyBiddingAction>[1]): BiddingState {
  const result = applyBiddingAction(state, action);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.state;
}

function expectSuccess(result: BiddingTransitionResult): BiddingState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  return result.state;
}

test("round 1 order_up fixes trump and requires dealer exchange", () => {
  const start = createBiddingState("north", "hearts");

  const result = applyBiddingAction(start, {
    type: "order_up",
    actor: "east"
  });
  const next = expectSuccess(result);

  assert.equal(next.status, "trump_selected");
  assert.equal(next.trump, "hearts");
  assert.equal(next.maker, "east");
  assert.equal(next.dealerExchangeRequired, true);
  assert.equal(next.partnerSitsOut, null);
});

test("not-your-turn and wrong-round calls are rejected", () => {
  const start = createBiddingState("north", "clubs");

  const notYourTurn = applyBiddingAction(start, {
    type: "pass",
    actor: "south"
  });
  assert.deepEqual(notYourTurn, {
    ok: false,
    code: "NOT_YOUR_TURN",
    message: "Action actor does not match current bidding turn."
  });

  const invalidRound = applyBiddingAction(start, {
    type: "call_trump",
    actor: "east",
    trump: "spades"
  });
  assert.equal(invalidRound.ok, false);
  if (invalidRound.ok) {
    throw new Error("Expected invalid-round rejection.");
  }
  assert.equal(invalidRound.code, "INVALID_ACTION");
});

test("full pass cycles transition to round 2 and then redeal", () => {
  let state = createBiddingState("west", "diamonds");

  // Round 1 passes: north -> east -> south -> west
  state = mustApply(state, { type: "pass", actor: "north" });
  state = mustApply(state, { type: "pass", actor: "east" });
  state = mustApply(state, { type: "pass", actor: "south" });
  state = mustApply(state, { type: "pass", actor: "west" });

  assert.equal(state.round, 2);
  assert.equal(state.turn, "north");
  assert.equal(state.status, "active");
  assert.equal(state.passesInRound, 0);

  // Round 2 passes: north -> east -> south -> west
  state = mustApply(state, { type: "pass", actor: "north" });
  state = mustApply(state, { type: "pass", actor: "east" });
  state = mustApply(state, { type: "pass", actor: "south" });
  state = mustApply(state, { type: "pass", actor: "west" });

  assert.equal(state.status, "redeal_required");
  assert.equal(state.redealDealer, "north");
  assert.equal(state.turn, "north");
});

test("round 2 cannot call turned-down suit and accepts valid calls", () => {
  let state = createBiddingState("north", "clubs");
  state = mustApply(state, { type: "pass", actor: "east" });
  state = mustApply(state, { type: "pass", actor: "south" });
  state = mustApply(state, { type: "pass", actor: "west" });
  state = mustApply(state, { type: "pass", actor: "north" });

  assert.deepEqual(availableRoundTwoTrumpSuits(state), ["diamonds", "hearts", "spades"]);

  const turnedDownSuitCall = applyBiddingAction(state, {
    type: "call_trump",
    actor: "east",
    trump: "clubs"
  });
  assert.equal(turnedDownSuitCall.ok, false);
  if (turnedDownSuitCall.ok) {
    throw new Error("Expected turned-down-suit rejection.");
  }
  assert.equal(turnedDownSuitCall.code, "INVALID_ACTION");

  const goodCall = applyBiddingAction(state, {
    type: "call_trump",
    actor: "east",
    trump: "spades"
  });
  const next = expectSuccess(goodCall);

  assert.equal(next.status, "trump_selected");
  assert.equal(next.trump, "spades");
  assert.equal(next.dealerExchangeRequired, false);
});

test("alone declaration causes maker partner to sit out in both rounds", () => {
  const roundOne = applyBiddingAction(createBiddingState("north", "hearts"), {
    type: "order_up",
    actor: "east",
    alone: true
  });
  const roundOneState = expectSuccess(roundOne);
  assert.equal(roundOneState.alone, true);
  assert.equal(roundOneState.partnerSitsOut, "west");

  let roundTwo = createBiddingState("west", "diamonds");
  roundTwo = mustApply(roundTwo, { type: "pass", actor: "north" });
  roundTwo = mustApply(roundTwo, { type: "pass", actor: "east" });
  roundTwo = mustApply(roundTwo, { type: "pass", actor: "south" });
  roundTwo = mustApply(roundTwo, { type: "pass", actor: "west" });

  const callAlone = applyBiddingAction(roundTwo, {
    type: "call_trump",
    actor: "north",
    trump: "hearts",
    alone: true
  });
  const callAloneState = expectSuccess(callAlone);
  assert.equal(callAloneState.alone, true);
  assert.equal(callAloneState.partnerSitsOut, "south");
});
