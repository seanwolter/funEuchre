import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
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

type WsCollector = {
  messages: JsonObject[];
  clear(): void;
  waitFor(
    predicate: (message: JsonObject) => boolean,
    timeoutMs?: number
  ): Promise<JsonObject>;
};

type ConnectedWebSocket = {
  socket: WebSocket;
  collector: WsCollector;
};

function asJsonObject(input: unknown): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Expected JSON object.");
  }
  return input as JsonObject;
}

function asString(input: unknown, label: string): string {
  if (typeof input !== "string") {
    throw new Error(`Expected ${label} to be a string.`);
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

function requireSeat(
  lobbyStatePayload: JsonObject,
  seat: "north" | "east" | "south" | "west"
): JsonObject {
  const seats = lobbyStatePayload.seats;
  if (!Array.isArray(seats)) {
    throw new Error("Expected lobby.state payload.seats array.");
  }

  for (const entry of seats) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    if ((entry as JsonObject).seat === seat) {
      return entry as JsonObject;
    }
  }

  throw new Error(`Expected seat "${seat}" in lobby.state payload.`);
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
      // Ignore malformed transport messages in tests.
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
              server.close((error) => {
                if (error) {
                  closeResolve();
                  return;
                }
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

test("websocket transport delivers ordered lobby/game events to subscribed clients", async (t) => {
  const server = createAppServer();
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "rt-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const hostIdentity = requireResponseIdentity(created.body);

  const eastJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "rt-join-east",
    lobbyId: hostIdentity.lobbyId,
    displayName: "East"
  });
  assert.equal(eastJoin.status, 200);
  const eastIdentity = requireResponseIdentity(eastJoin.body);

  const southJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "rt-join-south",
    lobbyId: hostIdentity.lobbyId,
    displayName: "South"
  });
  assert.equal(southJoin.status, 200);

  const westJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "rt-join-west",
    lobbyId: hostIdentity.lobbyId,
    displayName: "West"
  });
  assert.equal(westJoin.status, 200);

  const hostConnected = await connectWebSocket(
    toWebSocketUrl(started.baseUrl, hostIdentity)
  );
  const eastConnected = await connectWebSocket(
    toWebSocketUrl(started.baseUrl, eastIdentity)
  );
  const hostSocket = hostConnected.socket;
  const eastSocket = eastConnected.socket;
  const hostCollector = hostConnected.collector;
  const eastCollector = eastConnected.collector;
  t.after(async () => {
    await closeWebSocket(hostSocket);
    await closeWebSocket(eastSocket);
  });
  await hostCollector.waitFor((message) => message.type === "ws.ready");
  await eastCollector.waitFor((message) => message.type === "ws.ready");

  hostSocket.send(JSON.stringify({ type: "subscribe", payload: {} }));
  eastSocket.send(JSON.stringify({ type: "subscribe", payload: {} }));
  await hostCollector.waitFor((message) => message.type === "ws.subscribed");
  await eastCollector.waitFor((message) => message.type === "ws.subscribed");
  hostCollector.clear();
  eastCollector.clear();

  const startedLobby = await postJson(started.baseUrl, "/lobbies/start", {
    requestId: "rt-start",
    lobbyId: hostIdentity.lobbyId,
    actorPlayerId: hostIdentity.playerId
  });
  assert.equal(startedLobby.status, 200);
  const outbound = requireOutbound(startedLobby.body);
  assert.equal(outbound[0]?.type, "lobby.state");
  assert.equal(outbound[1]?.type, "game.state");

  await hostCollector.waitFor((message) => message.type === "lobby.state");
  await hostCollector.waitFor((message) => message.type === "game.state");
  await eastCollector.waitFor((message) => message.type === "lobby.state");
  await eastCollector.waitFor((message) => message.type === "game.state");

  const hostProtocolTail = hostCollector.messages.filter((message) =>
    message.type === "lobby.state" || message.type === "game.state"
  );
  const eastProtocolTail = eastCollector.messages.filter((message) =>
    message.type === "lobby.state" || message.type === "game.state"
  );
  assert.equal(hostProtocolTail[0]?.type, "lobby.state");
  assert.equal(hostProtocolTail[1]?.type, "game.state");
  assert.equal(eastProtocolTail[0]?.type, "lobby.state");
  assert.equal(eastProtocolTail[1]?.type, "game.state");
});

test("websocket disconnect and reconnect updates lobby connection state and resumes realtime delivery", async (t) => {
  const server = createAppServer();
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "rt2-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const hostIdentity = requireResponseIdentity(created.body);

  const eastJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "rt2-join-east",
    lobbyId: hostIdentity.lobbyId,
    displayName: "East"
  });
  assert.equal(eastJoin.status, 200);
  const eastIdentity = requireResponseIdentity(eastJoin.body);

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

  const eastConnectedWs = await connectWebSocket(
    toWebSocketUrl(started.baseUrl, eastIdentity)
  );
  const eastSocket = eastConnectedWs.socket;
  let eastCollector = eastConnectedWs.collector;
  await eastCollector.waitFor((message) => message.type === "ws.ready");
  eastSocket.send(JSON.stringify({ type: "subscribe", payload: {} }));
  await eastCollector.waitFor((message) => message.type === "ws.subscribed");
  hostCollector.clear();

  await closeWebSocket(eastSocket);
  const eastDisconnected = await hostCollector.waitFor(
    (message) => {
      if (message.type !== "lobby.state") {
        return false;
      }
      const payload = asJsonObject(message.payload);
      const eastSeat = requireSeat(payload, "east");
      return eastSeat.connected === false;
    },
    3_000
  );
  assert.equal(eastDisconnected.type, "lobby.state");

  const eastReconnected = await connectWebSocket(
    toWebSocketUrl(started.baseUrl, eastIdentity)
  );
  const eastReconnectedSocket = eastReconnected.socket;
  t.after(async () => {
    await closeWebSocket(eastReconnectedSocket);
  });
  eastCollector = eastReconnected.collector;
  await eastCollector.waitFor((message) => message.type === "ws.ready");
  eastReconnectedSocket.send(JSON.stringify({ type: "subscribe", payload: {} }));
  await eastCollector.waitFor((message) => message.type === "ws.subscribed");

  const eastConnectedMessage = await hostCollector.waitFor(
    (message) => {
      if (message.type !== "lobby.state") {
        return false;
      }
      const payload = asJsonObject(message.payload);
      const eastSeat = requireSeat(payload, "east");
      return eastSeat.connected === true;
    },
    3_000
  );
  assert.equal(eastConnectedMessage.type, "lobby.state");

  hostCollector.clear();
  eastCollector.clear();
  const renamed = await postJson(started.baseUrl, "/lobbies/update-name", {
    requestId: "rt2-rename",
    lobbyId: hostIdentity.lobbyId,
    playerId: eastIdentity.playerId,
    displayName: "East Reconnected"
  });
  assert.equal(renamed.status, 200);

  const renameMessage = await eastCollector.waitFor(
    (message) => {
      if (message.type !== "lobby.state") {
        return false;
      }
      const payload = asJsonObject(message.payload);
      const eastSeat = requireSeat(payload, "east");
      return eastSeat.displayName === "East Reconnected";
    },
    3_000
  );
  assert.equal(renameMessage.type, "lobby.state");
});
