import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import test from "node:test";
import { createAppServer } from "../src/server.js";

type JsonObject = Record<string, unknown>;

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

type SessionIdentity = {
  lobbyId: string;
  playerId: string;
  sessionId: string;
  reconnectToken: string;
};

function asJsonObject(input: unknown): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Expected JSON object.");
  }
  return input as JsonObject;
}

function asString(input: unknown, label: string): string {
  if (typeof input !== "string") {
    throw new Error(`Expected ${label} to be string.`);
  }
  return input;
}

function asNumber(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`Expected ${label} to be number.`);
  }
  return input;
}

function requireIdentity(payload: JsonObject): SessionIdentity {
  const identity = asJsonObject(payload.identity);
  return {
    lobbyId: asString(identity.lobbyId, "identity.lobbyId"),
    playerId: asString(identity.playerId, "identity.playerId"),
    sessionId: asString(identity.sessionId, "identity.sessionId"),
    reconnectToken: asString(identity.reconnectToken, "identity.reconnectToken")
  };
}

function toWebSocketUrl(baseUrl: string, identity: SessionIdentity): string {
  const url = new URL("/realtime/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionId", identity.sessionId);
  url.searchParams.set("reconnectToken", identity.reconnectToken);
  return url.toString();
}

function startServer(server: Server): Promise<StartedServer> {
  return new Promise<StartedServer>((resolve, reject) => {
    const sockets = new Set<Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });

    server.listen(0, "127.0.0.1");
    server.once("error", reject);
    void once(server, "listening")
      .then(() => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Expected TCP address info for started server."));
          return;
        }

        resolve({
          baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
          close: async () =>
            new Promise<void>((closeResolve) => {
              for (const socket of sockets) {
                socket.destroy();
              }
              sockets.clear();
              server.close(() => {
                closeResolve();
              });
            })
        });
      })
      .catch(reject);
  });
}

async function postJson(
  baseUrl: string,
  path: string,
  payload: JsonObject
): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return {
    status: response.status,
    body: asJsonObject(await response.json())
  };
}

async function getJson(
  baseUrl: string,
  path: string
): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    body: asJsonObject(await response.json())
  };
}

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener(
      "open",
      () => {
        resolve(socket);
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        reject(new Error("WebSocket connection failed."));
      },
      { once: true }
    );
  });
}

function expectWebSocketFailure(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    socket.addEventListener(
      "open",
      () => {
        socket.close();
        if (!settled) {
          settled = true;
          reject(new Error("Expected websocket connection to fail."));
        }
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        finish();
      },
      { once: true }
    );
    socket.addEventListener(
      "close",
      () => {
        finish();
      },
      { once: true }
    );
  });
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === 2 || socket.readyState === 3) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 1_000);
    socket.addEventListener(
      "close",
      () => {
        finish();
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        finish();
      },
      { once: true }
    );

    socket.close();
  });
}

test("metrics endpoint reports command latency, rejection rates, and game counters under HTTP traffic", async (t) => {
  const server = createAppServer();
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "metrics-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const host = requireIdentity(created.body);

  const joined = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "metrics-join",
    lobbyId: host.lobbyId,
    displayName: "East"
  });
  assert.equal(joined.status, 200);
  const joinedSouth = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "metrics-join-south",
    lobbyId: host.lobbyId,
    displayName: "South"
  });
  assert.equal(joinedSouth.status, 200);
  const joinedWest = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "metrics-join-west",
    lobbyId: host.lobbyId,
    displayName: "West"
  });
  assert.equal(joinedWest.status, 200);

  const startedLobby = await postJson(started.baseUrl, "/lobbies/start", {
    requestId: "metrics-start",
    lobbyId: host.lobbyId,
    actorPlayerId: host.playerId
  });
  assert.equal(startedLobby.status, 200);

  const invalidAction = await postJson(started.baseUrl, "/actions", {
    requestId: "metrics-invalid",
    type: "game.play_card",
    payload: {
      gameId: "invalid-game-id",
      actorSeat: "invalid-seat",
      cardId: "clubs:9"
    }
  });
  assert.equal(invalidAction.status, 400);

  const health = await getJson(started.baseUrl, "/health");
  assert.equal(health.status, 200);
  assert.equal(asString(health.body.status, "/health status"), "ok");

  const metricsResponse = await getJson(started.baseUrl, "/metrics");
  assert.equal(metricsResponse.status, 200);
  const counters = asJsonObject(metricsResponse.body.counters);
  const commands = asJsonObject(counters.commands);
  const games = asJsonObject(counters.games);
  const latency = asJsonObject(asJsonObject(metricsResponse.body.latencyMs).commands);

  assert.equal(asNumber(commands.total, "commands.total") >= 6, true);
  assert.equal(asNumber(commands.accepted, "commands.accepted") >= 5, true);
  assert.equal(asNumber(commands.rejected, "commands.rejected") >= 1, true);
  const rejectionsByCode = asJsonObject(commands.rejectionsByCode);
  assert.equal(
    asNumber(rejectionsByCode.INVALID_ACTION, "commands.rejectionsByCode.INVALID_ACTION") >= 1,
    true
  );

  assert.equal(asNumber(games.started, "games.started") >= 1, true);
  assert.equal(asNumber(games.completed, "games.completed") >= 0, true);
  assert.equal(asNumber(games.forfeits, "games.forfeits") >= 0, true);

  assert.equal(asNumber(latency.count, "latency.count") >= 6, true);
  assert.equal(asNumber(latency.totalMs, "latency.totalMs") >= 0, true);
});

test("metrics endpoint tracks websocket reconnect attempts/success/failure and active sessions", async (t) => {
  const server = createAppServer();
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "metrics-ws-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const identity = requireIdentity(created.body);

  const socket = await connectWebSocket(toWebSocketUrl(started.baseUrl, identity));
  t.after(async () => {
    await closeWebSocket(socket);
  });

  await expectWebSocketFailure(
    toWebSocketUrl(started.baseUrl, {
      ...identity,
      reconnectToken: `${identity.reconnectToken}tampered`
    })
  );

  const metricsResponse = await getJson(started.baseUrl, "/metrics");
  assert.equal(metricsResponse.status, 200);
  const counters = asJsonObject(metricsResponse.body.counters);
  const reconnect = asJsonObject(counters.reconnect);
  const sessions = asJsonObject(counters.sessions);

  assert.equal(asNumber(reconnect.attempted, "reconnect.attempted") >= 2, true);
  assert.equal(asNumber(reconnect.successful, "reconnect.successful") >= 1, true);
  assert.equal(asNumber(reconnect.failed, "reconnect.failed") >= 1, true);
  assert.equal(asNumber(sessions.active, "sessions.active"), 1);
  assert.equal(asNumber(sessions.peak, "sessions.peak") >= 1, true);
});
