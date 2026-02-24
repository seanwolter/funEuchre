import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { Socket, connect } from "node:net";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow,
  parseReconnectTokenOrThrow,
  parseSessionIdOrThrow
} from "../src/domain/ids.js";
import {
  RUNTIME_ENV_KEYS,
  resolveRuntimeConfig
} from "../src/config/runtimeConfig.js";
import { createAppServer } from "../src/server.js";
import {
  createReconnectTokenManager
} from "../src/security/reconnectToken.js";
import { createRuntimeOrchestrator } from "../src/runtime/orchestrator.js";

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

function alterToken(token: string): string {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return `${token}A`;
  }

  const payloadSegment = segments[1] ?? "";
  const lastIndex = payloadSegment.length - 1;
  const current = payloadSegment[lastIndex];
  const nextChar = current === "A" ? "B" : "A";
  const alteredPayload =
    payloadSegment.length === 0
      ? "A"
      : `${payloadSegment.slice(0, Math.max(0, lastIndex))}${nextChar}`;
  return `${segments[0]}.${alteredPayload}.${segments[2]}`;
}

function createSecurityRuntimeConfig(secret: string) {
  return resolveRuntimeConfig({
    [RUNTIME_ENV_KEYS.reconnectTokenSecret]: secret
  });
}

function requestWsUpgradeStatus(input: {
  baseUrl: string;
  sessionId: string;
  reconnectToken: string;
}): Promise<number> {
  const base = new URL(input.baseUrl);
  const requestUrl = new URL("/realtime/ws", input.baseUrl);
  requestUrl.searchParams.set("sessionId", input.sessionId);
  requestUrl.searchParams.set("reconnectToken", input.reconnectToken);
  const key = Buffer.from("fun-euchre-security-test").toString("base64");

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const socket = connect({
      host: base.hostname,
      port: Number(base.port)
    });

    const finish = (statusCode?: number, error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      if (statusCode === undefined) {
        reject(new Error("Missing websocket upgrade response status."));
        return;
      }
      resolve(statusCode);
    };

    socket.on("error", (error) => {
      finish(undefined, error instanceof Error ? error : new Error(String(error)));
    });

    let buffer = "";
    socket.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lineEndIndex = buffer.indexOf("\r\n");
      if (lineEndIndex < 0) {
        return;
      }

      const statusLine = buffer.slice(0, lineEndIndex);
      const match = /^HTTP\/1\.1\s+(\d{3})\s/.exec(statusLine);
      if (!match) {
        finish(undefined, new Error(`Invalid websocket status line: ${statusLine}`));
        return;
      }
      const statusCodeText = match[1];
      if (statusCodeText === undefined) {
        finish(undefined, new Error(`Missing websocket status code: ${statusLine}`));
        return;
      }
      finish(Number(statusCodeText));
    });

    socket.on("connect", () => {
      socket.write(
        `GET ${requestUrl.pathname}${requestUrl.search} HTTP/1.1\r\n` +
          `Host: ${base.host}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n"
      );
    });
  });
}

test("reconnect token manager validates valid, forged, altered, and expired tokens", () => {
  const nowMs = { value: 1_000_000 };
  const manager = createReconnectTokenManager({
    secret: "security-unit-secret",
    maxAgeMs: 1_000,
    now: () => nowMs.value
  });

  const issued = manager.issue({
    sessionId: parseSessionIdOrThrow("session-unit-1"),
    lobbyId: parseLobbyIdOrThrow("lobby-unit-1"),
    playerId: parsePlayerIdOrThrow("player-unit-1")
  });
  const valid = manager.verify(issued, {
    expectedSessionId: parseSessionIdOrThrow("session-unit-1"),
    expectedLobbyId: parseLobbyIdOrThrow("lobby-unit-1"),
    expectedPlayerId: parsePlayerIdOrThrow("player-unit-1")
  });
  assert.equal(valid.ok, true);

  const forged = manager.verify(parseReconnectTokenOrThrow("rt1.Zm9yZ2Vk.Zm9yZ2Vk"));
  assert.equal(forged.ok, false);

  const altered = manager.verify(parseReconnectTokenOrThrow(alterToken(issued)));
  assert.equal(altered.ok, false);

  nowMs.value += 1_001;
  const expired = manager.verify(issued);
  assert.equal(expired.ok, false);
  if (expired.ok) {
    throw new Error("Expected reconnect token expiry.");
  }
  assert.equal(expired.code, "EXPIRED");
});

test("HTTP and websocket reconnect reject forged, altered, and expired tokens while accepting valid tokens", async (t) => {
  const nowMs = { value: 2_000_000 };
  const runtimeConfig = createSecurityRuntimeConfig("security-integration-secret");
  const runtime = createRuntimeOrchestrator({
    runtimeConfig,
    clock: () => nowMs.value
  });
  const server = createAppServer({
    runtime,
    runtimeConfig
  });
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "security-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const hostIdentity = requireResponseIdentity(created.body);

  const eastJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "security-join-east",
    lobbyId: hostIdentity.lobbyId,
    displayName: "East"
  });
  assert.equal(eastJoin.status, 200);
  const eastIdentity = requireResponseIdentity(eastJoin.body);

  const validReclaim = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "security-reclaim-valid",
    lobbyId: eastIdentity.lobbyId,
    displayName: "East",
    reconnectToken: eastIdentity.reconnectToken
  });
  assert.equal(validReclaim.status, 200);
  const validIdentity = requireResponseIdentity(validReclaim.body);
  assert.equal(validIdentity.sessionId, eastIdentity.sessionId);

  const validWsStatus = await requestWsUpgradeStatus({
    baseUrl: started.baseUrl,
    sessionId: eastIdentity.sessionId,
    reconnectToken: eastIdentity.reconnectToken
  });
  assert.equal(validWsStatus, 101);

  const alteredToken = alterToken(eastIdentity.reconnectToken);
  const alteredJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "security-reclaim-altered",
    lobbyId: eastIdentity.lobbyId,
    displayName: "East",
    reconnectToken: alteredToken
  });
  assert.equal(alteredJoin.status, 403);
  assert.equal(asJsonObject(alteredJoin.body.error).code, "UNAUTHORIZED");
  const alteredWsStatus = await requestWsUpgradeStatus({
    baseUrl: started.baseUrl,
    sessionId: eastIdentity.sessionId,
    reconnectToken: alteredToken
  });
  assert.equal(alteredWsStatus, 401);

  const forgedToken = "rt1.Zm9yZ2Vk.Zm9yZ2Vk";
  const forgedJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "security-reclaim-forged",
    lobbyId: eastIdentity.lobbyId,
    displayName: "East",
    reconnectToken: forgedToken
  });
  assert.equal(forgedJoin.status, 403);
  assert.equal(asJsonObject(forgedJoin.body.error).code, "UNAUTHORIZED");
  const forgedWsStatus = await requestWsUpgradeStatus({
    baseUrl: started.baseUrl,
    sessionId: eastIdentity.sessionId,
    reconnectToken: forgedToken
  });
  assert.equal(forgedWsStatus, 401);

  nowMs.value += runtimeConfig.gameRetentionMs + 1;
  const expiredJoin = await postJson(started.baseUrl, "/lobbies/join", {
    requestId: "security-reclaim-expired",
    lobbyId: eastIdentity.lobbyId,
    displayName: "East",
    reconnectToken: eastIdentity.reconnectToken
  });
  assert.equal(expiredJoin.status, 403);
  assert.equal(asJsonObject(expiredJoin.body.error).code, "UNAUTHORIZED");
  const expiredWsStatus = await requestWsUpgradeStatus({
    baseUrl: started.baseUrl,
    sessionId: eastIdentity.sessionId,
    reconnectToken: eastIdentity.reconnectToken
  });
  assert.equal(expiredWsStatus, 401);
});
