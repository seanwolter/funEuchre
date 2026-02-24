import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { PROTOCOL_VERSION } from "@fun-euchre/protocol";
import { createInitialGameState } from "@fun-euchre/game-rules";
import { resolveReconnectForfeit } from "../src/domain/reconnectPolicy.js";
import { InMemorySessionStore } from "../src/domain/sessionStore.js";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow,
  parseReconnectTokenOrThrow,
  parseSessionIdOrThrow
} from "../src/domain/ids.js";
import {
  createLobbyState,
  joinLobby,
  type LobbyState,
  type LobbyTransitionResult
} from "../src/domain/lobby.js";
import { createGameRoutes, type GameCommandDispatcher } from "../src/http/gameRoutes.js";
import { createLobbyRoutes, type LobbyCommandDispatcher } from "../src/http/lobbyRoutes.js";
import { createAppRouter } from "../src/http/router.js";
import {
  createStructuredLogger,
  type StructuredLogEntry
} from "../src/observability/logger.js";

type ResponseState = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
};

function expectLobbySuccess(result: LobbyTransitionResult): LobbyState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  return result.state;
}

function headerValueToString(value: string | number | readonly string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value === undefined) {
    return "";
  }
  return value.join(", ");
}

function createMockJsonRequest(
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): IncomingMessage {
  const raw = typeof body === "string" ? body : JSON.stringify(body);

  return {
    method,
    url,
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      ...headers
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw, "utf8");
    }
  } as IncomingMessage;
}

function createMockResponse(): { response: ServerResponse; state: ResponseState } {
  const state: ResponseState = {
    statusCode: null,
    headers: {},
    body: null
  };

  const response = {
    writeHead(
      statusCode: number,
      headers?: Record<string, string | number | readonly string[]>
    ): ServerResponse {
      state.statusCode = statusCode;
      state.headers = {};
      for (const [key, value] of Object.entries(headers ?? {})) {
        state.headers[key.toLowerCase()] = headerValueToString(value);
      }
      return response as unknown as ServerResponse;
    },
    end(chunk?: string | Buffer): ServerResponse {
      if (typeof chunk === "string") {
        state.body = chunk;
      } else if (chunk) {
        state.body = chunk.toString("utf8");
      } else {
        state.body = null;
      }

      return response as unknown as ServerResponse;
    }
  };

  return {
    response: response as unknown as ServerResponse,
    state
  };
}

function createEntryCollector(): {
  entries: StructuredLogEntry[];
  logger: ReturnType<typeof createStructuredLogger>;
} {
  const entries: StructuredLogEntry[] = [];
  const logger = createStructuredLogger({
    now: () => new Date("2026-02-24T00:00:00.000Z"),
    sink: (entry) => {
      entries.push(entry);
    }
  });

  return {
    entries,
    logger
  };
}

test("structured logger emits stable fields and preserves correlation context", () => {
  const { entries, logger } = createEntryCollector();

  logger.logLobbyAction({
    action: "lobby.create",
    outcome: "accepted",
    message: "Lobby command accepted.",
    lobbyId: "lobby-1",
    playerId: "player-1",
    requestId: "req-1",
    metadata: { source: "test" }
  });
  logger.logGameTransition({
    transition: "game.play_card",
    message: "Game command accepted.",
    gameId: "game-1",
    requestId: "req-2"
  });
  logger.logReject({
    code: "INVALID_ACTION",
    message: "Rejected action.",
    requestId: "req-3"
  });
  logger.logDisconnect({
    message: "Session disconnected.",
    playerId: "player-2",
    metadata: { reconnectByMs: 1000 }
  });
  logger.logReconnect({
    message: "Session reconnected.",
    playerId: "player-2"
  });
  logger.logForfeit({
    message: "teamB wins by forfeit.",
    gameId: "game-2",
    lobbyId: "lobby-2",
    playerId: "player-3",
    requestId: "req-4"
  });

  assert.equal(entries.length, 6);
  for (const entry of entries) {
    assert.equal(entry.timestamp, "2026-02-24T00:00:00.000Z");
    assert.equal(typeof entry.level, "string");
    assert.equal(typeof entry.event, "string");
    assert.equal(typeof entry.message, "string");
    assert.ok(Object.hasOwn(entry, "lobbyId"));
    assert.ok(Object.hasOwn(entry, "gameId"));
    assert.ok(Object.hasOwn(entry, "playerId"));
    assert.ok(Object.hasOwn(entry, "requestId"));
    assert.equal(typeof entry.metadata, "object");
  }

  const first = entries[0];
  if (!first) {
    throw new Error("Missing first log entry.");
  }
  assert.equal(first.event, "lobby.action");
  assert.equal(first.lobbyId, "lobby-1");
  assert.equal(first.playerId, "player-1");
  assert.equal(first.requestId, "req-1");
});

test("route handlers log accepted transitions and rejects exactly once per request", async () => {
  const { entries, logger } = createEntryCollector();

  const lobbyDispatcher: LobbyCommandDispatcher = (command) => {
    if (command.kind === "lobby.start") {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "Only the host may start."
      };
    }

    return {
      ok: true,
      outbound: [
        {
          version: PROTOCOL_VERSION,
          type: "system.notice",
          payload: {
            severity: "info",
            message: "ok"
          }
        }
      ]
    };
  };
  const gameDispatcher: GameCommandDispatcher = () => ({
    ok: true,
    outbound: [
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
          scores: {
            teamA: 0,
            teamB: 0
          }
        }
      }
    ]
  });

  const router = createAppRouter({
    lobbyRoutes: createLobbyRoutes({
      dispatchCommand: lobbyDispatcher,
      logger
    }),
    actionRoutes: createGameRoutes({
      dispatchCommand: gameDispatcher,
      logger
    })
  });

  const createResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/lobbies/create", {
      requestId: "req-lobby-create",
      displayName: "Host"
    }),
    createResponse.response
  );
  assert.equal(createResponse.state.statusCode, 200);

  const startResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/lobbies/start", {
      requestId: "req-lobby-start",
      lobbyId: "lobby-1",
      actorPlayerId: "player-2"
    }),
    startResponse.response
  );
  assert.equal(startResponse.state.statusCode, 403);

  const playResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/actions", {
      version: 1,
      type: "game.play_card",
      requestId: "req-play-card",
      payload: {
        gameId: "game-1",
        actorSeat: "north",
        cardId: "clubs:9"
      }
    }),
    playResponse.response
  );
  assert.equal(playResponse.state.statusCode, 200);

  const invalidActionResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/actions", {
      version: 1,
      type: "game.play_card",
      requestId: "req-invalid",
      payload: {
        gameId: "game-1",
        actorSeat: "invalid-seat",
        cardId: "clubs:9"
      }
    }),
    invalidActionResponse.response
  );
  assert.equal(invalidActionResponse.state.statusCode, 400);

  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((entry) => entry.event),
    ["lobby.action", "action.rejected", "game.transition", "action.rejected"]
  );

  const startReject = entries[1];
  if (!startReject) {
    throw new Error("Missing start rejection log entry.");
  }
  assert.equal(startReject.lobbyId, "lobby-1");
  assert.equal(startReject.playerId, "player-2");
  assert.equal(startReject.requestId, "req-lobby-start");

  const gameAccepted = entries[2];
  if (!gameAccepted) {
    throw new Error("Missing game transition log entry.");
  }
  assert.equal(gameAccepted.gameId, "game-1");
  assert.equal(gameAccepted.requestId, "req-play-card");
});

test("session store logs disconnect and reconnect exactly once for state changes", () => {
  const { entries, logger } = createEntryCollector();
  const now = { value: 1000 };
  const store = new InMemorySessionStore({
    logger,
    clock: () => now.value
  });

  store.upsert({
    sessionId: parseSessionIdOrThrow("session-1"),
    playerId: parsePlayerIdOrThrow("player-1"),
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    gameId: parseGameIdOrThrow("game-1"),
    reconnectToken: parseReconnectTokenOrThrow("token-1")
  });

  store.setConnection(parseSessionIdOrThrow("session-1"), false);
  store.setConnection(parseSessionIdOrThrow("session-1"), false);
  store.setConnection(parseSessionIdOrThrow("session-1"), true);

  const disconnects = entries.filter((entry) => entry.event === "session.disconnected");
  const reconnects = entries.filter((entry) => entry.event === "session.reconnected");
  assert.equal(disconnects.length, 1);
  assert.equal(reconnects.length, 1);

  const disconnect = disconnects[0];
  if (!disconnect) {
    throw new Error("Missing disconnect log entry.");
  }
  assert.equal(disconnect.lobbyId, "lobby-1");
  assert.equal(disconnect.gameId, "game-1");
  assert.equal(disconnect.playerId, "player-1");
});

test("resolveReconnectForfeit logs terminal forfeit event once with correlation fields", () => {
  const { entries, logger } = createEntryCollector();
  const gameId = parseGameIdOrThrow("game-forfeit-1");
  const lobbyId = parseLobbyIdOrThrow("lobby-forfeit-1");
  const forfeitingPlayerId = parsePlayerIdOrThrow("player-1");

  let lobby = createLobbyState({
    lobbyId,
    hostPlayerId: forfeitingPlayerId,
    hostDisplayName: "Host"
  });
  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );
  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-3"),
      displayName: "South"
    })
  );
  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-4"),
      displayName: "West"
    })
  );

  const result = resolveReconnectForfeit({
    gameId,
    state: createInitialGameState(),
    lobbyState: lobby,
    forfeitingPlayerId,
    requestId: "req-forfeit",
    logger
  });
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  assert.equal(entries.length, 1);
  const entry = entries[0];
  if (!entry) {
    throw new Error("Missing forfeit log entry.");
  }
  assert.equal(entry.event, "game.forfeit");
  assert.equal(entry.gameId, "game-forfeit-1");
  assert.equal(entry.lobbyId, "lobby-forfeit-1");
  assert.equal(entry.playerId, "player-1");
  assert.equal(entry.requestId, "req-forfeit");
});
