import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  type GamePrivateStateEvent,
  type GamePlayCardEvent,
  type Seat,
  type GameStateEvent,
  type ServerToClientEvent
} from "@fun-euchre/protocol";
import {
  applyGameAction,
  createInitialGameState,
  createTeamScore,
  createTrickState,
  type Card,
  type GameState
} from "@fun-euchre/game-rules";
import { GameManager } from "../../src/domain/gameManager.js";
import { InMemoryGameStore } from "../../src/domain/gameStore.js";
import {
  createLobbyState,
  joinLobby,
  startLobbyGame,
  type LobbyState,
  type LobbyTransitionResult
} from "../../src/domain/lobby.js";
import { InMemoryLobbyStore } from "../../src/domain/lobbyStore.js";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow,
  parseSessionIdOrThrow
} from "../../src/domain/ids.js";
import { toGameStateEvent, toLobbyStateEvent } from "../../src/domain/protocolAdapter.js";
import { InMemorySocketServer } from "../../src/realtime/socketServer.js";
import type { SessionId } from "../../src/domain/types.js";

type Collector = {
  sessionId: SessionId;
  events: ServerToClientEvent[];
  send: (event: ServerToClientEvent) => void;
};

function createCollector(sessionId: SessionId): Collector {
  const events: ServerToClientEvent[] = [];
  return {
    sessionId,
    events,
    send: (event) => {
      events.push(event);
    }
  };
}

function expectLobbySuccess(result: LobbyTransitionResult): LobbyState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  return result.state;
}

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function buildNearCompletionPlayState(): GameState {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 7,
    targetScore: 10,
    scores: createTeamScore(9, 0)
  });

  return {
    ...base,
    phase: "play",
    hands: {
      north: [card("hearts", "A")],
      east: [card("clubs", "9")],
      south: [card("spades", "9")],
      west: [card("diamonds", "9")]
    },
    upcard: null,
    kitty: null,
    bidding: null,
    trump: "hearts",
    maker: "north",
    alone: false,
    partnerSitsOut: null,
    trick: createTrickState("north", "hearts"),
    tricksWon: createTeamScore(4, 0),
    lastHand: null,
    winner: null
  };
}

function gameStateEvents(events: readonly ServerToClientEvent[]): GameStateEvent[] {
  return events.filter((event): event is GameStateEvent => event.type === "game.state");
}

function privateStateEventForSeat(
  input: {
    privateOutboundBySeat: Partial<Record<Seat, ServerToClientEvent[]>>;
  },
  seat: Seat
): GamePrivateStateEvent {
  const events = input.privateOutboundBySeat[seat];
  if (!events || events.length !== 1) {
    throw new Error(`Expected one private outbound event for seat "${seat}".`);
  }

  const event = events[0];
  if (!event || event.type !== "game.private_state") {
    throw new Error(`Expected game.private_state event for seat "${seat}".`);
  }

  return event;
}

function expectedHandSize(state: GameState, seat: Seat): number {
  if (!state.hands) {
    return 0;
  }

  return state.hands[seat].length;
}

function playCardEvent(
  requestId: string,
  gameId: string,
  actorSeat: "north" | "east" | "south" | "west",
  cardId: string
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

async function publishLobbyState(socketServer: InMemorySocketServer, state: LobbyState): Promise<void> {
  const result = await socketServer.broadcastLobbyEvents(state.lobbyId, [toLobbyStateEvent(state)]);
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
}

async function publishGameEvents(
  socketServer: InMemorySocketServer,
  gameId: string,
  events: readonly ServerToClientEvent[]
): Promise<void> {
  const result = await socketServer.broadcastGameEvents(parseGameIdOrThrow(gameId), events);
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
}

test("gameplay lifecycle validates actions server-side and keeps ordered game.state parity", async () => {
  const lobbyId = parseLobbyIdOrThrow("integration-lobby-2");
  const gameId = parseGameIdOrThrow("integration-game-1");
  const hostPlayerId = parsePlayerIdOrThrow("integration-player-11");
  const eastPlayerId = parsePlayerIdOrThrow("integration-player-12");
  const southPlayerId = parsePlayerIdOrThrow("integration-player-13");
  const westPlayerId = parsePlayerIdOrThrow("integration-player-14");
  const hostSessionId = parseSessionIdOrThrow("integration-session-11");
  const eastSessionId = parseSessionIdOrThrow("integration-session-12");
  const southSessionId = parseSessionIdOrThrow("integration-session-13");
  const westSessionId = parseSessionIdOrThrow("integration-session-14");

  const hostCollector = createCollector(hostSessionId);
  const eastCollector = createCollector(eastSessionId);
  const southCollector = createCollector(southSessionId);
  const westCollector = createCollector(westSessionId);
  const collectors = [hostCollector, eastCollector, southCollector, westCollector] as const;

  const socketServer = new InMemorySocketServer();
  for (const collector of collectors) {
    socketServer.connectSession({
      sessionId: collector.sessionId,
      send: collector.send
    });
  }

  const lobbyStore = new InMemoryLobbyStore();
  let lobby = createLobbyState({
    lobbyId,
    hostPlayerId,
    hostDisplayName: "Host"
  });
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(hostSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: eastPlayerId,
      displayName: "East"
    })
  );
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(eastSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: southPlayerId,
      displayName: "South"
    })
  );
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(southSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: westPlayerId,
      displayName: "West"
    })
  );
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(westSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    startLobbyGame(lobby, {
      actorPlayerId: hostPlayerId
    })
  );
  lobbyStore.upsert({ state: lobby });
  await publishLobbyState(socketServer, lobby);

  const gameStore = new InMemoryGameStore();
  const seededState = buildNearCompletionPlayState();
  gameStore.upsert({
    gameId,
    lobbyId,
    state: seededState
  });

  const gameManager = new GameManager({
    gameStore
  });

  for (const collector of collectors) {
    assert.equal(socketServer.bindSessionToGame(collector.sessionId, gameId), true);
  }
  await publishGameEvents(socketServer, gameId, [toGameStateEvent(gameId, seededState)]);

  const invalidTurn = await gameManager.submitEvent(
    gameId,
    playCardEvent("req-invalid-turn", gameId, "east", "clubs:9")
  );
  assert.equal(invalidTurn.persisted, false);
  assert.equal(
    invalidTurn.outbound.some((event) => event.type === "game.private_state"),
    false
  );
  assert.deepEqual(invalidTurn.outbound, [
    {
      version: PROTOCOL_VERSION,
      type: "action.rejected",
      payload: {
        requestId: "req-invalid-turn",
        code: "NOT_YOUR_TURN",
        message: "Action actor does not match current trick turn."
      }
    }
  ]);
  assert.deepEqual(
    privateStateEventForSeat(invalidTurn, "north").payload.handCardIds,
    ["hearts:A"]
  );
  assert.deepEqual(
    privateStateEventForSeat(invalidTurn, "east").payload.handCardIds,
    ["clubs:9"]
  );

  const afterInvalid = gameStore.getByGameId(gameId);
  assert.ok(afterInvalid);
  assert.deepEqual(afterInvalid.state, seededState);

  const playSequence = [
    playCardEvent("req-play-1", gameId, "north", "hearts:A"),
    playCardEvent("req-play-2", gameId, "east", "clubs:9"),
    playCardEvent("req-play-3", gameId, "south", "spades:9"),
    playCardEvent("req-play-4", gameId, "west", "diamonds:9")
  ] as const;

  let latestState = seededState;
  for (const event of playSequence) {
    const submitted = await gameManager.submitEvent(gameId, event);
    assert.equal(submitted.persisted, true);
    assert.equal(submitted.outbound[0]?.type, "game.state");
    assert.equal(
      submitted.outbound.some((outbound) => outbound.type === "game.private_state"),
      false
    );
    if (!submitted.state) {
      throw new Error("Expected state after accepted game.play_card action.");
    }
    latestState = submitted.state;
    for (const seat of ["north", "east", "south", "west"] as const) {
      const privateState = privateStateEventForSeat(submitted, seat);
      assert.equal(privateState.payload.seat, seat);
      assert.equal(
        privateState.payload.handCardIds.length,
        expectedHandSize(submitted.state, seat)
      );
    }
    await publishGameEvents(socketServer, gameId, submitted.outbound);
  }

  assert.equal(latestState.phase, "score");

  const scoreApplied = applyGameAction(latestState, { type: "score_hand" });
  if (!scoreApplied.ok) {
    throw new Error(`${scoreApplied.reject.code}: ${scoreApplied.reject.message}`);
  }
  gameStore.upsert({
    gameId,
    lobbyId,
    state: scoreApplied.state
  });
  await publishGameEvents(socketServer, gameId, [toGameStateEvent(gameId, scoreApplied.state)]);

  assert.equal(scoreApplied.state.phase, "completed");
  assert.equal(scoreApplied.state.winner, "teamA");
  assert.equal(scoreApplied.state.scores.teamA >= scoreApplied.state.targetScore, true);

  const persisted = gameStore.getByGameId(gameId);
  assert.ok(persisted);
  assert.equal(persisted.state.phase, "completed");
  assert.equal(persisted.state.winner, "teamA");

  const referenceGameEvents = gameStateEvents(hostCollector.events);
  assert.equal(referenceGameEvents.length, 6);
  const [initial, afterNorth, afterEast, afterSouth, afterWest, completed] = referenceGameEvents;
  if (!initial || !afterNorth || !afterEast || !afterSouth || !afterWest || !completed) {
    throw new Error("Missing expected game.state sequence entries.");
  }

  assert.equal(initial.payload.trickNumber, 4);
  assert.equal(initial.payload.phase, "play");
  assert.equal(initial.payload.turn, "north");
  assert.equal(afterNorth.payload.turn, "east");
  assert.equal(afterEast.payload.turn, "south");
  assert.equal(afterSouth.payload.turn, "west");
  assert.equal(afterWest.payload.turn, "north");
  assert.equal(afterWest.payload.trickNumber, 5);
  assert.equal(afterWest.payload.phase, "score");
  assert.equal(completed.payload.phase, "completed");
  assert.equal(completed.payload.scores.teamA, 11);
  assert.equal(completed.payload.scores.teamB, 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(initial.payload, "handCardIds"),
    false
  );

  for (const collector of collectors) {
    assert.deepEqual(gameStateEvents(collector.events), referenceGameEvents);
  }
});
