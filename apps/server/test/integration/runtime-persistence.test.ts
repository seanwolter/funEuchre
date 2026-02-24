import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  RUNTIME_ENV_KEYS,
  resolveRuntimeConfig
} from "../../src/config/runtimeConfig.js";
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

function asJsonObject(input: unknown): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Expected JSON object response payload.");
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
    throw new Error("Expected outbound array in response payload.");
  }

  return payload.outbound.map((entry) => asJsonObject(entry));
}

function startServer(server: Server): Promise<StartedServer> {
  return new Promise<StartedServer>((resolve, reject) => {
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
            new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) {
                  closeReject(error);
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

function createPersistenceRuntimeConfig(snapshotPath: string) {
  return resolveRuntimeConfig({
    [RUNTIME_ENV_KEYS.persistenceMode]: "file",
    [RUNTIME_ENV_KEYS.persistencePath]: snapshotPath
  });
}

test("runtime snapshot persists on close and restores lobby/game/session context on restart", async () => {
  const snapshotDir = mkdtempSync(join(tmpdir(), "fun-euchre-runtime-persist-"));
  const snapshotPath = join(snapshotDir, "runtime-snapshot.json");
  const runtimeConfig = createPersistenceRuntimeConfig(snapshotPath);

  const serverA = createAppServer({ runtimeConfig });
  const startedA = await startServer(serverA);

  const created = await postJson(startedA.baseUrl, "/lobbies/create", {
    requestId: "persist-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  const hostIdentity = requireResponseIdentity(created.body);

  for (const [index, name] of ["East", "South", "West"].entries()) {
    const joined = await postJson(startedA.baseUrl, "/lobbies/join", {
      requestId: `persist-join-${index + 1}`,
      lobbyId: hostIdentity.lobbyId,
      displayName: name
    });
    assert.equal(joined.status, 200);
  }

  const startedLobby = await postJson(startedA.baseUrl, "/lobbies/start", {
    requestId: "persist-start",
    lobbyId: hostIdentity.lobbyId,
    actorPlayerId: hostIdentity.playerId
  });
  assert.equal(startedLobby.status, 200);
  assert.equal(
    requireOutbound(startedLobby.body).some((event) => event.type === "game.state"),
    true
  );

  await startedA.close();
  assert.equal(existsSync(snapshotPath), true);

  const serverB = createAppServer({ runtimeConfig });
  const startedB = await startServer(serverB);
  try {
    const rejoined = await postJson(startedB.baseUrl, "/lobbies/join", {
      requestId: "persist-reconnect",
      lobbyId: hostIdentity.lobbyId,
      displayName: "Host",
      reconnectToken: hostIdentity.reconnectToken
    });
    assert.equal(rejoined.status, 200);

    const rejoinedIdentity = requireResponseIdentity(rejoined.body);
    assert.equal(rejoinedIdentity.lobbyId, hostIdentity.lobbyId);
    assert.equal(rejoinedIdentity.playerId, hostIdentity.playerId);
    assert.equal(rejoinedIdentity.sessionId, hostIdentity.sessionId);
    assert.equal(rejoinedIdentity.reconnectToken, hostIdentity.reconnectToken);

    const rejoinOutbound = requireOutbound(rejoined.body);
    assert.equal(rejoinOutbound.some((event) => event.type === "lobby.state"), true);
    assert.equal(rejoinOutbound.some((event) => event.type === "game.state"), true);
  } finally {
    await startedB.close();
  }
});

test("server starts with clean fallback when persisted snapshot is corrupted", async () => {
  const snapshotDir = mkdtempSync(join(tmpdir(), "fun-euchre-runtime-corrupt-"));
  const snapshotPath = join(snapshotDir, "runtime-snapshot.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      schema: "fun-euchre.runtime.snapshot",
      version: 999,
      generatedAtMs: 1,
      lobbyRecords: [],
      gameRecords: [],
      sessionRecords: []
    }),
    "utf8"
  );

  const runtimeConfig = createPersistenceRuntimeConfig(snapshotPath);
  const server = createAppServer({ runtimeConfig });
  const started = await startServer(server);
  try {
    const created = await postJson(started.baseUrl, "/lobbies/create", {
      requestId: "persist-corrupt-create",
      displayName: "Host"
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.error, undefined);
  } finally {
    await started.close();
  }
});
