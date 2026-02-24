import assert from "node:assert/strict";
import test from "node:test";
import {
  SUIT_VALUES,
  cardFollowsLedSuit,
  compareCardsForTrick,
  effectiveSuit,
  isLeftBower,
  isRightBower,
  isTrumpCard,
  type Suit
} from "../src/index.js";

const LEFT_BOWER_BY_TRUMP: Readonly<Record<Suit, Suit>> = {
  clubs: "spades",
  spades: "clubs",
  diamonds: "hearts",
  hearts: "diamonds"
};

test("right and left bower detection works for all trump suits", () => {
  for (const trump of SUIT_VALUES) {
    const leftBowerSuit = LEFT_BOWER_BY_TRUMP[trump];

    const rightBower = { suit: trump, rank: "J" as const };
    const leftBower = { suit: leftBowerSuit, rank: "J" as const };
    const plainTrump = { suit: trump, rank: "A" as const };

    assert.equal(isRightBower(rightBower, trump), true);
    assert.equal(isLeftBower(rightBower, trump), false);

    assert.equal(isRightBower(leftBower, trump), false);
    assert.equal(isLeftBower(leftBower, trump), true);

    assert.equal(isTrumpCard(rightBower, trump), true);
    assert.equal(isTrumpCard(leftBower, trump), true);
    assert.equal(isTrumpCard(plainTrump, trump), true);
  }
});

test("effective suit maps left bower to trump and enforces follow-suit edge case", () => {
  const trump: Suit = "diamonds";
  const leftBower = { suit: "hearts" as const, rank: "J" as const };
  const heartCard = { suit: "hearts" as const, rank: "Q" as const };

  assert.equal(effectiveSuit(leftBower, trump), trump);
  assert.equal(effectiveSuit(heartCard, trump), "hearts");

  assert.equal(cardFollowsLedSuit(leftBower, "hearts", trump), false);
  assert.equal(cardFollowsLedSuit(heartCard, "hearts", trump), true);
  assert.equal(cardFollowsLedSuit(leftBower, trump, trump), true);
});

test("trump beats led suit and bower ordering is respected", () => {
  const trump: Suit = "hearts";
  const ledSuit: Suit = "clubs";

  const aceOfClubs = { suit: "clubs" as const, rank: "A" as const };
  const nineOfHearts = { suit: "hearts" as const, rank: "9" as const };
  const rightBower = { suit: "hearts" as const, rank: "J" as const };
  const leftBower = { suit: "diamonds" as const, rank: "J" as const };
  const aceOfTrump = { suit: "hearts" as const, rank: "A" as const };

  assert.equal(compareCardsForTrick(aceOfClubs, nineOfHearts, trump, ledSuit) < 0, true);
  assert.equal(compareCardsForTrick(nineOfHearts, aceOfClubs, trump, ledSuit) > 0, true);

  assert.equal(compareCardsForTrick(rightBower, leftBower, trump, ledSuit) > 0, true);
  assert.equal(compareCardsForTrick(leftBower, aceOfTrump, trump, ledSuit) > 0, true);
});

test("when no trump is played, led-suit high card wins", () => {
  const trump: Suit = "spades";
  const ledSuit: Suit = "clubs";

  const kingOfClubs = { suit: "clubs" as const, rank: "K" as const };
  const aceOfClubs = { suit: "clubs" as const, rank: "A" as const };
  const aceOfHearts = { suit: "hearts" as const, rank: "A" as const };

  assert.equal(compareCardsForTrick(aceOfClubs, kingOfClubs, trump, ledSuit) > 0, true);
  assert.equal(compareCardsForTrick(kingOfClubs, aceOfHearts, trump, ledSuit) > 0, true);
  assert.equal(compareCardsForTrick(aceOfHearts, kingOfClubs, trump, ledSuit) < 0, true);
});
