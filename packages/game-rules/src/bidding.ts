import { nextSeat, rotateDealer } from "./deal.js";
import type { Seat, Suit } from "./types.js";

export const BIDDING_REJECT_CODE_VALUES = [
  "NOT_YOUR_TURN",
  "INVALID_ACTION",
  "INVALID_STATE"
] as const;

export type BiddingRejectCode = (typeof BIDDING_REJECT_CODE_VALUES)[number];

export type BiddingStatus = "active" | "trump_selected" | "redeal_required";
export type BiddingRound = 1 | 2;

export type BiddingState = {
  dealer: Seat;
  turn: Seat;
  round: BiddingRound;
  upcardSuit: Suit;
  turnedDownSuit: Suit;
  status: BiddingStatus;
  passesInRound: number;
  maker: Seat | null;
  trump: Suit | null;
  alone: boolean;
  partnerSitsOut: Seat | null;
  dealerExchangeRequired: boolean;
  redealDealer: Seat | null;
};

export type BiddingPassAction = {
  type: "pass";
  actor: Seat;
};

export type BiddingOrderUpAction = {
  type: "order_up";
  actor: Seat;
  alone?: boolean;
};

export type BiddingCallTrumpAction = {
  type: "call_trump";
  actor: Seat;
  trump: Suit;
  alone?: boolean;
};

export type BiddingAction = BiddingPassAction | BiddingOrderUpAction | BiddingCallTrumpAction;

export type BiddingTransitionSuccess = {
  ok: true;
  state: BiddingState;
};

export type BiddingTransitionFailure = {
  ok: false;
  code: BiddingRejectCode;
  message: string;
};

export type BiddingTransitionResult = BiddingTransitionSuccess | BiddingTransitionFailure;

function reject(code: BiddingRejectCode, message: string): BiddingTransitionFailure {
  return {
    ok: false,
    code,
    message
  };
}

function withPartnerSitOut(maker: Seat, alone: boolean): Seat | null {
  if (!alone) {
    return null;
  }

  switch (maker) {
    case "north":
      return "south";
    case "south":
      return "north";
    case "east":
      return "west";
    case "west":
      return "east";
  }
}

function asAloneFlag(value: boolean | undefined): boolean {
  return value === true;
}

function cloneState(state: BiddingState): BiddingState {
  return { ...state };
}

export function createBiddingState(dealer: Seat, upcardSuit: Suit): BiddingState {
  return {
    dealer,
    turn: nextSeat(dealer),
    round: 1,
    upcardSuit,
    turnedDownSuit: upcardSuit,
    status: "active",
    passesInRound: 0,
    maker: null,
    trump: null,
    alone: false,
    partnerSitsOut: null,
    dealerExchangeRequired: false,
    redealDealer: null
  };
}

export function availableRoundTwoTrumpSuits(state: BiddingState): Suit[] {
  return state.upcardSuit === "clubs"
    ? ["diamonds", "hearts", "spades"]
    : state.upcardSuit === "diamonds"
      ? ["clubs", "hearts", "spades"]
      : state.upcardSuit === "hearts"
        ? ["clubs", "diamonds", "spades"]
        : ["clubs", "diamonds", "hearts"];
}

export function applyBiddingAction(
  state: BiddingState,
  action: BiddingAction
): BiddingTransitionResult {
  if (state.status !== "active") {
    return reject("INVALID_STATE", "Bidding is no longer active.");
  }

  if (action.actor !== state.turn) {
    return reject("NOT_YOUR_TURN", "Action actor does not match current bidding turn.");
  }

  if (action.type === "pass") {
    const next = cloneState(state);
    const nextPasses = next.passesInRound + 1;

    if (next.round === 1) {
      if (nextPasses < 4) {
        next.passesInRound = nextPasses;
        next.turn = nextSeat(next.turn);
        return { ok: true, state: next };
      }

      next.round = 2;
      next.turn = nextSeat(next.dealer);
      next.passesInRound = 0;
      return { ok: true, state: next };
    }

    if (nextPasses < 4) {
      next.passesInRound = nextPasses;
      next.turn = nextSeat(next.turn);
      return { ok: true, state: next };
    }

    next.status = "redeal_required";
    next.redealDealer = rotateDealer(next.dealer);
    next.turn = next.redealDealer;
    next.passesInRound = nextPasses;
    return { ok: true, state: next };
  }

  if (action.type === "order_up") {
    if (state.round !== 1) {
      return reject("INVALID_ACTION", "order_up is only allowed in round 1.");
    }

    const alone = asAloneFlag(action.alone);
    const next = cloneState(state);
    next.status = "trump_selected";
    next.maker = action.actor;
    next.trump = next.upcardSuit;
    next.alone = alone;
    next.partnerSitsOut = withPartnerSitOut(action.actor, alone);
    next.dealerExchangeRequired = true;
    return { ok: true, state: next };
  }

  if (state.round !== 2) {
    return reject("INVALID_ACTION", "call_trump is only allowed in round 2.");
  }

  if (action.trump === state.turnedDownSuit) {
    return reject("INVALID_ACTION", "Round 2 cannot call the turned-down suit.");
  }

  const alone = asAloneFlag(action.alone);
  const next = cloneState(state);
  next.status = "trump_selected";
  next.maker = action.actor;
  next.trump = action.trump;
  next.alone = alone;
  next.partnerSitsOut = withPartnerSitOut(action.actor, alone);
  next.dealerExchangeRequired = false;
  return { ok: true, state: next };
}
