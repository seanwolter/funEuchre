import { applyBiddingAction, createBiddingState, type BiddingAction } from "./bidding.js";
import {
  createEuchreDeck
} from "./deck.js";
import {
  dealHandsFromDeck,
  nextSeat,
  rotateDealer,
  type DealPattern,
  type HandMap
} from "./deal.js";
import {
  applyHandScore,
  createTeamScore,
  isGameOver,
  scoreHand,
  winningTeam,
  type HandScoringResult,
  type TeamScore
} from "./scoring.js";
import {
  applyTrickAction,
  createTrickState,
  resolveTrickWinner,
  type TrickRejectCode,
  type TrickState
} from "./trick.js";
import { SEAT_VALUES, type Card, type Seat, type Suit, type Team } from "./types.js";

export const GAME_REJECT_CODE_VALUES = [
  "NOT_YOUR_TURN",
  "INVALID_ACTION",
  "INVALID_STATE"
] as const;

export type GameRejectCode = (typeof GAME_REJECT_CODE_VALUES)[number];

export type GamePhase =
  | "deal"
  | "round1_bidding"
  | "round2_bidding"
  | "play"
  | "score"
  | "completed";

export type GameState = {
  phase: GamePhase;
  handNumber: number;
  dealer: Seat;
  targetScore: number;
  scores: TeamScore;
  winner: Team | null;
  hands: HandMap | null;
  upcard: Card | null;
  kitty: Card[] | null;
  bidding: ReturnType<typeof createBiddingState> | null;
  trump: Suit | null;
  maker: Seat | null;
  alone: boolean;
  partnerSitsOut: Seat | null;
  trick: TrickState | null;
  tricksWon: TeamScore;
  lastHand: HandScoringResult | null;
};

export type DealHandGameAction = {
  type: "deal_hand";
  deck?: readonly Card[];
  pattern?: DealPattern;
};

export type BiddingGameAction = {
  type: "bidding";
  action: BiddingAction;
};

export type PlayCardGameAction = {
  type: "play_card";
  actor: Seat;
  card: Card;
};

export type ScoreHandGameAction = {
  type: "score_hand";
};

export type GameAction =
  | DealHandGameAction
  | BiddingGameAction
  | PlayCardGameAction
  | ScoreHandGameAction;

export type GameReject = {
  code: GameRejectCode;
  protocolCode: GameRejectCode;
  message: string;
  phase: GamePhase;
  action: GameAction["type"];
};

export type GameTransitionSuccess = {
  ok: true;
  state: GameState;
};

export type GameTransitionFailure = {
  ok: false;
  reject: GameReject;
};

export type GameTransitionResult = GameTransitionSuccess | GameTransitionFailure;

type InitialGameStateOptions = {
  dealer?: Seat;
  targetScore?: number;
  scores?: TeamScore;
  handNumber?: number;
};

function reject(
  state: GameState,
  action: GameAction["type"],
  code: GameRejectCode,
  message: string
): GameTransitionFailure {
  return {
    ok: false,
    reject: {
      code,
      protocolCode: code,
      message,
      phase: state.phase,
      action
    }
  };
}

function cloneCard(card: Card): Card {
  return { suit: card.suit, rank: card.rank };
}

function cloneCards(cards: readonly Card[]): Card[] {
  return cards.map((card) => cloneCard(card));
}

function cloneHands(hands: HandMap): HandMap {
  return {
    north: cloneCards(hands.north),
    east: cloneCards(hands.east),
    south: cloneCards(hands.south),
    west: cloneCards(hands.west)
  };
}

function teamForSeat(seat: Seat): Team {
  return seat === "north" || seat === "south" ? "teamA" : "teamB";
}

function clearHandState(state: GameState, dealer: Seat): GameState {
  return {
    ...state,
    phase: "deal",
    dealer,
    hands: null,
    upcard: null,
    kitty: null,
    bidding: null,
    trump: null,
    maker: null,
    alone: false,
    partnerSitsOut: null,
    trick: null,
    tricksWon: createTeamScore(),
    lastHand: null,
    winner: null
  };
}

function nextActiveSeat(start: Seat, partnerSitsOut: Seat | null): Seat {
  let candidate = start;

  for (let index = 0; index < SEAT_VALUES.length; index += 1) {
    if (candidate !== partnerSitsOut) {
      return candidate;
    }

    candidate = nextSeat(candidate);
  }

  throw new Error("No active seat available.");
}

function removeCardFromHand(hand: readonly Card[], card: Card): Card[] | null {
  const next: Card[] = [];
  let removed = false;

  for (const entry of hand) {
    if (!removed && entry.suit === card.suit && entry.rank === card.rank) {
      removed = true;
      continue;
    }
    next.push(cloneCard(entry));
  }

  return removed ? next : null;
}

function phaseFromBiddingRound(round: 1 | 2): GamePhase {
  return round === 1 ? "round1_bidding" : "round2_bidding";
}

function mapTrickRejectCodeToGameCode(code: TrickRejectCode): GameRejectCode {
  switch (code) {
    case "NOT_YOUR_TURN":
      return "NOT_YOUR_TURN";
    case "INVALID_STATE":
      return "INVALID_STATE";
    case "CARD_NOT_IN_HAND":
    case "MUST_FOLLOW_SUIT":
      return "INVALID_ACTION";
  }
}

export function createInitialGameState(options: InitialGameStateOptions = {}): GameState {
  const targetScore = options.targetScore ?? 10;
  if (!Number.isInteger(targetScore) || targetScore < 1) {
    throw new Error("targetScore must be a positive integer.");
  }

  return {
    phase: "deal",
    handNumber: options.handNumber ?? 0,
    dealer: options.dealer ?? "north",
    targetScore,
    scores: options.scores ? createTeamScore(options.scores.teamA, options.scores.teamB) : createTeamScore(),
    winner: null,
    hands: null,
    upcard: null,
    kitty: null,
    bidding: null,
    trump: null,
    maker: null,
    alone: false,
    partnerSitsOut: null,
    trick: null,
    tricksWon: createTeamScore(),
    lastHand: null
  };
}

export function applyGameAction(state: GameState, action: GameAction): GameTransitionResult {
  switch (action.type) {
    case "deal_hand": {
      if (state.phase !== "deal") {
        return reject(state, action.type, "INVALID_STATE", "deal_hand is only allowed during deal phase.");
      }

      const sourceDeck = action.deck ? cloneCards(action.deck) : createEuchreDeck();
      try {
        const dealt = dealHandsFromDeck(sourceDeck, state.dealer, action.pattern);
        const bidding = createBiddingState(state.dealer, dealt.upcard.suit);
        return {
          ok: true,
          state: {
            ...state,
            phase: phaseFromBiddingRound(bidding.round),
            handNumber: state.handNumber + 1,
            hands: cloneHands(dealt.hands),
            upcard: cloneCard(dealt.upcard),
            kitty: cloneCards(dealt.kitty),
            bidding,
            trump: null,
            maker: null,
            alone: false,
            partnerSitsOut: null,
            trick: null,
            tricksWon: createTeamScore(),
            lastHand: null,
            winner: null
          }
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to deal hand from provided deck.";
        return reject(state, action.type, "INVALID_ACTION", message);
      }
    }

    case "bidding": {
      if (state.phase !== "round1_bidding" && state.phase !== "round2_bidding") {
        return reject(
          state,
          action.type,
          "INVALID_STATE",
          "bidding actions are only allowed during bidding phases."
        );
      }

      if (!state.bidding) {
        return reject(state, action.type, "INVALID_STATE", "Missing bidding state.");
      }

      const biddingResult = applyBiddingAction(state.bidding, action.action);
      if (!biddingResult.ok) {
        return reject(state, action.type, biddingResult.code, biddingResult.message);
      }

      const nextBidding = biddingResult.state;
      if (nextBidding.status === "active") {
        return {
          ok: true,
          state: {
            ...state,
            phase: phaseFromBiddingRound(nextBidding.round),
            bidding: nextBidding
          }
        };
      }

      if (nextBidding.status === "redeal_required") {
        if (!nextBidding.redealDealer) {
          return reject(state, action.type, "INVALID_STATE", "Redeal state is missing next dealer.");
        }

        return {
          ok: true,
          state: clearHandState(state, nextBidding.redealDealer)
        };
      }

      if (!state.hands) {
        return reject(state, action.type, "INVALID_STATE", "Cannot enter play without dealt hands.");
      }
      if (!nextBidding.trump || !nextBidding.maker) {
        return reject(state, action.type, "INVALID_STATE", "Trump selection is incomplete.");
      }

      const firstLead = nextActiveSeat(nextSeat(state.dealer), nextBidding.partnerSitsOut);
      const trick = createTrickState(firstLead, nextBidding.trump, nextBidding.partnerSitsOut);

      return {
        ok: true,
        state: {
          ...state,
          phase: "play",
          bidding: nextBidding,
          trump: nextBidding.trump,
          maker: nextBidding.maker,
          alone: nextBidding.alone,
          partnerSitsOut: nextBidding.partnerSitsOut,
          trick,
          lastHand: null
        }
      };
    }

    case "play_card": {
      if (state.phase !== "play") {
        return reject(state, action.type, "INVALID_STATE", "play_card is only allowed during play phase.");
      }
      if (!state.trick || !state.hands || !state.trump || !state.maker) {
        return reject(state, action.type, "INVALID_STATE", "Play state is missing required data.");
      }
      if (action.actor === state.partnerSitsOut) {
        return reject(state, action.type, "INVALID_ACTION", "Sitting-out partner cannot play a card.");
      }

      const actorHand = state.hands[action.actor];
      const trickResult = applyTrickAction(state.trick, {
        type: "play_card",
        actor: action.actor,
        card: action.card,
        actorHand
      });
      if (!trickResult.ok) {
        return reject(
          state,
          action.type,
          mapTrickRejectCodeToGameCode(trickResult.code),
          trickResult.message
        );
      }

      const updatedActorHand = removeCardFromHand(actorHand, action.card);
      if (!updatedActorHand) {
        return reject(state, action.type, "INVALID_STATE", "Played card was not found in actor hand.");
      }

      const nextHands = cloneHands(state.hands);
      nextHands[action.actor] = updatedActorHand;

      const nextTrick = trickResult.state;
      if (!nextTrick.complete) {
        return {
          ok: true,
          state: {
            ...state,
            hands: nextHands,
            trick: nextTrick
          }
        };
      }

      const winnerSeat = resolveTrickWinner(nextTrick);
      const nextTricksWon = createTeamScore(state.tricksWon.teamA, state.tricksWon.teamB);
      const winnerTeam = teamForSeat(winnerSeat);
      nextTricksWon[winnerTeam] += 1;

      const totalTricks = nextTricksWon.teamA + nextTricksWon.teamB;
      if (totalTricks < 5) {
        return {
          ok: true,
          state: {
            ...state,
            hands: nextHands,
            trick: createTrickState(winnerSeat, state.trump, state.partnerSitsOut),
            tricksWon: nextTricksWon
          }
        };
      }

      const makerTeam = teamForSeat(state.maker);
      const handResult = scoreHand({
        makers: makerTeam,
        makerTricks: nextTricksWon[makerTeam],
        alone: state.alone
      });

      return {
        ok: true,
        state: {
          ...state,
          phase: "score",
          hands: nextHands,
          trick: nextTrick,
          tricksWon: nextTricksWon,
          lastHand: handResult
        }
      };
    }

    case "score_hand": {
      if (state.phase !== "score") {
        return reject(state, action.type, "INVALID_STATE", "score_hand is only allowed during score phase.");
      }
      if (!state.lastHand) {
        return reject(state, action.type, "INVALID_STATE", "No hand result available for scoring.");
      }

      const nextScores = applyHandScore(state.scores, state.lastHand);
      if (isGameOver(nextScores, state.targetScore)) {
        return {
          ok: true,
          state: {
            ...state,
            phase: "completed",
            scores: nextScores,
            winner: winningTeam(nextScores, state.targetScore)
          }
        };
      }

      const nextDealer = rotateDealer(state.dealer);
      return {
        ok: true,
        state: {
          ...clearHandState(state, nextDealer),
          scores: nextScores
        }
      };
    }
  }
}
