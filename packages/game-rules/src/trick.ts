import { nextSeat } from "./deal.js";
import { compareCardsForTrick, effectiveSuit } from "./trump.js";
import { SEAT_VALUES, type Card, type Seat, type Suit } from "./types.js";

export const TRICK_REJECT_CODE_VALUES = [
  "NOT_YOUR_TURN",
  "INVALID_STATE",
  "CARD_NOT_IN_HAND",
  "MUST_FOLLOW_SUIT"
] as const;

export type TrickRejectCode = (typeof TRICK_REJECT_CODE_VALUES)[number];

export type TrickPlay = {
  seat: Seat;
  card: Card;
};

export type TrickState = {
  leader: Seat;
  turn: Seat;
  trump: Suit;
  partnerSitsOut: Seat | null;
  seatOrder: Seat[];
  leadSuit: Suit | null;
  plays: TrickPlay[];
  complete: boolean;
  winner: Seat | null;
};

export type TrickPlayAction = {
  type: "play_card";
  actor: Seat;
  card: Card;
  actorHand: readonly Card[];
};

export type TrickTransitionSuccess = {
  ok: true;
  state: TrickState;
};

export type TrickTransitionFailure = {
  ok: false;
  code: TrickRejectCode;
  message: string;
};

export type TrickTransitionResult = TrickTransitionSuccess | TrickTransitionFailure;

function reject(code: TrickRejectCode, message: string): TrickTransitionFailure {
  return {
    ok: false,
    code,
    message
  };
}

function cloneCard(card: Card): Card {
  return { suit: card.suit, rank: card.rank };
}

function clonePlay(play: TrickPlay): TrickPlay {
  return {
    seat: play.seat,
    card: cloneCard(play.card)
  };
}

function cloneSeatOrder(seatOrder: readonly Seat[]): Seat[] {
  return [...seatOrder];
}

function sameCard(left: Card, right: Card): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}

function handContainsCard(hand: readonly Card[], card: Card): boolean {
  for (const entry of hand) {
    if (sameCard(entry, card)) {
      return true;
    }
  }

  return false;
}

function handHasEffectiveSuit(hand: readonly Card[], suit: Suit, trump: Suit): boolean {
  for (const entry of hand) {
    if (effectiveSuit(entry, trump) === suit) {
      return true;
    }
  }

  return false;
}

function determineWinningPlay(plays: readonly TrickPlay[], trump: Suit, leadSuit: Suit): TrickPlay {
  const first = plays[0];
  if (!first) {
    throw new Error("Cannot resolve winner for empty trick.");
  }

  let winner = first;
  for (let index = 1; index < plays.length; index += 1) {
    const candidate = plays[index];
    if (!candidate) {
      continue;
    }

    if (compareCardsForTrick(candidate.card, winner.card, trump, leadSuit) > 0) {
      winner = candidate;
    }
  }

  return winner;
}

function buildSeatOrder(leader: Seat, partnerSitsOut: Seat | null): Seat[] {
  const order: Seat[] = [];
  let current = leader;

  for (let index = 0; index < SEAT_VALUES.length; index += 1) {
    if (current !== partnerSitsOut) {
      order.push(current);
    }
    current = nextSeat(current);
  }

  if (order[0] !== leader) {
    throw new Error("Leader must be an active seat.");
  }
  if (order.length < 2) {
    throw new Error("Trick seat order must include at least two active seats.");
  }

  return order;
}

function nextTurnFromSeatOrder(seatOrder: readonly Seat[], actor: Seat): Seat | null {
  const actorIndex = seatOrder.indexOf(actor);
  if (actorIndex === -1) {
    return null;
  }

  const nextIndex = (actorIndex + 1) % seatOrder.length;
  return seatOrder[nextIndex] ?? null;
}

export function resolveWinningSeatForPlays(
  plays: readonly TrickPlay[],
  trump: Suit,
  leadSuit: Suit
): Seat {
  return determineWinningPlay(plays, trump, leadSuit).seat;
}

export function createTrickState(
  leader: Seat,
  trump: Suit,
  partnerSitsOut: Seat | null = null
): TrickState {
  const seatOrder = buildSeatOrder(leader, partnerSitsOut);
  return {
    leader,
    turn: leader,
    trump,
    partnerSitsOut,
    seatOrder,
    leadSuit: null,
    plays: [],
    complete: false,
    winner: null
  };
}

export function resolveTrickWinner(state: TrickState): Seat {
  if (!state.complete) {
    throw new Error("Cannot resolve winner before trick is complete.");
  }

  const winner = state.winner;
  if (!winner) {
    throw new Error("Completed trick must have a winner.");
  }

  return winner;
}

export function applyTrickAction(
  state: TrickState,
  action: TrickPlayAction
): TrickTransitionResult {
  if (state.complete) {
    return reject("INVALID_STATE", "Trick is already complete.");
  }

  if (action.actor !== state.turn) {
    return reject("NOT_YOUR_TURN", "Action actor does not match current trick turn.");
  }
  if (!state.seatOrder.includes(action.actor)) {
    return reject("INVALID_STATE", "Action actor is not active in this trick.");
  }

  if (!handContainsCard(action.actorHand, action.card)) {
    return reject("CARD_NOT_IN_HAND", "Played card is not present in the actor hand.");
  }

  const leadSuit = state.leadSuit ?? effectiveSuit(action.card, state.trump);
  const playedSuit = effectiveSuit(action.card, state.trump);
  if (state.leadSuit !== null) {
    const mustFollowLeadSuit = handHasEffectiveSuit(action.actorHand, state.leadSuit, state.trump);
    if (mustFollowLeadSuit && playedSuit !== state.leadSuit) {
      return reject("MUST_FOLLOW_SUIT", "Actor must follow the trick lead suit.");
    }
  }

  const plays = [...state.plays, { seat: action.actor, card: cloneCard(action.card) }];
  const nextTurn = nextTurnFromSeatOrder(state.seatOrder, action.actor);
  if (!nextTurn) {
    return reject("INVALID_STATE", "Unable to determine next active trick seat.");
  }

  if (plays.length < state.seatOrder.length) {
    return {
      ok: true,
      state: {
        leader: state.leader,
        turn: nextTurn,
        trump: state.trump,
        partnerSitsOut: state.partnerSitsOut,
        seatOrder: cloneSeatOrder(state.seatOrder),
        leadSuit,
        plays: plays.map((entry) => clonePlay(entry)),
        complete: false,
        winner: null
      }
    };
  }

  const winningSeat = resolveWinningSeatForPlays(plays, state.trump, leadSuit);
  return {
    ok: true,
    state: {
      leader: state.leader,
      turn: winningSeat,
      trump: state.trump,
      partnerSitsOut: state.partnerSitsOut,
      seatOrder: cloneSeatOrder(state.seatOrder),
      leadSuit,
      plays: plays.map((entry) => clonePlay(entry)),
      complete: true,
      winner: winningSeat
    }
  };
}
