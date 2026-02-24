import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGameAction,
  availableRoundTwoTrumpSuits,
  createBiddingState,
  createEuchreDeck,
  createInitialGameState,
  createTeamScore,
  createTrickState,
  effectiveSuit,
  formatCardId,
  scoreHand,
  type Card,
  type GameAction,
  type GameState
} from "../src/index.js";

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function mustTransition(state: GameState, action: GameAction): GameState {
  const result = applyGameAction(state, action);
  if (!result.ok) {
    throw new Error(
      `${result.reject.code} (${result.reject.phase}/${result.reject.action}): ${result.reject.message}`
    );
  }

  return result.state;
}

function chooseLegalCardForTurn(state: GameState): Card {
  if (state.phase !== "play" || !state.trick || !state.hands || !state.trump) {
    throw new Error("Expected playable game state.");
  }

  const actor = state.trick.turn;
  const hand = state.hands[actor];
  const first = hand[0];
  if (!first) {
    throw new Error(`No cards available for actor ${actor}.`);
  }

  if (state.trick.leadSuit === null) {
    return first;
  }

  for (const entry of hand) {
    if (effectiveSuit(entry, state.trump) === state.trick.leadSuit) {
      return entry;
    }
  }

  return first;
}

function cardIds(cards: readonly Card[]): string[] {
  return cards.map((entry) => formatCardId(entry));
}

test("legal phase transitions: deal -> round1 -> round2 -> play", () => {
  let state = createInitialGameState({ dealer: "north" });
  assert.equal(state.phase, "deal");

  state = mustTransition(state, { type: "deal_hand", deck: createEuchreDeck() });
  assert.equal(state.phase, "round1_bidding");
  assert.equal(state.handNumber, 1);
  assert.equal(state.bidding?.turn, "east");

  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "east" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "south" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "west" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "north" }
  });

  assert.equal(state.phase, "round2_bidding");
  assert.equal(state.bidding?.turn, "east");

  state = mustTransition(state, {
    type: "bidding",
    action: { type: "call_trump", actor: "east", trump: "hearts" }
  });

  assert.equal(state.phase, "play");
  assert.equal(state.trump, "hearts");
  assert.equal(state.maker, "east");
  assert.equal(state.trick?.turn, "east");
});

test("round-1 order_up performs dealer upcard exchange before entering play", () => {
  const state: GameState = {
    ...createInitialGameState({ dealer: "north", handNumber: 1 }),
    phase: "round1_bidding",
    hands: {
      north: [
        card("clubs", "9"),
        card("clubs", "10"),
        card("hearts", "Q"),
        card("spades", "A"),
        card("diamonds", "K")
      ],
      east: [
        card("hearts", "A"),
        card("diamonds", "A"),
        card("clubs", "A"),
        card("spades", "K"),
        card("spades", "Q")
      ],
      south: [
        card("hearts", "10"),
        card("hearts", "J"),
        card("diamonds", "Q"),
        card("clubs", "Q"),
        card("spades", "10")
      ],
      west: [
        card("diamonds", "9"),
        card("diamonds", "J"),
        card("clubs", "K"),
        card("spades", "J"),
        card("hearts", "K")
      ]
    },
    upcard: card("hearts", "9"),
    kitty: [card("diamonds", "10"), card("clubs", "J"), card("spades", "9")],
    bidding: createBiddingState("north", "hearts"),
    trump: null,
    maker: null,
    alone: false,
    partnerSitsOut: null,
    trick: null,
    tricksWon: createTeamScore(),
    lastHand: null,
    winner: null
  };

  const next = mustTransition(state, {
    type: "bidding",
    action: { type: "order_up", actor: "east" }
  });

  assert.equal(next.phase, "play");
  assert.equal(next.bidding?.dealerExchangeRequired, false);
  assert.equal(next.upcard, null);

  assert.deepEqual(cardIds(next.hands?.north ?? []).sort(), [
    "clubs:10",
    "diamonds:K",
    "hearts:9",
    "hearts:Q",
    "spades:A"
  ]);
  assert.deepEqual(cardIds(next.kitty ?? []).sort(), [
    "clubs:9",
    "clubs:J",
    "diamonds:10",
    "spades:9"
  ]);

  const seen = new Set<string>();
  for (const seat of ["north", "east", "south", "west"] as const) {
    for (const id of cardIds(next.hands?.[seat] ?? [])) {
      assert.equal(seen.has(id), false);
      seen.add(id);
    }
  }
  for (const id of cardIds(next.kitty ?? [])) {
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
  assert.equal(seen.size, 24);
});

test("round-2 trump selection turns down upcard into kitty for card conservation", () => {
  let state = createInitialGameState({ dealer: "north" });
  state = mustTransition(state, { type: "deal_hand", deck: createEuchreDeck() });

  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "east" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "south" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "west" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "north" }
  });
  if (!state.bidding || !state.upcard) {
    throw new Error("Expected round-2 bidding state with upcard.");
  }
  const turnedDownUpcard = formatCardId(state.upcard);
  const trump = availableRoundTwoTrumpSuits(state.bidding)[0];
  if (!trump) {
    throw new Error("Expected available round-two trump option.");
  }

  state = mustTransition(state, {
    type: "bidding",
    action: { type: "call_trump", actor: state.bidding.turn, trump }
  });

  assert.equal(state.phase, "play");
  assert.equal(state.upcard, null);
  assert.equal((state.kitty ?? []).length, 4);
  assert.equal((state.kitty ?? []).some((entry) => formatCardId(entry) === turnedDownUpcard), true);
});

test("invalid phase transitions are rejected deterministically", () => {
  const initial = createInitialGameState({ dealer: "north" });

  const invalidPlay = applyGameAction(initial, {
    type: "play_card",
    actor: "north",
    card: card("clubs", "9")
  });
  assert.equal(invalidPlay.ok, false);
  if (invalidPlay.ok) {
    throw new Error("Expected invalid play transition rejection.");
  }
  assert.equal(invalidPlay.reject.code, "INVALID_STATE");
  assert.equal(invalidPlay.reject.protocolCode, "INVALID_STATE");
  assert.equal(invalidPlay.reject.phase, "deal");
  assert.equal(invalidPlay.reject.action, "play_card");

  const biddingState = mustTransition(initial, { type: "deal_hand", deck: createEuchreDeck() });
  const invalidScore = applyGameAction(biddingState, { type: "score_hand" });
  assert.equal(invalidScore.ok, false);
  if (invalidScore.ok) {
    throw new Error("Expected invalid score transition rejection.");
  }
  assert.equal(invalidScore.reject.code, "INVALID_STATE");
  assert.equal(invalidScore.reject.phase, "round1_bidding");
});

test("play phase transitions into score phase after fifth trick", () => {
  const state = createInitialGameState({
    dealer: "north",
    handNumber: 1,
    scores: createTeamScore(0, 0)
  });

  let playState: GameState = {
    ...state,
    phase: "play",
    hands: {
      north: [card("clubs", "9")],
      east: [card("clubs", "A")],
      south: [card("hearts", "10")],
      west: [card("hearts", "J")]
    },
    trump: "hearts",
    maker: "north",
    alone: false,
    partnerSitsOut: null,
    trick: createTrickState("north", "hearts"),
    tricksWon: createTeamScore(4, 0),
    bidding: null,
    upcard: card("hearts", "9"),
    kitty: [card("spades", "A"), card("spades", "K"), card("spades", "Q")],
    winner: null,
    lastHand: null
  };

  playState = mustTransition(playState, {
    type: "play_card",
    actor: "north",
    card: card("clubs", "9")
  });
  playState = mustTransition(playState, {
    type: "play_card",
    actor: "east",
    card: card("clubs", "A")
  });
  playState = mustTransition(playState, {
    type: "play_card",
    actor: "south",
    card: card("hearts", "10")
  });
  playState = mustTransition(playState, {
    type: "play_card",
    actor: "west",
    card: card("hearts", "J")
  });

  assert.equal(playState.phase, "score");
  assert.equal(playState.lastHand?.makerPoints, 1);
  assert.equal(playState.lastHand?.defenderPoints, 0);
  assert.deepEqual(playState.lastHand?.points, { teamA: 1, teamB: 0 });
});

test("score phase transitions to deal (or completed) through score_hand", () => {
  const inProgress = createInitialGameState({
    dealer: "north",
    scores: createTeamScore(0, 0),
    handNumber: 1
  });

  const scoringState: GameState = {
    ...inProgress,
    phase: "score",
    lastHand: scoreHand({
      makers: "teamA",
      makerTricks: 3,
      alone: false
    }),
    hands: null,
    upcard: null,
    kitty: null,
    bidding: null,
    trump: "hearts",
    maker: "north",
    trick: null,
    tricksWon: createTeamScore(3, 2)
  };

  const nextHand = mustTransition(scoringState, { type: "score_hand" });
  assert.equal(nextHand.phase, "deal");
  assert.equal(nextHand.dealer, "east");
  assert.deepEqual(nextHand.scores, { teamA: 1, teamB: 0 });

  const nearWin: GameState = {
    ...scoringState,
    dealer: "west",
    scores: createTeamScore(9, 8),
    lastHand: scoreHand({
      makers: "teamA",
      makerTricks: 3,
      alone: false
    })
  };

  const completed = mustTransition(nearWin, { type: "score_hand" });
  assert.equal(completed.phase, "completed");
  assert.equal(completed.winner, "teamA");
  assert.deepEqual(completed.scores, { teamA: 10, teamB: 8 });
});

test("all-pass bidding through round 2 redeals with next dealer", () => {
  let state = createInitialGameState({ dealer: "north" });
  state = mustTransition(state, { type: "deal_hand", deck: createEuchreDeck() });

  while (state.phase === "round1_bidding" || state.phase === "round2_bidding") {
    if (!state.bidding) {
      throw new Error("Missing bidding state while resolving all-pass flow.");
    }

    state = mustTransition(state, {
      type: "bidding",
      action: {
        type: "pass",
        actor: state.bidding.turn
      }
    });
  }

  assert.equal(state.phase, "deal");
  assert.equal(state.dealer, "east");
  assert.equal(state.hands, null);
  assert.equal(state.bidding, null);
});

test("alone-hand play skips sitting-out partner and completes with 15 plays", () => {
  let state = createInitialGameState({ dealer: "north" });
  state = mustTransition(state, { type: "deal_hand", deck: createEuchreDeck() });

  state = mustTransition(state, {
    type: "bidding",
    action: {
      type: "order_up",
      actor: "east",
      alone: true
    }
  });

  assert.equal(state.phase, "play");
  assert.equal(state.partnerSitsOut, "west");
  assert.equal(state.trick?.turn, "east");

  const sittingOut = state.partnerSitsOut;
  if (!sittingOut || !state.hands) {
    throw new Error("Expected partner sit-out setup.");
  }

  const blocked = applyGameAction(state, {
    type: "play_card",
    actor: sittingOut,
    card: state.hands[sittingOut][0] ?? card("clubs", "9")
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) {
    throw new Error("Expected sitting-out partner play rejection.");
  }
  assert.equal(blocked.reject.code, "INVALID_ACTION");

  let playActions = 0;
  while (state.phase === "play") {
    const actor = state.trick?.turn;
    if (!actor) {
      throw new Error("Missing trick actor in play phase.");
    }
    assert.notEqual(actor, sittingOut);

    state = mustTransition(state, {
      type: "play_card",
      actor,
      card: chooseLegalCardForTurn(state)
    });

    playActions += 1;
    if (playActions > 20) {
      throw new Error("Unexpected play loop while validating alone-hand flow.");
    }
  }

  assert.equal(playActions, 15);
  assert.equal(state.phase, "score");
  assert.equal(state.tricksWon.teamA + state.tricksWon.teamB, 5);
});

test("opening leader skips dealer-left seat when that partner sits out", () => {
  let state = createInitialGameState({ dealer: "north" });
  state = mustTransition(state, { type: "deal_hand", deck: createEuchreDeck() });

  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "east" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "pass", actor: "south" }
  });
  state = mustTransition(state, {
    type: "bidding",
    action: { type: "order_up", actor: "west", alone: true }
  });

  assert.equal(state.phase, "play");
  assert.equal(state.partnerSitsOut, "east");
  assert.equal(state.trick?.turn, "south");
});
