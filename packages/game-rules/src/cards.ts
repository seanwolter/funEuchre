import {
  RANK_VALUES,
  SUIT_VALUES,
  parseRank,
  parseSuit,
  type Card,
  type Rank,
  type Suit
} from "./types.js";

export const CARD_ID_SEPARATOR = ":" as const;
export const EUCHRE_RANK_ASCENDING: readonly Rank[] = RANK_VALUES;

export type CardId = `${Suit}${typeof CARD_ID_SEPARATOR}${Rank}`;

const RANK_POSITION: Readonly<Record<Rank, number>> = {
  "9": 0,
  "10": 1,
  J: 2,
  Q: 3,
  K: 4,
  A: 5
};

export function rankPosition(rank: Rank): number {
  return RANK_POSITION[rank];
}

export function compareRanksAscending(left: Rank, right: Rank): number {
  if (left === right) {
    return 0;
  }

  return rankPosition(left) < rankPosition(right) ? -1 : 1;
}

export function formatCardId(card: Card): CardId {
  return `${card.suit}${CARD_ID_SEPARATOR}${card.rank}` as CardId;
}

export function parseCardId(input: unknown): Card | null {
  if (typeof input !== "string") {
    return null;
  }

  const parts = input.split(CARD_ID_SEPARATOR);
  if (parts.length !== 2) {
    return null;
  }

  const [suitPart, rankPart] = parts;
  const suit = parseSuit(suitPart);
  const rank = parseRank(rankPart);
  if (!suit || !rank) {
    return null;
  }

  return { suit, rank };
}

export function parseCardIdOrThrow(input: unknown): Card {
  const parsed = parseCardId(input);
  if (!parsed) {
    throw new Error("Invalid card id.");
  }

  return parsed;
}

export function isCardId(input: unknown): input is CardId {
  return parseCardId(input) !== null;
}

export function buildCanonicalCardIds(): CardId[] {
  const ids: CardId[] = [];

  for (const suit of SUIT_VALUES) {
    for (const rank of RANK_VALUES) {
      ids.push(formatCardId({ suit, rank }));
    }
  }

  return ids;
}
