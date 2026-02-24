import assert from "node:assert/strict";
import test from "node:test";
import type { RejectCode } from "@fun-euchre/protocol";
import {
  applyGameAction,
  createEuchreDeck,
  createInitialGameState,
  createTeamScore,
  createTrickState,
  type Card,
  type GameRejectCode,
  type GameState
} from "../src/index.js";

const PROTOCOL_REJECT_CODES = new Set<RejectCode>([
  "NOT_YOUR_TURN",
  "INVALID_ACTION",
  "INVALID_STATE",
  "UNAUTHORIZED"
]);

type GameCodesMustBeProtocolCodes = GameRejectCode extends RejectCode ? true : false;
const GAME_CODES_COMPATIBLE: GameCodesMustBeProtocolCodes = true;
void GAME_CODES_COMPATIBLE;

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function rejectCodeOf(result: ReturnType<typeof applyGameAction>): GameRejectCode {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected rejected result.");
  }

  return result.reject.code;
}

function buildPlayStateForMappingTests(): GameState {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 1
  });

  return {
    ...base,
    phase: "play",
    hands: {
      north: [card("clubs", "9")],
      east: [card("clubs", "A"), card("hearts", "K")],
      south: [card("spades", "9")],
      west: [card("diamonds", "9")]
    },
    upcard: card("hearts", "10"),
    kitty: [card("clubs", "10"), card("clubs", "J"), card("clubs", "Q")],
    bidding: null,
    trump: "hearts",
    maker: "north",
    alone: false,
    partnerSitsOut: null,
    trick: createTrickState("north", "hearts"),
    tricksWon: createTeamScore(),
    lastHand: null,
    winner: null
  };
}

test("game reject codes are a subset of protocol reject codes", () => {
  const produced: GameRejectCode[] = [];

  // INVALID_STATE
  produced.push(
    rejectCodeOf(
      applyGameAction(createInitialGameState({ dealer: "north" }), {
        type: "score_hand"
      })
    )
  );

  // NOT_YOUR_TURN
  let biddingState = createInitialGameState({ dealer: "north" });
  const dealt = applyGameAction(biddingState, { type: "deal_hand", deck: createEuchreDeck() });
  if (!dealt.ok) {
    throw new Error("Expected deal_hand to succeed in protocol compatibility setup.");
  }
  biddingState = dealt.state;
  produced.push(
    rejectCodeOf(
      applyGameAction(biddingState, {
        type: "bidding",
        action: { type: "pass", actor: "south" }
      })
    )
  );

  // INVALID_ACTION (round mismatch)
  produced.push(
    rejectCodeOf(
      applyGameAction(biddingState, {
        type: "bidding",
        action: { type: "call_trump", actor: "east", trump: "hearts" }
      })
    )
  );

  for (const code of produced) {
    assert.equal(PROTOCOL_REJECT_CODES.has(code), true);
  }
});

test("trick-level rejects map cleanly to INVALID_ACTION at game layer", () => {
  let playState = buildPlayStateForMappingTests();

  // First, establish lead suit as clubs by a legal play.
  const first = applyGameAction(playState, {
    type: "play_card",
    actor: "north",
    card: card("clubs", "9")
  });
  if (!first.ok) {
    throw new Error("Expected opening play to succeed in trick mapping setup.");
  }
  playState = first.state;

  // CARD_NOT_IN_HAND should map to INVALID_ACTION.
  const missingCard = applyGameAction(playState, {
    type: "play_card",
    actor: "east",
    card: card("spades", "A")
  });
  assert.equal(missingCard.ok, false);
  if (missingCard.ok) {
    throw new Error("Expected missing-card reject.");
  }
  assert.equal(missingCard.reject.code, "INVALID_ACTION");
  assert.equal(missingCard.reject.protocolCode, "INVALID_ACTION");

  // MUST_FOLLOW_SUIT should also map to INVALID_ACTION.
  const revoke = applyGameAction(playState, {
    type: "play_card",
    actor: "east",
    card: card("hearts", "K")
  });
  assert.equal(revoke.ok, false);
  if (revoke.ok) {
    throw new Error("Expected follow-suit reject.");
  }
  assert.equal(revoke.reject.code, "INVALID_ACTION");
  assert.equal(revoke.reject.protocolCode, "INVALID_ACTION");
});
