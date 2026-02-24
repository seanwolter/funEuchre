import assert from "node:assert/strict";
import test from "node:test";
import type { LobbyStateEvent, ServerToClientEvent } from "@fun-euchre/protocol";
import {
  createInitialGameState,
  createTeamScore,
  createTrickState,
  type Card,
  type GameState
} from "@fun-euchre/game-rules";
import {
  MIN_GAME_RETENTION_MS,
  MIN_RECONNECT_GRACE_MS,
  createReconnectPolicy,
  resolveReconnectForfeit
} from "../../src/domain/reconnectPolicy.js";
import {
  createLobbyState,
  joinLobby,
  setLobbyPlayerConnection,
  startLobbyGame,
  type LobbyState,
  type LobbyTransitionResult
} from "../../src/domain/lobby.js";
import { InMemoryLobbyStore } from "../../src/domain/lobbyStore.js";
import { InMemoryGameStore } from "../../src/domain/gameStore.js";
import { InMemorySessionStore } from "../../src/domain/sessionStore.js";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow,
  parseReconnectTokenOrThrow,
  parseSessionIdOrThrow
} from "../../src/domain/ids.js";
import { toLobbyStateEvent } from "../../src/domain/protocolAdapter.js";
import { InMemorySocketServer } from "../../src/realtime/socketServer.js";
import type {
  GameId,
  LobbyId,
  PlayerId,
  ReconnectToken,
  SessionId
} from "../../src/domain/types.js";

type Collector = {
  sessionId: SessionId;
  events: ServerToClientEvent[];
  send: (event: ServerToClientEvent) => void;
};

type Slot = "host" | "east" | "south" | "west";
type SlotMap<T> = Record<Slot, T>;

type Fixture = {
  nowMs: { value: number };
  lobbyId: LobbyId;
  gameId: GameId;
  players: SlotMap<PlayerId>;
  sessions: SlotMap<SessionId>;
  reconnectTokens: SlotMap<ReconnectToken>;
  collectors: SlotMap<Collector>;
  lobbyState: LobbyState;
  lobbyStore: InMemoryLobbyStore;
  gameStore: InMemoryGameStore;
  sessionStore: InMemorySessionStore;
  socketServer: InMemorySocketServer;
  reconnectPolicy: ReturnType<typeof createReconnectPolicy>;
};

const SLOT_VALUES = ["host", "east", "south", "west"] as const;

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

function buildActivePlayState(): GameState {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 3,
    targetScore: 10,
    scores: createTeamScore(3, 2)
  });

  return {
    ...base,
    phase: "play",
    hands: {
      north: [card("clubs", "A")],
      east: [card("diamonds", "A")],
      south: [card("spades", "A")],
      west: [card("hearts", "A")]
    },
    upcard: null,
    kitty: null,
    bidding: null,
    trump: "hearts",
    maker: "north",
    alone: false,
    partnerSitsOut: null,
    trick: createTrickState("north", "hearts"),
    tricksWon: createTeamScore(1, 1),
    lastHand: null,
    winner: null
  };
}

function lobbyStateEvents(events: readonly ServerToClientEvent[]): LobbyStateEvent[] {
  return events.filter((event): event is LobbyStateEvent => event.type === "lobby.state");
}

function requireEastConnected(event: LobbyStateEvent): boolean {
  const east = event.payload.seats.find((seat) => seat.seat === "east");
  if (!east) {
    throw new Error("Expected east seat in lobby.state payload.");
  }
  return east.connected;
}

async function publishLobbyState(socketServer: InMemorySocketServer, state: LobbyState): Promise<void> {
  const result = await socketServer.broadcastLobbyEvents(state.lobbyId, [toLobbyStateEvent(state)]);
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
}

function createFixture(): Fixture {
  const nowMs = { value: 1_000_000 };
  const clock = (): number => nowMs.value;

  const lobbyStore = new InMemoryLobbyStore({ clock });
  const gameStore = new InMemoryGameStore({ clock });
  const sessionStore = new InMemorySessionStore({
    clock,
    reconnectWindowMs: MIN_RECONNECT_GRACE_MS
  });
  const reconnectPolicy = createReconnectPolicy({
    reconnectGraceMs: MIN_RECONNECT_GRACE_MS,
    gameRetentionMs: MIN_GAME_RETENTION_MS
  });
  const socketServer = new InMemorySocketServer();

  const lobbyId = parseLobbyIdOrThrow("integration-lobby-3");
  const gameId = parseGameIdOrThrow("integration-game-3");
  const players: SlotMap<PlayerId> = {
    host: parsePlayerIdOrThrow("integration-player-21"),
    east: parsePlayerIdOrThrow("integration-player-22"),
    south: parsePlayerIdOrThrow("integration-player-23"),
    west: parsePlayerIdOrThrow("integration-player-24")
  };
  const sessions: SlotMap<SessionId> = {
    host: parseSessionIdOrThrow("integration-session-21"),
    east: parseSessionIdOrThrow("integration-session-22"),
    south: parseSessionIdOrThrow("integration-session-23"),
    west: parseSessionIdOrThrow("integration-session-24")
  };
  const reconnectTokens: SlotMap<ReconnectToken> = {
    host: parseReconnectTokenOrThrow("integration-reconnect-21"),
    east: parseReconnectTokenOrThrow("integration-reconnect-22"),
    south: parseReconnectTokenOrThrow("integration-reconnect-23"),
    west: parseReconnectTokenOrThrow("integration-reconnect-24")
  };
  const collectors: SlotMap<Collector> = {
    host: createCollector(sessions.host),
    east: createCollector(sessions.east),
    south: createCollector(sessions.south),
    west: createCollector(sessions.west)
  };

  for (const slot of SLOT_VALUES) {
    const collector = collectors[slot];
    socketServer.connectSession({
      sessionId: collector.sessionId,
      send: collector.send
    });
    assert.equal(socketServer.bindSessionToLobby(collector.sessionId, lobbyId), true);
    assert.equal(socketServer.bindSessionToGame(collector.sessionId, gameId), true);
  }

  let lobbyState = createLobbyState({
    lobbyId,
    hostPlayerId: players.host,
    hostDisplayName: "Host"
  });
  lobbyState = expectLobbySuccess(
    joinLobby(lobbyState, {
      playerId: players.east,
      displayName: "East"
    })
  );
  lobbyState = expectLobbySuccess(
    joinLobby(lobbyState, {
      playerId: players.south,
      displayName: "South"
    })
  );
  lobbyState = expectLobbySuccess(
    joinLobby(lobbyState, {
      playerId: players.west,
      displayName: "West"
    })
  );
  lobbyState = expectLobbySuccess(
    startLobbyGame(lobbyState, {
      actorPlayerId: players.host
    })
  );
  lobbyStore.upsert({ state: lobbyState });

  gameStore.upsert({
    gameId,
    lobbyId,
    state: buildActivePlayState()
  });

  for (const slot of SLOT_VALUES) {
    sessionStore.upsert({
      sessionId: sessions[slot],
      playerId: players[slot],
      lobbyId,
      gameId,
      reconnectToken: reconnectTokens[slot]
    });
  }

  return {
    nowMs,
    lobbyId,
    gameId,
    players,
    sessions,
    reconnectTokens,
    collectors,
    lobbyState,
    lobbyStore,
    gameStore,
    sessionStore,
    socketServer,
    reconnectPolicy
  };
}

test("reconnect lifecycle allows reclaiming the same seat within the reconnect window", async () => {
  const fixture = createFixture();

  const disconnected = fixture.sessionStore.setConnection(fixture.sessions.east, false);
  assert.ok(disconnected);
  fixture.lobbyState = expectLobbySuccess(
    setLobbyPlayerConnection(fixture.lobbyState, {
      playerId: fixture.players.east,
      connected: false
    })
  );
  fixture.lobbyStore.upsert({ state: fixture.lobbyState });
  await publishLobbyState(fixture.socketServer, fixture.lobbyState);

  fixture.nowMs.value += MIN_RECONNECT_GRACE_MS - 1;

  const reconnectCandidate = fixture.sessionStore.findByReconnectToken(fixture.reconnectTokens.east);
  assert.ok(reconnectCandidate);
  assert.equal(fixture.reconnectPolicy.shouldForfeit(reconnectCandidate, fixture.nowMs.value), false);

  fixture.socketServer.disconnectSession(fixture.sessions.east);
  const reconnectedSessionId = parseSessionIdOrThrow("integration-session-22-reconnected");
  const reconnectCollector = createCollector(reconnectedSessionId);
  fixture.socketServer.connectSession({
    sessionId: reconnectedSessionId,
    send: reconnectCollector.send
  });
  assert.equal(fixture.socketServer.bindSessionToLobby(reconnectedSessionId, fixture.lobbyId), true);
  assert.equal(fixture.socketServer.bindSessionToGame(reconnectedSessionId, fixture.gameId), true);

  fixture.sessionStore.upsert({
    sessionId: reconnectedSessionId,
    playerId: fixture.players.east,
    lobbyId: fixture.lobbyId,
    gameId: fixture.gameId,
    reconnectToken: fixture.reconnectTokens.east
  });
  fixture.lobbyState = expectLobbySuccess(
    setLobbyPlayerConnection(fixture.lobbyState, {
      playerId: fixture.players.east,
      connected: true
    })
  );
  fixture.lobbyStore.upsert({ state: fixture.lobbyState });
  await publishLobbyState(fixture.socketServer, fixture.lobbyState);

  const sessionAfterReconnect = fixture.sessionStore.getBySessionId(reconnectedSessionId);
  assert.ok(sessionAfterReconnect);
  assert.equal(sessionAfterReconnect.playerId, fixture.players.east);
  assert.equal(sessionAfterReconnect.connected, true);
  assert.equal(sessionAfterReconnect.reconnectByMs, null);

  const seatEast = fixture.lobbyState.seats.find((seat) => seat.seat === "east");
  assert.ok(seatEast);
  assert.equal(seatEast.playerId, fixture.players.east);
  assert.equal(seatEast.connected, true);

  const latestLobbyEvent = lobbyStateEvents(reconnectCollector.events).at(-1);
  assert.ok(latestLobbyEvent);
  assert.equal(requireEastConnected(latestLobbyEvent), true);

  const gameAfterReconnect = fixture.gameStore.getByGameId(fixture.gameId);
  assert.ok(gameAfterReconnect);
  assert.equal(gameAfterReconnect.state.phase, "play");
});

test("reconnect lifecycle triggers forfeit after timeout and broadcasts ordered terminal events", async () => {
  const fixture = createFixture();
  const disconnectedCollector = fixture.collectors.south;
  const disconnectedEventCountBefore = disconnectedCollector.events.length;

  const disconnected = fixture.sessionStore.setConnection(fixture.sessions.south, false);
  assert.ok(disconnected);
  fixture.lobbyState = expectLobbySuccess(
    setLobbyPlayerConnection(fixture.lobbyState, {
      playerId: fixture.players.south,
      connected: false
    })
  );
  fixture.lobbyStore.upsert({ state: fixture.lobbyState });
  fixture.socketServer.disconnectSession(fixture.sessions.south);
  await publishLobbyState(fixture.socketServer, fixture.lobbyState);

  fixture.nowMs.value += MIN_RECONNECT_GRACE_MS + 1;

  const expiredSnapshot = fixture.sessionStore.findByPlayerId(fixture.players.south);
  assert.ok(expiredSnapshot);
  assert.equal(fixture.reconnectPolicy.shouldForfeit(expiredSnapshot, fixture.nowMs.value), true);
  assert.equal(
    fixture.reconnectPolicy.isRetentionExpired(expiredSnapshot, fixture.nowMs.value),
    false
  );

  const game = fixture.gameStore.getByGameId(fixture.gameId);
  assert.ok(game);
  const forfeit = resolveReconnectForfeit({
    gameId: fixture.gameId,
    state: game.state,
    lobbyState: fixture.lobbyState,
    forfeitingPlayerId: fixture.players.south
  });
  if (!forfeit.ok) {
    throw new Error(`${forfeit.code}: ${forfeit.message}`);
  }

  fixture.gameStore.upsert({
    gameId: fixture.gameId,
    lobbyId: fixture.lobbyId,
    state: forfeit.state
  });
  const published = await fixture.socketServer.broadcastGameEvents(fixture.gameId, forfeit.outbound);
  if (!published.ok) {
    throw new Error(`${published.code}: ${published.message}`);
  }

  assert.equal(published.deliveredSessionIds.length, 3);
  assert.equal(forfeit.outbound[0]?.type, "system.notice");
  assert.equal(forfeit.outbound[1]?.type, "game.state");
  assert.equal(forfeit.state.phase, "completed");
  assert.equal(forfeit.state.winner, "teamB");
  assert.equal(forfeit.state.scores.teamB, forfeit.state.targetScore);

  const storedGame = fixture.gameStore.getByGameId(fixture.gameId);
  assert.ok(storedGame);
  assert.equal(storedGame.state.phase, "completed");
  assert.equal(storedGame.state.winner, "teamB");

  const connectedCollectors = [
    fixture.collectors.host,
    fixture.collectors.east,
    fixture.collectors.west
  ] as const;
  for (const collector of connectedCollectors) {
    const tail = collector.events.slice(-2);
    assert.equal(tail.length, 2);
    assert.deepEqual(tail, forfeit.outbound);
  }

  assert.equal(disconnectedCollector.events.length, disconnectedEventCountBefore);
});
