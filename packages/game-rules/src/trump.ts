import { compareRanksAscending } from "./cards.js";
import type { Card, Suit } from "./types.js";

const PLAIN_RANK_STRENGTH: Readonly<Record<Card["rank"], number>> = {
  "9": 0,
  "10": 1,
  J: 2,
  Q: 3,
  K: 4,
  A: 5
};

function leftBowerSuit(trump: Suit): Suit {
  switch (trump) {
    case "clubs":
      return "spades";
    case "spades":
      return "clubs";
    case "diamonds":
      return "hearts";
    case "hearts":
      return "diamonds";
  }
}

function plainRankStrength(card: Card): number {
  return PLAIN_RANK_STRENGTH[card.rank];
}

function trumpRankStrength(card: Card, trump: Suit): number {
  if (isRightBower(card, trump)) {
    return 100;
  }

  if (isLeftBower(card, trump)) {
    return 99;
  }

  return plainRankStrength(card);
}

export function isRightBower(card: Card, trump: Suit): boolean {
  return card.rank === "J" && card.suit === trump;
}

export function isLeftBower(card: Card, trump: Suit): boolean {
  return card.rank === "J" && card.suit === leftBowerSuit(trump);
}

export function effectiveSuit(card: Card, trump: Suit): Suit {
  if (isRightBower(card, trump) || isLeftBower(card, trump)) {
    return trump;
  }

  return card.suit;
}

export function isTrumpCard(card: Card, trump: Suit): boolean {
  return effectiveSuit(card, trump) === trump;
}

export function cardFollowsLedSuit(card: Card, ledSuit: Suit, trump: Suit): boolean {
  return effectiveSuit(card, trump) === ledSuit;
}

export function compareCardsForTrick(left: Card, right: Card, trump: Suit, ledSuit: Suit): number {
  const leftEffective = effectiveSuit(left, trump);
  const rightEffective = effectiveSuit(right, trump);
  const leftIsTrump = leftEffective === trump;
  const rightIsTrump = rightEffective === trump;

  if (leftIsTrump && rightIsTrump) {
    return trumpRankStrength(left, trump) - trumpRankStrength(right, trump);
  }
  if (leftIsTrump && !rightIsTrump) {
    return 1;
  }
  if (!leftIsTrump && rightIsTrump) {
    return -1;
  }

  const leftFollowsLead = leftEffective === ledSuit;
  const rightFollowsLead = rightEffective === ledSuit;

  if (leftFollowsLead && !rightFollowsLead) {
    return 1;
  }
  if (!leftFollowsLead && rightFollowsLead) {
    return -1;
  }

  if (left.rank === right.rank) {
    return 0;
  }

  return compareRanksAscending(left.rank, right.rank);
}
