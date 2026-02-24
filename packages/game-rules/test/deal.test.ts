import assert from "node:assert/strict";
import test from "node:test";
import {
  createEuchreDeck,
  dealHandsFromDeck,
  nextSeat,
  rotateDealer,
  seatOrderFromDealerLeft,
  toCardIdList,
  type Seat
} from "../src/index.js";

test("dealer rotation is deterministic and cycles through all seats", () => {
  assert.equal(rotateDealer("north"), "east");
  assert.equal(rotateDealer("east"), "south");
  assert.equal(rotateDealer("south"), "west");
  assert.equal(rotateDealer("west"), "north");

  let current: Seat = "north";
  for (let index = 0; index < 4; index += 1) {
    current = nextSeat(current);
  }
  assert.equal(current, "north");
});

test("seatOrderFromDealerLeft starts with dealer-left and proceeds clockwise", () => {
  assert.deepEqual(seatOrderFromDealerLeft("north"), ["east", "south", "west", "north"]);
  assert.deepEqual(seatOrderFromDealerLeft("east"), ["south", "west", "north", "east"]);
  assert.deepEqual(seatOrderFromDealerLeft("south"), ["west", "north", "east", "south"]);
  assert.deepEqual(seatOrderFromDealerLeft("west"), ["north", "east", "south", "west"]);
});

test("dealHandsFromDeck deals 5 cards each, surfaces upcard, and preserves card conservation", () => {
  const deck = createEuchreDeck();
  const sourceDeckIds = toCardIdList(deck);

  const result = dealHandsFromDeck(deck, "north");
  const dealtIds = [
    ...toCardIdList(result.hands.north),
    ...toCardIdList(result.hands.east),
    ...toCardIdList(result.hands.south),
    ...toCardIdList(result.hands.west),
    ...toCardIdList([result.upcard]),
    ...toCardIdList(result.kitty)
  ];

  assert.equal(result.hands.north.length, 5);
  assert.equal(result.hands.east.length, 5);
  assert.equal(result.hands.south.length, 5);
  assert.equal(result.hands.west.length, 5);
  assert.equal(result.kitty.length, 3);
  assert.equal(result.leader, "east");
  assert.deepEqual(result.orderFromDealerLeft, ["east", "south", "west", "north"]);

  assert.equal(dealtIds.length, 24);
  assert.equal(new Set(dealtIds).size, 24);
  assert.deepEqual(new Set(dealtIds), new Set(sourceDeckIds));

  // Input deck should remain unchanged.
  assert.deepEqual(toCardIdList(deck), sourceDeckIds);
});

test("dealHandsFromDeck rejects insufficient deck size", () => {
  const shortDeck = createEuchreDeck().slice(0, 20);

  assert.throws(
    () => dealHandsFromDeck(shortDeck, "west"),
    /Deck does not contain enough cards|Deck does not contain an upcard/
  );
});

test("dealHandsFromDeck supports alternate 2-3 deal pattern", () => {
  const deck = createEuchreDeck();
  const result = dealHandsFromDeck(deck, "west", [2, 3]);

  assert.equal(result.hands.north.length, 5);
  assert.equal(result.hands.east.length, 5);
  assert.equal(result.hands.south.length, 5);
  assert.equal(result.hands.west.length, 5);
  assert.equal(result.leader, "north");
});
