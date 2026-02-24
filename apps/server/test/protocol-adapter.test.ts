import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvent,
  type GamePlayCardEvent
} from "@fun-euchre/protocol";
import {
  applyGameAction,
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
  assert.deepEqual(gameEvent, {
    version: PROTOCOL_VERSION,
    type: "game.state",
    payload: {
      gameId: "game-1",
      handNumber: 1,
      trickNumber: 0,
      dealer: "north",
      turn: "north",
      trump: "hearts",
      scores: { teamA: 0, teamB: 0 }
    }
  });

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
  assert.deepEqual(projected, {
    version: PROTOCOL_VERSION,
    type: "game.state",
    payload: {
      gameId: "game-1",
      handNumber: 1,
      trickNumber: 0,
      dealer: "north",
      turn: "east",
      trump: state.trump,
      scores: { teamA: 0, teamB: 0 }
    }
  });
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
  assert.deepEqual(result.outbound, [
    {
      version: PROTOCOL_VERSION,
      type: "game.state",
      payload: {
        gameId: "game-1",
        handNumber: 1,
        trickNumber: 1,
        dealer: "north",
        turn: "east",
        trump: "hearts",
        scores: { teamA: 0, teamB: 0 }
      }
    }
  ]);
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
