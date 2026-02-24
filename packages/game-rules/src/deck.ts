import { buildCanonicalCardIds, formatCardId, parseCardIdOrThrow } from "./cards.js";
import type { Card } from "./types.js";

function cloneCard(card: Card): Card {
  return { suit: card.suit, rank: card.rank };
}

function assertRngValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random function must return a finite number in [0, 1).");
  }
}

export function createEuchreDeck(): Card[] {
  return buildCanonicalCardIds().map((cardId) => parseCardIdOrThrow(cardId));
}

export function cloneDeck(deck: readonly Card[]): Card[] {
  return deck.map((card) => cloneCard(card));
}

export function toCardIdList(deck: readonly Card[]): string[] {
  return deck.map((card) => formatCardId(card));
}

export function shuffleDeck(deck: readonly Card[], random: () => number): Card[] {
  const next = cloneDeck(deck);

  for (let index = next.length - 1; index > 0; index -= 1) {
    const rng = random();
    assertRngValue(rng);

    const swapIndex = Math.floor(rng * (index + 1));
    const left = next[index];
    const right = next[swapIndex];
    if (!left || !right) {
      throw new Error("Unexpected shuffle index state.");
    }

    next[index] = right;
    next[swapIndex] = left;
  }

  return next;
}
