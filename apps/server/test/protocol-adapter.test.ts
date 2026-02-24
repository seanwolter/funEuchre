import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvent,
  type GamePlayCardEvent
} from "@fun-euchre/protocol";
import {
  applyGameAction,
  availableRoundTwoTrumpSuits,
  createEuchreDeck,
  createInitialGameState,
  createTeamScore,
  createTrickState,
  type Card,
  type GameState
} from "@fun-euchre/game-rules";
import {
  applyProtocolEventToGameState,
  mapDomainRejectCodeToProtocolCode,
  toActionRejectedFromDomainFailure,
  toDomainCommand,
  toGamePrivateStateEvent,
  toGamePrivateStateEventsBySeat,
  toGamePlayCardAction,
  toGameStateEvent,
  toLobbyStateEvent,
  toSystemNoticeEvent
} from "../src/domain/protocolAdapter.js";
import {
  createLobbyState,
  joinLobby,
  type LobbyState,
  type LobbyTransitionResult
} from "../src/domain/lobby.js";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow
} from "../src/domain/ids.js";

const GAME_ID = parseGameIdOrThrow("game-1");

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function buildPlayState(): GameState {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 1,
    scores: createTeamScore(0, 0)
  });

  return {
    ...base,
    phase: "play",
    hands: {
      north: [card("clubs", "9")],
      east: [card("clubs", "A")],
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

function buildRound1BiddingState(): GameState {
  const dealt = applyGameAction(
    createInitialGameState({
      dealer: "north",
      handNumber: 0,
      scores: createTeamScore(0, 0)
    }),
    {
      type: "deal_hand",
      deck: createEuchreDeck()
    }
  );
  if (!dealt.ok) {
    throw new Error(`${dealt.reject.code}: ${dealt.reject.message}`);
  }
  return dealt.state;
}

function buildRound2BiddingState(): GameState {
  let state = buildRound1BiddingState();
  for (let index = 0; index < 4; index += 1) {
    if (!state.bidding) {
      throw new Error("Expected bidding state while transitioning to round 2.");
    }
    state = mustGameTransition(state, {
      type: "bidding",
      action: {
        type: "pass",
        actor: state.bidding.turn
      }
    });
  }
  return state;
}

function mustGameTransition(
  state: GameState,
  action: Parameters<typeof applyGameAction>[1]
): GameState {
  const result = applyGameAction(state, action);
  if (!result.ok) {
    throw new Error(
      `${result.reject.code} (${result.reject.phase}/${result.reject.action}): ${result.reject.message}`
    );
  }

  return result.state;
}

function playCardEvent(
  requestId: string,
  actorSeat: "north" | "east" | "south" | "west",
  cardId: string,
  gameId = "game-1"
): GamePlayCardEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "game.play_card",
    requestId,
    payload: {
      gameId,
      actorSeat,
      cardId
    }
  };
}

function passEvent(
  requestId: string,
  actorSeat: "north" | "east" | "south" | "west",
  gameId = "game-1"
): ClientToServerEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "game.pass",
    requestId,
    payload: {
      gameId,
      actorSeat
    }
  };
}

function orderUpEvent(
  requestId: string,
  actorSeat: "north" | "east" | "south" | "west",
  gameId = "game-1",
  alone?: boolean
): ClientToServerEvent {
  if (alone === undefined) {
    return {
      version: PROTOCOL_VERSION,
      type: "game.order_up",
      requestId,
      payload: {
        gameId,
        actorSeat
      }
    };
  }

  return {
    version: PROTOCOL_VERSION,
    type: "game.order_up",
    requestId,
    payload: {
      gameId,
      actorSeat,
      alone
    }
  };
}

function callTrumpEvent(
  requestId: string,
  actorSeat: "north" | "east" | "south" | "west",
  trump: "clubs" | "diamonds" | "hearts" | "spades",
  gameId = "game-1",
  alone?: boolean
): ClientToServerEvent {
  if (alone === undefined) {
    return {
      version: PROTOCOL_VERSION,
      type: "game.call_trump",
      requestId,
      payload: {
        gameId,
        actorSeat,
        trump
      }
    };
  }

  return {
    version: PROTOCOL_VERSION,
    type: "game.call_trump",
    requestId,
    payload: {
      gameId,
      actorSeat,
      trump,
      alone
    }
  };
}

function expectLobbySuccess(result: LobbyTransitionResult): LobbyState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.state;
}

function buildLobbyState(): LobbyState {
  let state = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });
  state = expectLobbySuccess(
    joinLobby(state, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );
  return state;
}

test("toDomainCommand maps lobby.create to a domain command", () => {
  const event: ClientToServerEvent = {
    version: PROTOCOL_VERSION,
    type: "lobby.create",
    requestId: "req-create",
    payload: { displayName: "Host" }
  };

  const mapped = toDomainCommand(event);
  if (!mapped.ok) {
    throw new Error(`${mapped.reject.code}: ${mapped.reject.message}`);
  }

  assert.deepEqual(mapped.data, {
    kind: "lobby.create",
    requestId: "req-create",
    displayName: "Host"
  });
});

test("toDomainCommand maps lobby.join and normalizes optional reconnectToken", () => {
  const withToken: ClientToServerEvent = {
    version: PROTOCOL_VERSION,
    type: "lobby.join",
    requestId: "req-join-1",
    payload: {
      lobbyId: "lobby-1",
      displayName: "Player",
      reconnectToken: "token-1"
    }
  };
  const withTokenMapped = toDomainCommand(withToken);
  if (!withTokenMapped.ok) {
    throw new Error(`${withTokenMapped.reject.code}: ${withTokenMapped.reject.message}`);
  }
  if (withTokenMapped.data.kind !== "lobby.join") {
    throw new Error(`Expected lobby.join command, received ${withTokenMapped.data.kind}.`);
  }
  assert.equal(withTokenMapped.data.lobbyId, "lobby-1");
  assert.equal(withTokenMapped.data.displayName, "Player");
  assert.equal(withTokenMapped.data.reconnectToken, "token-1");

  const withoutToken: ClientToServerEvent = {
    version: PROTOCOL_VERSION,
    type: "lobby.join",
    requestId: "req-join-2",
    payload: {
      lobbyId: "lobby-1",
      displayName: "Player 2"
    }
  };
  const withoutTokenMapped = toDomainCommand(withoutToken);
  if (!withoutTokenMapped.ok) {
    throw new Error(`${withoutTokenMapped.reject.code}: ${withoutTokenMapped.reject.message}`);
  }
  if (withoutTokenMapped.data.kind !== "lobby.join") {
    throw new Error(`Expected lobby.join command, received ${withoutTokenMapped.data.kind}.`);
  }
  assert.equal(withoutTokenMapped.data.reconnectToken, null);
});

test("toDomainCommand maps lobby.update_name and lobby.start to domain commands", () => {
  const updateName: ClientToServerEvent = {
    version: PROTOCOL_VERSION,
    type: "lobby.update_name",
    requestId: "req-update",
    payload: {
      lobbyId: "lobby-1",
      playerId: "player-2",
      displayName: "Updated"
    }
  };
  const updateMapped = toDomainCommand(updateName);
  if (!updateMapped.ok) {
    throw new Error(`${updateMapped.reject.code}: ${updateMapped.reject.message}`);
  }
  assert.deepEqual(updateMapped.data, {
    kind: "lobby.update_name",
    requestId: "req-update",
    lobbyId: "lobby-1",
    playerId: "player-2",
    displayName: "Updated"
  });

  const start: ClientToServerEvent = {
    version: PROTOCOL_VERSION,
    type: "lobby.start",
    requestId: "req-start",
    payload: {
      lobbyId: "lobby-1",
      actorPlayerId: "player-1"
    }
  };
  const startMapped = toDomainCommand(start);
  if (!startMapped.ok) {
    throw new Error(`${startMapped.reject.code}: ${startMapped.reject.message}`);
  }
  assert.deepEqual(startMapped.data, {
    kind: "lobby.start",
    requestId: "req-start",
    lobbyId: "lobby-1",
    actorPlayerId: "player-1"
  });
});

test("toDomainCommand maps game.play_card to a parsed play action", () => {
  const mapped = toDomainCommand(playCardEvent("req-play", "north", "clubs:9"));
  if (!mapped.ok) {
    throw new Error(`${mapped.reject.code}: ${mapped.reject.message}`);
  }

  assert.deepEqual(mapped.data, {
    kind: "game.play_card",
    requestId: "req-play",
    gameId: "game-1",
    action: {
      type: "play_card",
      actor: "north",
      card: { suit: "clubs", rank: "9" }
    }
  });
});

test("toDomainCommand maps bidding intent events to bidding game actions", () => {
  const passMapped = toDomainCommand(passEvent("req-pass", "east"));
  if (!passMapped.ok) {
    throw new Error(`${passMapped.reject.code}: ${passMapped.reject.message}`);
  }
  assert.deepEqual(passMapped.data, {
    kind: "game.pass",
    requestId: "req-pass",
    gameId: "game-1",
    action: {
      type: "bidding",
      action: {
        type: "pass",
        actor: "east"
      }
    }
  });

  const orderUpMapped = toDomainCommand(orderUpEvent("req-order-up", "south", "game-1", true));
  if (!orderUpMapped.ok) {
    throw new Error(`${orderUpMapped.reject.code}: ${orderUpMapped.reject.message}`);
  }
  assert.deepEqual(orderUpMapped.data, {
    kind: "game.order_up",
    requestId: "req-order-up",
    gameId: "game-1",
    action: {
      type: "bidding",
      action: {
        type: "order_up",
        actor: "south",
        alone: true
      }
    }
  });

  const callTrumpMapped = toDomainCommand(
    callTrumpEvent("req-call-trump", "west", "spades", "game-1", false)
  );
  if (!callTrumpMapped.ok) {
    throw new Error(`${callTrumpMapped.reject.code}: ${callTrumpMapped.reject.message}`);
  }
  assert.deepEqual(callTrumpMapped.data, {
    kind: "game.call_trump",
    requestId: "req-call-trump",
    gameId: "game-1",
    action: {
      type: "bidding",
      action: {
        type: "call_trump",
        actor: "west",
        trump: "spades",
        alone: false
      }
    }
  });
});

test("toDomainCommand rejects malformed ids/card values for supported events", () => {
  const badLobbyId = toDomainCommand({
    ...({
      version: PROTOCOL_VERSION,
      type: "lobby.join",
      requestId: "req-bad-lobby",
      payload: {
        lobbyId: "bad lobby id",
        displayName: "Player"
      }
    } as const)
  } as unknown as ClientToServerEvent);
  assert.equal(badLobbyId.ok, false);
  if (badLobbyId.ok) {
    throw new Error("Expected lobby id rejection.");
  }
  assert.equal(badLobbyId.reject.code, "INVALID_ACTION");

  const badReconnectToken = toDomainCommand({
    ...({
      version: PROTOCOL_VERSION,
      type: "lobby.join",
      requestId: "req-bad-token",
      payload: {
        lobbyId: "lobby-1",
        displayName: "Player",
        reconnectToken: "bad token"
      }
    } as const)
  } as unknown as ClientToServerEvent);
  assert.equal(badReconnectToken.ok, false);
  if (badReconnectToken.ok) {
    throw new Error("Expected reconnect token rejection.");
  }
  assert.equal(badReconnectToken.reject.code, "INVALID_ACTION");

  const badCard = toDomainCommand(
    playCardEvent("req-bad-card", "north", "clubs-9") as unknown as ClientToServerEvent
  );
  assert.equal(badCard.ok, false);
  if (badCard.ok) {
    throw new Error("Expected card-id rejection.");
  }
  assert.equal(badCard.reject.code, "INVALID_ACTION");

  const badTrump = toDomainCommand({
    version: PROTOCOL_VERSION,
    type: "game.call_trump",
    requestId: "req-bad-trump",
    payload: {
      gameId: "game-1",
      actorSeat: "north",
      trump: "invalid-suit"
    }
  } as unknown as ClientToServerEvent);
  assert.equal(badTrump.ok, false);
  if (badTrump.ok) {
    throw new Error("Expected call-trump rejection.");
  }
  assert.equal(badTrump.reject.code, "INVALID_ACTION");
});

test("toGamePlayCardAction rejects wrong game id and returns parsed rules action", () => {
  const wrongGame = toGamePlayCardAction(
    playCardEvent("req-wrong-game", "north", "clubs:9", "game-2"),
    GAME_ID
  );
  assert.equal(wrongGame.ok, false);
  if (wrongGame.ok) {
    throw new Error("Expected wrong-game rejection.");
  }
  assert.equal(wrongGame.reject.code, "INVALID_ACTION");

  const mapped = toGamePlayCardAction(playCardEvent("req-good", "north", "clubs:9"), GAME_ID);
  if (!mapped.ok) {
    throw new Error(`${mapped.reject.code}: ${mapped.reject.message}`);
  }
  assert.deepEqual(mapped.data, {
    type: "play_card",
    actor: "north",
    card: { suit: "clubs", rank: "9" }
  });
});

test("reject code mapping preserves stable protocol taxonomy for all classes", () => {
  const codes = [
    "NOT_YOUR_TURN",
    "INVALID_ACTION",
    "INVALID_STATE",
    "UNAUTHORIZED"
  ] as const;

  for (const code of codes) {
    assert.equal(mapDomainRejectCodeToProtocolCode(code), code);

    const rejected = toActionRejectedFromDomainFailure("req-map", {
      code,
      message: "mapped"
    });
    assert.equal(rejected.type, "action.rejected");
    assert.equal(rejected.payload.code, code);
    assert.equal(rejected.payload.requestId, "req-map");
  }
});

test("projection helpers emit lobby.state, game.state, and system.notice events", () => {
  const lobby = buildLobbyState();
  const lobbyEvent = toLobbyStateEvent(lobby);
  assert.equal(lobbyEvent.version, PROTOCOL_VERSION);
  assert.equal(lobbyEvent.type, "lobby.state");
  assert.equal(lobbyEvent.payload.lobbyId, "lobby-1");
  assert.equal(lobbyEvent.payload.hostPlayerId, "player-1");
  assert.equal(lobbyEvent.payload.seats.length, 4);
  lobbyEvent.payload.seats[0]!.displayName = "Mutated";
  assert.equal(lobby.seats[0]!.displayName, "Host");

  const gameEvent = toGameStateEvent(GAME_ID, buildPlayState());
  assert.equal(gameEvent.version, PROTOCOL_VERSION);
  assert.equal(gameEvent.type, "game.state");
  assert.equal(gameEvent.payload.gameId, "game-1");
  assert.equal(gameEvent.payload.phase, "play");
  assert.equal(gameEvent.payload.handNumber, 1);
  assert.equal(gameEvent.payload.trickNumber, 0);
  assert.equal(gameEvent.payload.dealer, "north");
  assert.equal(gameEvent.payload.turn, "north");
  assert.equal(gameEvent.payload.trump, "hearts");
  assert.equal(gameEvent.payload.maker, "north");
  assert.equal(gameEvent.payload.alone, false);
  assert.equal(gameEvent.payload.partnerSitsOut, null);
  assert.equal(gameEvent.payload.bidding, null);
  assert.equal(gameEvent.payload.trick?.leader, "north");
  assert.equal(gameEvent.payload.trick?.plays.length, 0);
  assert.deepEqual(gameEvent.payload.scores, { teamA: 0, teamB: 0 });

  const notice = toSystemNoticeEvent("warning", "Reconnect window is closing.");
  assert.deepEqual(notice, {
    version: PROTOCOL_VERSION,
    type: "system.notice",
    payload: {
      severity: "warning",
      message: "Reconnect window is closing."
    }
  });
});

test("toGameStateEvent reflects round-1 order_up play entry after dealer exchange", () => {
  let state = createInitialGameState({
    dealer: "north",
    handNumber: 0,
    scores: createTeamScore(0, 0)
  });
  state = mustGameTransition(state, {
    type: "deal_hand",
    deck: createEuchreDeck()
  });
  if (!state.bidding) {
    throw new Error("Expected bidding state after deal.");
  }
  state = mustGameTransition(state, {
    type: "bidding",
    action: {
      type: "order_up",
      actor: state.bidding.turn
    }
  });

  assert.equal(state.phase, "play");
  assert.equal(state.upcard, null);
  assert.equal((state.kitty ?? []).length, 4);

  const projected = toGameStateEvent(GAME_ID, state);
  assert.equal(projected.version, PROTOCOL_VERSION);
  assert.equal(projected.type, "game.state");
  assert.equal(projected.payload.gameId, "game-1");
  assert.equal(projected.payload.phase, "play");
  assert.equal(projected.payload.handNumber, 1);
  assert.equal(projected.payload.trickNumber, 0);
  assert.equal(projected.payload.dealer, "north");
  assert.equal(projected.payload.turn, "east");
  assert.equal(projected.payload.trump, state.trump);
  assert.equal(projected.payload.bidding?.round, 1);
  assert.equal(projected.payload.trick?.leader, "east");
  assert.deepEqual(projected.payload.scores, { teamA: 0, teamB: 0 });
});

test("toGameStateEvent fallback turn skips sitting-out partner", () => {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 2,
    scores: createTeamScore(3, 4)
  });
  const projected = toGameStateEvent(GAME_ID, {
    ...base,
    phase: "play",
    hands: null,
    upcard: null,
    kitty: null,
    bidding: null,
    trump: "hearts",
    maker: "west",
    alone: true,
    partnerSitsOut: "east",
    trick: null,
    tricksWon: createTeamScore(0, 0),
    lastHand: null,
    winner: null
  });

  assert.equal(projected.payload.turn, "south");
});

test("applyProtocolEventToGameState rejects unsupported event types", () => {
  const state = buildPlayState();
  const event: ClientToServerEvent = {
    version: PROTOCOL_VERSION,
    type: "lobby.start",
    requestId: "req-unsupported",
    payload: {
      lobbyId: "lobby-1",
      actorPlayerId: "player-1"
    }
  };

  const result = applyProtocolEventToGameState(GAME_ID, state, event);
  assert.equal(result.state, state);
  assert.deepEqual(result.outbound, [
    {
      version: PROTOCOL_VERSION,
      type: "action.rejected",
      payload: {
        requestId: "req-unsupported",
        code: "INVALID_ACTION",
        message: 'Unsupported event type "lobby.start" for game state transitions.'
      }
    }
  ]);
});

test("applyProtocolEventToGameState applies valid play events and emits game.state", () => {
  const state = buildPlayState();
  const event = playCardEvent("req-apply", "north", "clubs:9");

  const result = applyProtocolEventToGameState(GAME_ID, state, event);
  assert.equal(result.state.phase, "play");
  assert.equal(result.state.hands?.north.length, 0);
  assert.equal(result.state.trick?.turn, "east");
  assert.equal(result.outbound.length, 1);
  const projected = result.outbound[0];
  if (!projected || projected.type !== "game.state") {
    throw new Error("Expected game.state outbound projection.");
  }
  assert.equal(projected.payload.gameId, "game-1");
  assert.equal(projected.payload.phase, "play");
  assert.equal(projected.payload.handNumber, 1);
  assert.equal(projected.payload.trickNumber, 1);
  assert.equal(projected.payload.dealer, "north");
  assert.equal(projected.payload.turn, "east");
  assert.equal(projected.payload.trump, "hearts");
  assert.equal(projected.payload.trick?.plays.length, 1);
  assert.deepEqual(projected.payload.scores, { teamA: 0, teamB: 0 });
});

test("applyProtocolEventToGameState applies bidding pass/order_up/call_trump events", () => {
  const round1 = buildRound1BiddingState();
  if (!round1.bidding) {
    throw new Error("Expected round 1 bidding state.");
  }

  const passed = applyProtocolEventToGameState(
    GAME_ID,
    round1,
    passEvent("req-pass-round1", round1.bidding.turn)
  );
  assert.equal(passed.state.phase, "round1_bidding");
  assert.equal(passed.state.bidding?.turn, "south");
  assert.equal(passed.outbound[0]?.type, "game.state");

  const orderedUp = applyProtocolEventToGameState(
    GAME_ID,
    round1,
    orderUpEvent("req-order-up-round1", round1.bidding.turn)
  );
  assert.equal(orderedUp.state.phase, "play");
  assert.equal(orderedUp.state.trump !== null, true);
  assert.equal(orderedUp.outbound[0]?.type, "game.state");

  const round2 = buildRound2BiddingState();
  if (!round2.bidding) {
    throw new Error("Expected round 2 bidding state.");
  }
  const trump = availableRoundTwoTrumpSuits(round2.bidding)[0];
  if (!trump) {
    throw new Error("Expected available trump suit in round 2.");
  }

  const calledTrump = applyProtocolEventToGameState(
    GAME_ID,
    round2,
    callTrumpEvent("req-call-trump-round2", round2.bidding.turn, trump)
  );
  assert.equal(calledTrump.state.phase, "play");
  assert.equal(calledTrump.state.trump, trump);
  assert.equal(calledTrump.outbound[0]?.type, "game.state");
});

test("private game projection returns only requested seat hand and legal action hints", () => {
  const state = buildPlayState();
  const northPrivate = toGamePrivateStateEvent(GAME_ID, state, "north");
  assert.equal(northPrivate.type, "game.private_state");
  assert.equal(northPrivate.payload.seat, "north");
  assert.deepEqual(northPrivate.payload.handCardIds, ["clubs:9"]);
  assert.deepEqual(northPrivate.payload.legalActions.playableCardIds, ["clubs:9"]);
  assert.equal(northPrivate.payload.legalActions.canPass, false);
  assert.equal(northPrivate.payload.legalActions.canOrderUp, false);
  assert.deepEqual(northPrivate.payload.legalActions.callableTrumpSuits, []);

  const eastPrivate = toGamePrivateStateEvent(GAME_ID, state, "east");
  assert.equal(eastPrivate.payload.seat, "east");
  assert.deepEqual(eastPrivate.payload.handCardIds, ["clubs:A"]);
  assert.deepEqual(eastPrivate.payload.legalActions.playableCardIds, []);

  const bySeat = toGamePrivateStateEventsBySeat(GAME_ID, state);
  assert.equal(bySeat.north.payload.seat, "north");
  assert.equal(bySeat.east.payload.seat, "east");
  assert.equal(bySeat.south.payload.seat, "south");
  assert.equal(bySeat.west.payload.seat, "west");
});

test("applyProtocolEventToGameState maps rules rejects to protocol action.rejected", () => {
  const state = buildPlayState();
  const event = playCardEvent("req-not-turn", "east", "clubs:A");

  const result = applyProtocolEventToGameState(GAME_ID, state, event);
  assert.equal(result.state, state);
  assert.deepEqual(result.outbound, [
    {
      version: PROTOCOL_VERSION,
      type: "action.rejected",
      payload: {
        requestId: "req-not-turn",
        code: "NOT_YOUR_TURN",
        message: "Action actor does not match current trick turn."
      }
    }
  ]);
});
