import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTrickAction,
  createTrickState,
  resolveTrickWinner,
  resolveWinningSeatForPlays,
  type Card,
  type TrickPlay,
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

test("winner resolution with no trump played uses highest led-suit card", () => {
  let trick = createTrickState("north", "spades");
  trick = mustPlay(trick, "north", card("clubs", "K"), [card("clubs", "K")]);
  trick = mustPlay(trick, "east", card("clubs", "A"), [card("clubs", "A")]);
  trick = mustPlay(trick, "south", card("hearts", "A"), [card("hearts", "A")]);
  trick = mustPlay(trick, "west", card("clubs", "Q"), [card("clubs", "Q")]);

  assert.equal(trick.complete, true);
  assert.equal(resolveTrickWinner(trick), "east");
  assert.equal(trick.turn, "east");
});

test("single trump in trick beats all led-suit cards", () => {
  let trick = createTrickState("north", "hearts");
  trick = mustPlay(trick, "north", card("clubs", "A"), [card("clubs", "A")]);
  trick = mustPlay(trick, "east", card("clubs", "K"), [card("clubs", "K")]);
  trick = mustPlay(trick, "south", card("hearts", "9"), [card("hearts", "9")]);
  trick = mustPlay(trick, "west", card("clubs", "Q"), [card("clubs", "Q")]);

  assert.equal(resolveTrickWinner(trick), "south");
  assert.equal(trick.turn, "south");
});

test("highest trump wins when multiple trumps are played", () => {
  let trick = createTrickState("north", "spades");
  trick = mustPlay(trick, "north", card("hearts", "A"), [card("hearts", "A")]);
  trick = mustPlay(trick, "east", card("spades", "9"), [card("spades", "9")]);
  trick = mustPlay(trick, "south", card("spades", "A"), [card("spades", "A")]);
  trick = mustPlay(trick, "west", card("spades", "10"), [card("spades", "10")]);

  assert.equal(resolveTrickWinner(trick), "south");
  assert.equal(trick.turn, "south");
});

test("bower ordering is right bower > left bower > other trump cards", () => {
  const plays: TrickPlay[] = [
    { seat: "north", card: card("hearts", "A") },
    { seat: "east", card: card("diamonds", "J") }, // left bower for hearts trump
    { seat: "south", card: card("hearts", "J") }, // right bower
    { seat: "west", card: card("hearts", "K") }
  ];

  assert.equal(resolveWinningSeatForPlays(plays, "hearts", "hearts"), "south");
});
