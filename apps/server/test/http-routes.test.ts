import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { createAppRouter } from "../src/http/router.js";
import { createLobbyRoutes, type LobbyCommandDispatcher } from "../src/http/lobbyRoutes.js";
import { createGameRoutes, type GameCommandDispatcher } from "../src/http/gameRoutes.js";

type ResponseState = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
};

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

test("lobby routes validate payloads and dispatch mapped commands", async () => {
  const seenKinds: string[] = [];
  const dispatcher: LobbyCommandDispatcher = (command) => {
    seenKinds.push(command.kind);
    return {
      ok: true,
      outbound: [
        {
          version: 1,
          type: "system.notice",
          payload: {
            severity: "info",
            message: `processed ${command.kind}`
          }
        }
      ]
    };
  };
  const router = createAppRouter({
    lobbyRoutes: createLobbyRoutes({ dispatchCommand: dispatcher })
  });

  const createResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/lobbies/create", {
      requestId: "req-create",
      displayName: "Host"
    }),
    createResponse.response
  );
  assert.equal(createResponse.state.statusCode, 200);
  assert.deepEqual(JSON.parse(createResponse.state.body ?? "{}"), {
    requestId: "req-create",
    outbound: [
      {
        version: 1,
        type: "system.notice",
        payload: {
          severity: "info",
          message: "processed lobby.create"
        }
      }
    ]
  });

  const joinResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/lobbies/join", {
      requestId: "req-join",
      lobbyId: "lobby-1",
      displayName: "Player",
      reconnectToken: "token-1"
    }),
    joinResponse.response
  );
  assert.equal(joinResponse.state.statusCode, 200);

  const renameResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/lobbies/update-name", {
      requestId: "req-rename",
      lobbyId: "lobby-1",
      playerId: "player-2",
      displayName: "Renamed"
    }),
    renameResponse.response
  );
  assert.equal(renameResponse.state.statusCode, 200);

  const startResponse = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/lobbies/start", {
      requestId: "req-start",
      lobbyId: "lobby-1",
      actorPlayerId: "player-1"
    }),
    startResponse.response
  );
  assert.equal(startResponse.state.statusCode, 200);
  assert.deepEqual(seenKinds, [
    "lobby.create",
    "lobby.join",
    "lobby.update_name",
    "lobby.start"
  ]);
});

test("lobby routes return normalized payload-validation errors with requestId", async () => {
  const router = createAppRouter({
    lobbyRoutes: createLobbyRoutes()
  });
  const result = createMockResponse();

  await router(
    createMockJsonRequest("POST", "/lobbies/create", {
      requestId: "req-bad",
      displayName: ""
    }),
    result.response
  );

  assert.equal(result.state.statusCode, 400);
  assert.deepEqual(JSON.parse(result.state.body ?? "{}"), {
    requestId: "req-bad",
    error: {
      code: "INVALID_ACTION",
      message: "lobby.create payload.displayName must be a non-empty string.",
      issues: ["lobby.create payload.displayName must be a non-empty string."]
    }
  });
});

test("lobby routes map dispatch rejects to normalized HTTP errors", async () => {
  const dispatcher: LobbyCommandDispatcher = () => ({
    ok: false,
    code: "UNAUTHORIZED",
    message: "Only the host may start."
  });
  const router = createAppRouter({
    lobbyRoutes: createLobbyRoutes({ dispatchCommand: dispatcher })
  });
  const result = createMockResponse();

  await router(
    createMockJsonRequest("POST", "/lobbies/start", {
      requestId: "req-unauthorized",
      lobbyId: "lobby-1",
      actorPlayerId: "player-2"
    }),
    result.response
  );

  assert.equal(result.state.statusCode, 403);
  assert.deepEqual(JSON.parse(result.state.body ?? "{}"), {
    requestId: "req-unauthorized",
    error: {
      code: "UNAUTHORIZED",
      message: "Only the host may start."
    }
  });
});

test("game action route validates protocol envelope and dispatches commands", async () => {
  const seenKinds: string[] = [];
  const dispatcher: GameCommandDispatcher = (command) => {
    seenKinds.push(command.kind);
    return {
      ok: true,
      outbound: [
        {
          version: 1,
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
    };
  };
  const router = createAppRouter({
    actionRoutes: createGameRoutes({ dispatchCommand: dispatcher })
  });
  const result = createMockResponse();

  await router(
    createMockJsonRequest("POST", "/actions", {
      version: 1,
      type: "game.play_card",
      requestId: "req-action",
      payload: {
        gameId: "game-1",
        actorSeat: "north",
        cardId: "clubs:9"
      }
    }),
    result.response
  );

  assert.equal(result.state.statusCode, 200);
  const payload = JSON.parse(result.state.body ?? "{}");
  assert.equal(payload.requestId, "req-action");
  assert.equal(payload.outbound[0]?.type, "game.state");
  assert.deepEqual(seenKinds, ["game.play_card"]);
});

test("game action route returns normalized validation and reject responses", async () => {
  const rejectDispatcher: GameCommandDispatcher = () => ({
    ok: false,
    code: "NOT_YOUR_TURN",
    message: "Action actor does not match current trick turn."
  });
  const router = createAppRouter({
    actionRoutes: createGameRoutes({ dispatchCommand: rejectDispatcher })
  });

  const invalidResult = createMockResponse();
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
    invalidResult.response
  );
  assert.equal(invalidResult.state.statusCode, 400);
  const invalidPayload = JSON.parse(invalidResult.state.body ?? "{}");
  assert.equal(invalidPayload.requestId, "req-invalid");
  assert.equal(invalidPayload.error.code, "INVALID_ACTION");

  const rejectResult = createMockResponse();
  await router(
    createMockJsonRequest("POST", "/actions", {
      version: 1,
      type: "game.play_card",
      requestId: "req-reject",
      payload: {
        gameId: "game-1",
        actorSeat: "north",
        cardId: "clubs:9"
      }
    }),
    rejectResult.response
  );
  assert.equal(rejectResult.state.statusCode, 409);
  assert.deepEqual(JSON.parse(rejectResult.state.body ?? "{}"), {
    requestId: "req-reject",
    error: {
      code: "NOT_YOUR_TURN",
      message: "Action actor does not match current trick turn."
    }
  });
});
