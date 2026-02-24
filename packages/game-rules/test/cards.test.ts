import assert from "node:assert/strict";
import test from "node:test";
import {
  EUCHRE_RANK_ASCENDING,
  RANK_VALUES,
  SUIT_VALUES,
  buildCanonicalCardIds,
  compareRanksAscending,
  formatCardId,
  isCard,
  isCardId,
  isRank,
  isSuit,
  parseCard,
  parseCardId,
  parseCardIdOrThrow,
  parseCardOrThrow,
  parseRank,
  parseSuit
} from "../src/index.js";

test("card identities are canonical and unique across all 24 cards", () => {
  const expectedCount = SUIT_VALUES.length * RANK_VALUES.length;
  const generated = buildCanonicalCardIds();

  assert.equal(generated.length, expectedCount);
  assert.equal(new Set(generated).size, expectedCount);

  for (const suit of SUIT_VALUES) {
    for (const rank of RANK_VALUES) {
      const card = { suit, rank };
      const id = formatCardId(card);

      assert.equal(id, `${suit}:${rank}`);
      assert.equal(generated.includes(id), true);
      assert.deepEqual(parseCardId(id), card);
    }
  }
});

test("invalid suit, rank, and card inputs are rejected", () => {
  assert.equal(isSuit("clubs"), true);
  assert.equal(isSuit("club"), false);
  assert.equal(parseSuit("hearts"), "hearts");
  assert.equal(parseSuit(" hearts"), null);

  assert.equal(isRank("A"), true);
  assert.equal(isRank("1"), false);
  assert.equal(parseRank("10"), "10");
  assert.equal(parseRank(" 10"), null);

  assert.equal(isCard({ suit: "spades", rank: "A" }), true);
  assert.equal(isCard({ suit: "spade", rank: "A" }), false);
  assert.deepEqual(parseCard({ suit: "diamonds", rank: "Q" }), {
    suit: "diamonds",
    rank: "Q"
  });
  assert.equal(parseCard({ suit: "diamonds", rank: "7" }), null);
  assert.throws(() => parseCardOrThrow({ suit: "diamonds", rank: "7" }), /Invalid card/);
});

test("card id parsing rejects malformed values", () => {
  const invalidInputs: unknown[] = [
    undefined,
    null,
    5,
    "",
    "clubs",
    "clubs-9",
    "club:9",
    "clubs:11",
    "spades:A:extra",
    "clubs: 9"
  ];

  for (const input of invalidInputs) {
    assert.equal(parseCardId(input), null);
    assert.equal(isCardId(input), false);
  }

  assert.throws(() => parseCardIdOrThrow("club:9"), /Invalid card id/);
});

test("euchre rank order is canonical from 9 to A", () => {
  assert.deepEqual(EUCHRE_RANK_ASCENDING, ["9", "10", "J", "Q", "K", "A"]);
  assert.equal(compareRanksAscending("9", "10"), -1);
  assert.equal(compareRanksAscending("Q", "Q"), 0);
  assert.equal(compareRanksAscending("A", "K"), 1);
});
