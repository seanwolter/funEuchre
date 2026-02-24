export const SUIT_VALUES = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANK_VALUES = ["9", "10", "J", "Q", "K", "A"] as const;
export const SEAT_VALUES = ["north", "east", "south", "west"] as const;
export const TEAM_VALUES = ["teamA", "teamB"] as const;

export type Suit = (typeof SUIT_VALUES)[number];
export type Rank = (typeof RANK_VALUES)[number];
export type Seat = (typeof SEAT_VALUES)[number];
export type Team = (typeof TEAM_VALUES)[number];

export type Card = {
  suit: Suit;
  rank: Rank;
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function isSuit(input: unknown): input is Suit {
  return typeof input === "string" && SUIT_VALUES.includes(input as Suit);
}

export function isRank(input: unknown): input is Rank {
  return typeof input === "string" && RANK_VALUES.includes(input as Rank);
}

export function isSeat(input: unknown): input is Seat {
  return typeof input === "string" && SEAT_VALUES.includes(input as Seat);
}

export function isTeam(input: unknown): input is Team {
  return typeof input === "string" && TEAM_VALUES.includes(input as Team);
}

export function parseSuit(input: unknown): Suit | null {
  return isSuit(input) ? input : null;
}

export function parseRank(input: unknown): Rank | null {
  return isRank(input) ? input : null;
}

export function parseSeat(input: unknown): Seat | null {
  return isSeat(input) ? input : null;
}

export function parseTeam(input: unknown): Team | null {
  return isTeam(input) ? input : null;
}

export function isCard(input: unknown): input is Card {
  if (!isRecord(input)) {
    return false;
  }

  return isSuit(input.suit) && isRank(input.rank);
}

export function parseCard(input: unknown): Card | null {
  if (!isCard(input)) {
    return null;
  }

  return {
    suit: input.suit,
    rank: input.rank
  };
}

export function parseCardOrThrow(input: unknown): Card {
  const parsed = parseCard(input);
  if (!parsed) {
    throw new Error("Invalid card value.");
  }

  return parsed;
}
