import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import test from "node:test";
import { createAppServer } from "../../src/server.js";

type JsonObject = Record<string, unknown>;

type SessionIdentity = {
  lobbyId: string;
  playerId: string;
  sessionId: string;
  reconnectToken: string;
};

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

type WsCollector = {
  messages: JsonObject[];
  clear: () => void;
  waitFor: (
    predicate: (message: JsonObject) => boolean,
    timeoutMs?: number
  ) => Promise<JsonObject>;
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

function requireResponseIdentity(payload: JsonObject): SessionIdentity {
  const identity = asJsonObject(payload.identity);
  return {
    lobbyId: asString(identity.lobbyId, "identity.lobbyId"),
    playerId: asString(identity.playerId, "identity.playerId"),
    sessionId: asString(identity.sessionId, "identity.sessionId"),
    reconnectToken: asString(identity.reconnectToken, "identity.reconnectToken")
  };
}

function requireOutbound(payload: JsonObject): JsonObject[] {
  if (!Array.isArray(payload.outbound)) {
    throw new Error("Expected outbound array.");
  }
  return payload.outbound.map((entry) => asJsonObject(entry));
}

function toWebSocketUrl(baseUrl: string, identity: SessionIdentity): string {
  const url = new URL("/realtime/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionId", identity.sessionId);
  url.searchParams.set("reconnectToken", identity.reconnectToken);
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCollector(socket: WebSocket): WsCollector {
  const messages: JsonObject[] = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    try {
      const parsed = JSON.parse(event.data) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        messages.push(parsed as JsonObject);
      }
    } catch {
      // Ignore malformed payloads in test transport collector.
    }
  });

  return {
    messages,
    clear: () => {
      messages.length = 0;
    },
    waitFor: async (predicate, timeoutMs = 2_500) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        for (const message of messages) {
          if (predicate(message)) {
            return message;
          }
        }
        await delay(10);
      }
      throw new Error("Timed out waiting for websocket message.");
    }
  };
}

type ConnectedWebSocket = {
  socket: WebSocket;
  collector: WsCollector;
};

function connectWebSocket(url: string): Promise<ConnectedWebSocket> {
  return new Promise<ConnectedWebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    const collector = createCollector(socket);
    socket.addEventListener(
      "open",
      () => {
        resolve({ socket, collector });
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
    if (socket.readyState === 0) {
      socket.addEventListener(
        "open",
        () => {
          socket.close();
        },
        { once: true }
      );
      return;
    }

    socket.close();
  });
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

function protocolMessages(messages: readonly JsonObject[]): JsonObject[] {
  return messages.filter((message) => {
    const type = message.type;
    return (
      typeof type === "string" &&
      type !== "ws.ready" &&
      type !== "ws.subscribed" &&
      type !== "ws.error"
    );
  });
}

async function expectWebsocketParity(
  collector: WsCollector,
  expectedOutbound: readonly JsonObject[],
  timeoutMs = 3_000
): Promise<void> {
  await collector.waitFor(
    () => protocolMessages(collector.messages).length >= expectedOutbound.length,
    timeoutMs
  );
  const wsOutbound = protocolMessages(collector.messages).slice(0, expectedOutbound.length);
  assert.deepEqual(wsOutbound, expectedOutbound);
}

function requireGameIdFromOutbound(outbound: readonly JsonObject[]): string {
  const gameState = outbound.find((event) => event.type === "game.state");
  if (!gameState) {
    throw new Error("Expected game.state in outbound.");
  }
  const payload = asJsonObject(gameState.payload);
  return asString(payload.gameId, "game.state payload.gameId");
}

function requireSeatConnected(
  event: JsonObject,
  seat: "north" | "east" | "south" | "west"
): boolean {
  const payload = asJsonObject(event.payload);
  const seats = payload.seats;
  if (!Array.isArray(seats)) {
    throw new Error("Expected lobby.state payload.seats array.");
  }
  const matched = seats.find((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false;
    }
    return (entry as JsonObject).seat === seat;
  });
  if (!matched || typeof matched !== "object" || Array.isArray(matched)) {
    throw new Error(`Expected seat "${seat}" in lobby.state payload.`);
  }
  return (matched as JsonObject).connected === true;
}

test("HTTP outbound envelopes and websocket events stay in contract parity for join/start/action/reconnect", async (t) => {
  const server = createAppServer();
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "contract-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const hostIdentity = requireResponseIdentity(created.body);
  const createOutbound = requireOutbound(created.body);
  assert.deepEqual(createOutbound.map((event) => event.type), ["lobby.state"]);

  const hostConnected = await connectWebSocket(
    toWebSocketUrl(started.baseUrl, hostIdentity)
  );
  const hostSocket = hostConnected.socket;
  const hostCollector = hostConnected.collector;
  t.after(async () => {
    await closeWebSocket(hostSocket);
  });
  await hostCollector.waitFor((message) => message.type === "ws.ready");
  hostSocket.send(JSON.stringify({ type: "subscribe", payload: {} }));
  await hostCollector.waitFor((message) => message.type === "ws.subscribed");
  hostCollector.clear();

  const eastJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "contract-join-east",
    lobbyId: hostIdentity.lobbyId,
    displayName: "East"
  });
  assert.equal(eastJoin.status, 200);
  const eastIdentity = requireResponseIdentity(eastJoin.body);
  const eastJoinOutbound = requireOutbound(eastJoin.body);
  assert.deepEqual(eastJoinOutbound.map((event) => event.type), ["lobby.state"]);
  await expectWebsocketParity(hostCollector, eastJoinOutbound);
  hostCollector.clear();

  const southJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "contract-join-south",
    lobbyId: hostIdentity.lobbyId,
    displayName: "South"
  });
  assert.equal(southJoin.status, 200);
  const southJoinOutbound = requireOutbound(southJoin.body);
  assert.deepEqual(southJoinOutbound.map((event) => event.type), ["lobby.state"]);
  await expectWebsocketParity(hostCollector, southJoinOutbound);
  hostCollector.clear();

  const westJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "contract-join-west",
    lobbyId: hostIdentity.lobbyId,
    displayName: "West"
  });
  assert.equal(westJoin.status, 200);
  const westJoinOutbound = requireOutbound(westJoin.body);
  assert.deepEqual(westJoinOutbound.map((event) => event.type), ["lobby.state"]);
  await expectWebsocketParity(hostCollector, westJoinOutbound);
  hostCollector.clear();

  const startedLobby = await postJson(started.baseUrl, "/lobbies/start", {
    requestId: "contract-start",
    lobbyId: hostIdentity.lobbyId,
    actorPlayerId: hostIdentity.playerId
  });
  assert.equal(startedLobby.status, 200);
  const startOutbound = requireOutbound(startedLobby.body);
  assert.deepEqual(startOutbound.map((event) => event.type), ["lobby.state", "game.state"]);
  await expectWebsocketParity(hostCollector, startOutbound);
  hostCollector.clear();

  const gameId = requireGameIdFromOutbound(startOutbound);

  const eastConnected = await connectWebSocket(
    toWebSocketUrl(started.baseUrl, eastIdentity)
  );
  const eastSocket = eastConnected.socket;
  const eastCollector = eastConnected.collector;
  t.after(async () => {
    await closeWebSocket(eastSocket);
  });
  await eastCollector.waitFor((message) => message.type === "ws.ready");
  eastSocket.send(JSON.stringify({ type: "subscribe", payload: {} }));
  await eastCollector.waitFor((message) => message.type === "ws.subscribed");
  hostCollector.clear();
  eastCollector.clear();

  const passAction = await postJson(started.baseUrl, "/actions", {
    requestId: "contract-pass-east",
    type: "game.pass",
    payload: {
      gameId,
      actorSeat: "east"
    }
  });
  assert.equal(passAction.status, 200);
  const passOutbound = requireOutbound(passAction.body);
  assert.deepEqual(passOutbound.map((event) => event.type), ["game.state"]);
  await expectWebsocketParity(hostCollector, passOutbound);
  await expectWebsocketParity(eastCollector, passOutbound);

  hostCollector.clear();
  eastCollector.clear();
  const illegalPlay = await postJson(started.baseUrl, "/actions", {
    requestId: "contract-play-illegal",
    type: "game.play_card",
    payload: {
      gameId,
      actorSeat: "east",
      cardId: "clubs:9"
    }
  });
  assert.equal(illegalPlay.status, 200);
  const illegalPlayOutbound = requireOutbound(illegalPlay.body);
  assert.deepEqual(illegalPlayOutbound.map((event) => event.type), ["action.rejected"]);
  await expectWebsocketParity(hostCollector, illegalPlayOutbound);
  await expectWebsocketParity(eastCollector, illegalPlayOutbound);

  hostCollector.clear();
  await closeWebSocket(eastSocket);
  await hostCollector.waitFor(
    (message) => {
      if (message.type !== "lobby.state") {
        return false;
      }
      return requireSeatConnected(message, "east") === false;
    },
    3_500
  );
  hostCollector.clear();

  const reconnectJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "contract-reconnect-east",
    lobbyId: hostIdentity.lobbyId,
    displayName: "East",
    reconnectToken: eastIdentity.reconnectToken
  });
  assert.equal(reconnectJoin.status, 200);
  const reconnectIdentity = requireResponseIdentity(reconnectJoin.body);
  assert.equal(reconnectIdentity.sessionId, eastIdentity.sessionId);
  const reconnectOutbound = requireOutbound(reconnectJoin.body);
  assert.deepEqual(reconnectOutbound.map((event) => event.type), [
    "lobby.state",
    "game.state"
  ]);
  await expectWebsocketParity(hostCollector, reconnectOutbound);
});
