import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTrickAction,
  createTrickState,
  resolveTrickWinner,
  type Card,
  type TrickState
} from "../src/index.js";

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function mustPlay(
  state: TrickState,
  actor: "north" | "east" | "south" | "west",
  playedCard: Card,
  actorHand: readonly Card[]
): TrickState {
  const result = applyTrickAction(state, {
    type: "play_card",
    actor,
    card: playedCard,
    actorHand
  });
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  return result.state;
}

test("rejects out-of-turn play attempts", () => {
  const trick = createTrickState("north", "spades");

  const result = applyTrickAction(trick, {
    type: "play_card",
    actor: "east",
    card: card("clubs", "A"),
    actorHand: [card("clubs", "A")]
  });

  assert.deepEqual(result, {
    ok: false,
    code: "NOT_YOUR_TURN",
    message: "Action actor does not match current trick turn."
  });
});

test("rejects revoke attempts when actor can follow lead suit", () => {
  let trick = createTrickState("north", "spades");
  trick = mustPlay(trick, "north", card("clubs", "9"), [card("clubs", "9")]);

  const revoke = applyTrickAction(trick, {
    type: "play_card",
    actor: "east",
    card: card("hearts", "K"),
    actorHand: [card("clubs", "A"), card("hearts", "K")]
  });

  assert.equal(revoke.ok, false);
  if (revoke.ok) {
    throw new Error("Expected revoke rejection.");
  }
  assert.equal(revoke.code, "MUST_FOLLOW_SUIT");
});

test("left bower counts as trump for following suit checks", () => {
  let trick = createTrickState("east", "hearts");
  trick = mustPlay(trick, "east", card("hearts", "9"), [card("hearts", "9")]);

  // Left bower of hearts (J diamonds) should count as hearts, so this follows lead.
  const followWithLeftBower = applyTrickAction(trick, {
    type: "play_card",
    actor: "south",
    card: card("diamonds", "J"),
    actorHand: [card("diamonds", "J"), card("clubs", "A")]
  });
  assert.equal(followWithLeftBower.ok, true);

  let trickTwo = createTrickState("east", "hearts");
  trickTwo = mustPlay(trickTwo, "east", card("diamonds", "9"), [card("diamonds", "9")]);

  // Led suit is diamonds. Left bower is effective hearts, so it does not satisfy diamond follow.
  const invalidLeftBower = applyTrickAction(trickTwo, {
    type: "play_card",
    actor: "south",
    card: card("diamonds", "J"),
    actorHand: [card("diamonds", "J"), card("diamonds", "K")]
  });
  assert.equal(invalidLeftBower.ok, false);
  if (invalidLeftBower.ok) {
    throw new Error("Expected left-bower follow-suit rejection.");
  }
  assert.equal(invalidLeftBower.code, "MUST_FOLLOW_SUIT");
});

test("tracks trick completion and resolves winner", () => {
  let trick = createTrickState("north", "hearts");
  trick = mustPlay(trick, "north", card("clubs", "9"), [card("clubs", "9")]);
  trick = mustPlay(trick, "east", card("clubs", "A"), [card("clubs", "A")]);
  trick = mustPlay(trick, "south", card("hearts", "10"), [card("hearts", "10")]);
  trick = mustPlay(trick, "west", card("hearts", "J"), [card("hearts", "J")]);

  assert.equal(trick.complete, true);
  assert.equal(trick.winner, "west");
  assert.equal(trick.turn, "west");
  assert.equal(resolveTrickWinner(trick), "west");
});

test("alone-hand trick seat order skips sitting-out partner and completes after 3 plays", () => {
  let trick = createTrickState("east", "hearts", "west");
  assert.deepEqual(trick.seatOrder, ["east", "south", "north"]);

  trick = mustPlay(trick, "east", card("clubs", "A"), [card("clubs", "A")]);
  assert.equal(trick.turn, "south");
  trick = mustPlay(trick, "south", card("clubs", "K"), [card("clubs", "K")]);
  assert.equal(trick.turn, "north");
  trick = mustPlay(trick, "north", card("hearts", "9"), [card("hearts", "9")]);

  assert.equal(trick.complete, true);
  assert.equal(resolveTrickWinner(trick), "north");
  assert.equal(trick.turn, "north");
});
