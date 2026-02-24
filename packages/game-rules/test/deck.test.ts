import assert from "node:assert/strict";
import test from "node:test";
import {
  RANK_VALUES,
  SUIT_VALUES,
  buildCanonicalCardIds,
  createEuchreDeck,
  shuffleDeck,
  toCardIdList
} from "../src/index.js";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("createEuchreDeck returns the exact 24-card euchre deck", () => {
  const deck = createEuchreDeck();
  const ids = toCardIdList(deck);
  const expectedCount = SUIT_VALUES.length * RANK_VALUES.length;

  assert.equal(deck.length, expectedCount);
  assert.equal(new Set(ids).size, expectedCount);
  assert.deepEqual(ids, buildCanonicalCardIds());
});

test("shuffleDeck is deterministic with the same seed", () => {
  const sourceDeck = createEuchreDeck();
  const sourceIds = toCardIdList(sourceDeck);

  const shuffledOne = shuffleDeck(sourceDeck, seededRandom(42));
  const shuffledTwo = shuffleDeck(sourceDeck, seededRandom(42));
  const shuffledDifferentSeed = shuffleDeck(sourceDeck, seededRandom(43));

  assert.deepEqual(toCardIdList(shuffledOne), toCardIdList(shuffledTwo));
  assert.notDeepEqual(toCardIdList(shuffledOne), toCardIdList(shuffledDifferentSeed));

  // Source deck should not be mutated by shuffling.
  assert.deepEqual(toCardIdList(sourceDeck), sourceIds);
});

test("shuffleDeck rejects invalid RNG outputs", () => {
  const deck = createEuchreDeck();

  assert.throws(() => shuffleDeck(deck, () => Number.NaN), /Random function must return/);
  assert.throws(() => shuffleDeck(deck, () => -0.1), /Random function must return/);
  assert.throws(() => shuffleDeck(deck, () => 1), /Random function must return/);
});
