import { SEAT_VALUES, type Card, type Seat } from "./types.js";

export type DealPattern = readonly [number, number];

export type HandMap = Record<Seat, Card[]>;

export type DealResult = {
  dealer: Seat;
  leader: Seat;
  orderFromDealerLeft: Seat[];
  hands: HandMap;
  upcard: Card;
  kitty: Card[];
};

const DEFAULT_DEAL_PATTERN: DealPattern = [3, 2];

function cloneCard(card: Card): Card {
  return { suit: card.suit, rank: card.rank };
}

function createEmptyHands(): HandMap {
  return {
    north: [],
    east: [],
    south: [],
    west: []
  };
}

function assertDealPattern(pattern: DealPattern): void {
  const [firstPass, secondPass] = pattern;
  if (
    !Number.isInteger(firstPass) ||
    !Number.isInteger(secondPass) ||
    firstPass < 1 ||
    secondPass < 1
  ) {
    throw new Error("Deal pattern values must be positive integers.");
  }

  if (firstPass + secondPass !== 5) {
    throw new Error("Deal pattern must total 5 cards per seat.");
  }
}

export function nextSeat(seat: Seat): Seat {
  switch (seat) {
    case "north":
      return "east";
    case "east":
      return "south";
    case "south":
      return "west";
    case "west":
      return "north";
  }
}

export function rotateDealer(dealer: Seat): Seat {
  return nextSeat(dealer);
}

export function seatOrderFromDealerLeft(dealer: Seat): Seat[] {
  const order: Seat[] = [];
  let current = nextSeat(dealer);

  for (let index = 0; index < SEAT_VALUES.length; index += 1) {
    order.push(current);
    current = nextSeat(current);
  }

  return order;
}

export function dealHandsFromDeck(
  deck: readonly Card[],
  dealer: Seat,
  pattern: DealPattern = DEFAULT_DEAL_PATTERN
): DealResult {
  assertDealPattern(pattern);

  const orderFromDealerLeft = seatOrderFromDealerLeft(dealer);
  const hands = createEmptyHands();
  let cursor = 0;

  for (const passCount of pattern) {
    for (const seat of orderFromDealerLeft) {
      for (let cardCount = 0; cardCount < passCount; cardCount += 1) {
        const sourceCard = deck[cursor];
        if (!sourceCard) {
          throw new Error("Deck does not contain enough cards for dealing.");
        }

        hands[seat].push(cloneCard(sourceCard));
        cursor += 1;
      }
    }
  }

  const sourceUpcard = deck[cursor];
  if (!sourceUpcard) {
    throw new Error("Deck does not contain an upcard after dealing.");
  }

  const upcard = cloneCard(sourceUpcard);
  cursor += 1;
  const kitty = deck.slice(cursor).map((card) => cloneCard(card));

  return {
    dealer,
    leader: orderFromDealerLeft[0] ?? nextSeat(dealer),
    orderFromDealerLeft,
    hands,
    upcard,
    kitty
  };
}
