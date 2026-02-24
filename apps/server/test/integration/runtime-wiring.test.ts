import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createAppServer } from "../../src/server.js";

type JsonObject = Record<string, unknown>;

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
  const body = asJsonObject(await response.json());
  return {
    status: response.status,
    body
  };
}

test("default app server wires real runtime command dispatchers for lobby and action routes", async (t) => {
  const server = createAppServer();
  const started = await startServer(server);
  t.after(async () => {
    await started.close();
  });

  const created = await postJson(started.baseUrl, "/lobbies/create", {
    requestId: "req-runtime-create",
    displayName: "Host"
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.error, undefined);

  const createOutbound = requireOutbound(created.body);
  assert.equal(createOutbound.length, 1);
  const createLobbyEvent = createOutbound[0];
  if (!createLobbyEvent || createLobbyEvent.type !== "lobby.state") {
    throw new Error("Expected lobby.state event from create response.");
  }

  const createLobbyPayload = asJsonObject(createLobbyEvent.payload);
  const lobbyId = createLobbyPayload.lobbyId;
  const hostPlayerId = createLobbyPayload.hostPlayerId;
  assert.equal(typeof lobbyId, "string");
  assert.equal(typeof hostPlayerId, "string");

  for (const [index, displayName] of ["East", "South", "West"].entries()) {
    const joined = await postJson(started.baseUrl, "/lobbies/join", {
      requestId: `req-runtime-join-${index + 1}`,
      lobbyId,
      displayName
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.error, undefined);
    const joinOutbound = requireOutbound(joined.body);
    assert.equal(joinOutbound[0]?.type, "lobby.state");
  }

  const startedLobby = await postJson(started.baseUrl, "/lobbies/start", {
    requestId: "req-runtime-start",
    lobbyId,
    actorPlayerId: hostPlayerId
  });
  assert.equal(startedLobby.status, 200);
  assert.equal(startedLobby.body.error, undefined);

  const startOutbound = requireOutbound(startedLobby.body);
  const gameEvent = startOutbound.find((entry) => entry.type === "game.state");
  if (!gameEvent) {
    throw new Error("Expected game.state event from start response.");
  }

  const gamePayload = asJsonObject(gameEvent.payload);
  const gameId = gamePayload.gameId;
  assert.equal(typeof gameId, "string");

  const actionResult = await postJson(started.baseUrl, "/actions", {
    version: 1,
    type: "game.play_card",
    requestId: "req-runtime-action",
    payload: {
      gameId,
      actorSeat: "north",
      cardId: "clubs:9"
    }
  });
  assert.equal(actionResult.status, 200);
  assert.equal(actionResult.body.error, undefined);

  const actionOutbound = requireOutbound(actionResult.body);
  assert.equal(actionOutbound.length >= 1, true);
  const firstOutbound = actionOutbound[0];
  if (!firstOutbound) {
    throw new Error("Expected outbound event for action response.");
  }
  if (firstOutbound.type === "action.rejected") {
    const rejectedPayload = asJsonObject(firstOutbound.payload);
    assert.equal(
      String(rejectedPayload.message).includes("dispatcher is not configured"),
      false
    );
  }
});
