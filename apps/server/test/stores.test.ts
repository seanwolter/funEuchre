import assert from "node:assert/strict";
import test from "node:test";
import { createInitialGameState, createTeamScore } from "@fun-euchre/game-rules";
import { parseGameIdOrThrow, parseLobbyIdOrThrow, parsePlayerIdOrThrow, parseReconnectTokenOrThrow, parseSessionIdOrThrow } from "../src/domain/ids.js";
import { createLobbyState, joinLobby, type LobbyState, type LobbyTransitionResult } from "../src/domain/lobby.js";
import { InMemoryGameStore } from "../src/domain/gameStore.js";
import { InMemoryLobbyStore } from "../src/domain/lobbyStore.js";
import { InMemorySessionStore } from "../src/domain/sessionStore.js";

type MutableClock = {
  now: () => number;
  set: (nextMs: number) => void;
  advance: (deltaMs: number) => number;
};

function createMutableClock(startMs = 0): MutableClock {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    set: (nextMs: number) => {
      nowMs = nextMs;
    },
    advance: (deltaMs: number) => {
      nowMs += deltaMs;
      return nowMs;
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
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );

  return lobby;
}

test("InMemoryLobbyStore supports lookups, reindexing, and clone safety", () => {
  const clock = createMutableClock(1_000);
  const store = new InMemoryLobbyStore({ clock: clock.now, ttlMs: 200 });
  const hostPlayerId = parsePlayerIdOrThrow("player-1");
  const eastPlayerId = parsePlayerIdOrThrow("player-2");
  const lobbyState = buildLobbyState();

  const inserted = store.upsert({ state: lobbyState });
  assert.equal(inserted.createdAtMs, 1_000);
  assert.equal(inserted.updatedAtMs, 1_000);
  assert.equal(store.findByPlayerId(hostPlayerId)?.lobbyId, lobbyState.lobbyId);
  assert.equal(store.findByPlayerId(eastPlayerId)?.lobbyId, lobbyState.lobbyId);

  inserted.state.seats[0]!.displayName = "Mutated";
  const reloaded = store.getByLobbyId(lobbyState.lobbyId);
  assert.equal(reloaded?.state.seats[0]!.displayName, "Host");

  clock.advance(1);
  const hostOnlyState: LobbyState = {
    ...lobbyState,
    seats: lobbyState.seats.map((seat) => {
      if (seat.playerId === eastPlayerId) {
        return {
          ...seat,
          playerId: null,
          displayName: null,
          connected: false
        };
      }
      return {
        ...seat
      };
    })
  };
  store.upsert({ state: hostOnlyState });
  assert.equal(store.findByPlayerId(eastPlayerId), null);
  assert.equal(store.findByPlayerId(hostPlayerId)?.lobbyId, lobbyState.lobbyId);

  assert.equal(store.deleteByLobbyId(lobbyState.lobbyId), true);
  assert.equal(store.getByLobbyId(lobbyState.lobbyId), null);
  assert.equal(store.findByPlayerId(hostPlayerId), null);
});

test("InMemoryLobbyStore expiry is deterministic with a fake clock", () => {
  const clock = createMutableClock(500);
  const store = new InMemoryLobbyStore({ clock: clock.now, ttlMs: 10 });
  const lobbyState = buildLobbyState();

  store.upsert({ state: lobbyState });
  const record = store.getByLobbyId(lobbyState.lobbyId);
  assert.ok(record);
  assert.equal(store.isExpired(record, 510), false);
  assert.equal(store.isExpired(record, 511), true);

  clock.set(510);
  assert.deepEqual(store.pruneExpired(), []);
  clock.set(511);
  assert.deepEqual(store.pruneExpired(), [lobbyState.lobbyId]);
  assert.equal(store.getByLobbyId(lobbyState.lobbyId), null);
});

test("InMemoryGameStore supports lookups, reindexing, and clone safety", () => {
  const clock = createMutableClock(2_000);
  const store = new InMemoryGameStore({ clock: clock.now, ttlMs: 200 });
  const gameId = parseGameIdOrThrow("game-1");
  const lobbyIdA = parseLobbyIdOrThrow("lobby-A");
  const lobbyIdB = parseLobbyIdOrThrow("lobby-B");
  const gameState = createInitialGameState({
    dealer: "north",
    handNumber: 1,
    scores: createTeamScore(0, 0)
  });

  const inserted = store.upsert({
    gameId,
    lobbyId: lobbyIdA,
    state: gameState
  });
  assert.equal(inserted.createdAtMs, 2_000);
  assert.equal(inserted.updatedAtMs, 2_000);
  assert.equal(store.findByLobbyId(lobbyIdA)?.gameId, gameId);

  inserted.state.phase = "completed";
  assert.equal(store.getByGameId(gameId)?.state.phase, "deal");

  clock.advance(5);
  store.upsert({
    gameId,
    lobbyId: lobbyIdB,
    state: {
      ...gameState,
      handNumber: 2
    }
  });
  assert.equal(store.findByLobbyId(lobbyIdA), null);
  assert.equal(store.findByLobbyId(lobbyIdB)?.state.handNumber, 2);

  assert.equal(store.deleteByGameId(gameId), true);
  assert.equal(store.getByGameId(gameId), null);
  assert.equal(store.findByLobbyId(lobbyIdB), null);
});

test("InMemoryGameStore expiry is deterministic with a fake clock", () => {
  const clock = createMutableClock(800);
  const store = new InMemoryGameStore({ clock: clock.now, ttlMs: 10 });
  const gameId = parseGameIdOrThrow("game-2");
  const lobbyId = parseLobbyIdOrThrow("lobby-2");

  store.upsert({
    gameId,
    lobbyId,
    state: createInitialGameState({
      dealer: "east",
      handNumber: 3,
      scores: createTeamScore(1, 2)
    })
  });

  const record = store.getByGameId(gameId);
  assert.ok(record);
  assert.equal(store.isExpired(record, 810), false);
  assert.equal(store.isExpired(record, 811), true);

  clock.set(811);
  assert.deepEqual(store.pruneExpired(), [gameId]);
  assert.equal(store.getByGameId(gameId), null);
});

test("InMemorySessionStore supports indexes, uniqueness constraints, and clone safety", () => {
  const clock = createMutableClock(3_000);
  const store = new InMemorySessionStore({
    clock: clock.now,
    reconnectWindowMs: 50,
    ttlMs: 500
  });

  const lobbyId = parseLobbyIdOrThrow("lobby-3");
  const gameId = parseGameIdOrThrow("game-3");
  const playerA = parsePlayerIdOrThrow("player-A");
  const playerB = parsePlayerIdOrThrow("player-B");
  const sessionA = parseSessionIdOrThrow("session-A");
  const sessionB = parseSessionIdOrThrow("session-B");
  const sessionC = parseSessionIdOrThrow("session-C");
  const tokenA = parseReconnectTokenOrThrow("token-A");
  const tokenB = parseReconnectTokenOrThrow("token-B");

  const inserted = store.upsert({
    sessionId: sessionA,
    playerId: playerA,
    lobbyId,
    gameId,
    reconnectToken: tokenA
  });
  assert.equal(store.findByPlayerId(playerA)?.sessionId, sessionA);
  assert.equal(store.findByReconnectToken(tokenA)?.sessionId, sessionA);

  inserted.connected = false;
  assert.equal(store.getBySessionId(sessionA)?.connected, true);

  clock.advance(10);
  store.upsert({
    sessionId: sessionB,
    playerId: playerA,
    lobbyId,
    gameId,
    reconnectToken: tokenB
  });
  assert.equal(store.getBySessionId(sessionA), null);
  assert.equal(store.findByPlayerId(playerA)?.sessionId, sessionB);
  assert.equal(store.findByReconnectToken(tokenA), null);

  store.upsert({
    sessionId: sessionC,
    playerId: playerB,
    lobbyId,
    gameId,
    reconnectToken: tokenB
  });
  assert.equal(store.getBySessionId(sessionB), null);
  assert.equal(store.findByPlayerId(playerA), null);
  assert.equal(store.findByReconnectToken(tokenB)?.sessionId, sessionC);

  const disconnected = store.setConnection(sessionC, false);
  assert.ok(disconnected);
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.reconnectByMs, 3_060);

  clock.advance(5);
  const touched = store.touch(sessionC);
  assert.ok(touched);
  assert.equal(touched.updatedAtMs, 3_015);

  const reconnected = store.setConnection(sessionC, true);
  assert.ok(reconnected);
  assert.equal(reconnected.connected, true);
  assert.equal(reconnected.reconnectByMs, null);
});

test("InMemorySessionStore reconnect and ttl expiry are deterministic with a fake clock", () => {
  const clock = createMutableClock(4_000);
  const store = new InMemorySessionStore({
    clock: clock.now,
    reconnectWindowMs: 100,
    ttlMs: 300
  });

  const lobbyId = parseLobbyIdOrThrow("lobby-4");
  const playerId = parsePlayerIdOrThrow("player-4");
  const reconnectToken = parseReconnectTokenOrThrow("token-4");
  const reconnectSessionId = parseSessionIdOrThrow("session-4");

  store.upsert({
    sessionId: reconnectSessionId,
    playerId,
    lobbyId,
    reconnectToken
  });
  const disconnected = store.setConnection(reconnectSessionId, false);
  assert.ok(disconnected);
  assert.equal(disconnected.reconnectByMs, 4_100);
  assert.equal(store.isReconnectExpired(disconnected, 4_100), false);
  assert.equal(store.isReconnectExpired(disconnected, 4_101), true);

  clock.set(4_101);
  assert.deepEqual(store.pruneExpired(), [reconnectSessionId]);
  assert.equal(store.getBySessionId(reconnectSessionId), null);

  const ttlSessionId = parseSessionIdOrThrow("session-5");
  store.upsert({
    sessionId: ttlSessionId,
    playerId: parsePlayerIdOrThrow("player-5"),
    lobbyId,
    reconnectToken: parseReconnectTokenOrThrow("token-5")
  });
  const ttlRecord = store.getBySessionId(ttlSessionId);
  assert.ok(ttlRecord);
  assert.equal(store.isExpired(ttlRecord, 4_401), false);
  assert.equal(store.isExpired(ttlRecord, 4_402), true);

  clock.set(4_402);
  assert.deepEqual(store.pruneExpired(), [ttlSessionId]);
  assert.equal(store.getBySessionId(ttlSessionId), null);
});
