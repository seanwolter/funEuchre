import assert from "node:assert/strict";
import test from "node:test";
import type { ClientToServerEvent, ServerToClientEvent } from "@fun-euchre/protocol";
import { setLobbyPlayerConnection } from "../../src/domain/lobby.js";
import {
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow,
  parseReconnectTokenOrThrow,
  parseSessionIdOrThrow
} from "../../src/domain/ids.js";
import {
  MIN_GAME_RETENTION_MS,
  MIN_RECONNECT_GRACE_MS
} from "../../src/domain/reconnectPolicy.js";
import type {
  GameId,
  LobbyId,
  PlayerId,
  ReconnectToken,
  SessionId
} from "../../src/domain/types.js";
import { ReconnectLifecycleSweeper } from "../../src/runtime/reconnectLifecycleSweeper.js";
import { createRuntimeOrchestrator, type RuntimeOrchestrator } from "../../src/runtime/orchestrator.js";

type RuntimeIdentity = {
  lobbyId: LobbyId;
  playerId: PlayerId;
  sessionId: SessionId;
  reconnectToken: ReconnectToken;
};

type RuntimeFixture = {
  nowMs: { value: number };
  runtime: RuntimeOrchestrator;
  lobbyId: LobbyId;
  gameId: GameId;
  identities: {
    host: RuntimeIdentity;
    east: RuntimeIdentity;
    south: RuntimeIdentity;
    west: RuntimeIdentity;
  };
};

function toClientEvent(
  type: ClientToServerEvent["type"],
  requestId: string,
  payload: Record<string, unknown>
): ClientToServerEvent {
  return {
    version: 1,
    type,
    requestId,
    payload
  } as ClientToServerEvent;
}

function requireRuntimeIdentity(result: {
  ok: boolean;
  identity?: {
    lobbyId: string;
    playerId: string;
    sessionId: string;
    reconnectToken: string;
  };
  code?: string;
  message?: string;
}): RuntimeIdentity {
  if (!result.ok) {
    throw new Error(`${result.code ?? "UNKNOWN"}: ${result.message ?? "unknown error"}`);
  }
  if (!result.identity) {
    throw new Error("Expected identity metadata from lobby command.");
  }

  return {
    lobbyId: parseLobbyIdOrThrow(result.identity.lobbyId),
    playerId: parsePlayerIdOrThrow(result.identity.playerId),
    sessionId: parseSessionIdOrThrow(result.identity.sessionId),
    reconnectToken: parseReconnectTokenOrThrow(result.identity.reconnectToken)
  };
}

function connectCollector(
  runtime: RuntimeOrchestrator,
  identity: RuntimeIdentity,
  gameId: GameId
): ServerToClientEvent[] {
  const events: ServerToClientEvent[] = [];
  runtime.socketServer.connectSession({
    sessionId: identity.sessionId,
    send: (event) => {
      events.push(event);
    }
  });
  runtime.socketServer.bindSessionToLobby(identity.sessionId, identity.lobbyId);
  runtime.socketServer.bindSessionToGame(identity.sessionId, gameId);
  return events;
}

function disconnectPlayer(runtime: RuntimeOrchestrator, identity: RuntimeIdentity): void {
  const disconnected = runtime.sessionStore.setConnection(identity.sessionId, false);
  assert.ok(disconnected);

  const lobbyRecord = runtime.lobbyStore.getByLobbyId(identity.lobbyId);
  assert.ok(lobbyRecord);

  const updatedLobby = setLobbyPlayerConnection(lobbyRecord.state, {
    playerId: identity.playerId,
    connected: false
  });
  if (!updatedLobby.ok) {
    throw new Error(`${updatedLobby.code}: ${updatedLobby.message}`);
  }

  runtime.lobbyStore.upsert({ state: updatedLobby.state });
  runtime.socketServer.disconnectSession(identity.sessionId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 500,
  intervalMs = 5
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await delay(intervalMs);
  }

  throw new Error("Timed out waiting for runtime lifecycle condition.");
}

async function createRuntimeFixture(): Promise<RuntimeFixture> {
  const nowMs = { value: 1_000_000 };
  const runtime = createRuntimeOrchestrator({
    clock: () => nowMs.value
  });

  const created = await runtime.lobbyCommandDispatcher(
    {
      kind: "lobby.create",
      requestId: "runtime-sweep-create",
      displayName: "Host"
    },
    toClientEvent("lobby.create", "runtime-sweep-create", {
      displayName: "Host"
    })
  );
  const host = requireRuntimeIdentity(created);

  const east = requireRuntimeIdentity(
    await runtime.lobbyCommandDispatcher(
      {
        kind: "lobby.join",
        requestId: "runtime-sweep-join-east",
        lobbyId: host.lobbyId,
        displayName: "East",
        reconnectToken: null
      },
      toClientEvent("lobby.join", "runtime-sweep-join-east", {
        lobbyId: host.lobbyId,
        displayName: "East",
        reconnectToken: null
      })
    )
  );
  const south = requireRuntimeIdentity(
    await runtime.lobbyCommandDispatcher(
      {
        kind: "lobby.join",
        requestId: "runtime-sweep-join-south",
        lobbyId: host.lobbyId,
        displayName: "South",
        reconnectToken: null
      },
      toClientEvent("lobby.join", "runtime-sweep-join-south", {
        lobbyId: host.lobbyId,
        displayName: "South",
        reconnectToken: null
      })
    )
  );
  const west = requireRuntimeIdentity(
    await runtime.lobbyCommandDispatcher(
      {
        kind: "lobby.join",
        requestId: "runtime-sweep-join-west",
        lobbyId: host.lobbyId,
        displayName: "West",
        reconnectToken: null
      },
      toClientEvent("lobby.join", "runtime-sweep-join-west", {
        lobbyId: host.lobbyId,
        displayName: "West",
        reconnectToken: null
      })
    )
  );

  const started = await runtime.lobbyCommandDispatcher(
    {
      kind: "lobby.start",
      requestId: "runtime-sweep-start",
      lobbyId: host.lobbyId,
      actorPlayerId: host.playerId
    },
    toClientEvent("lobby.start", "runtime-sweep-start", {
      lobbyId: host.lobbyId,
      actorPlayerId: host.playerId
    })
  );
  if (!started.ok) {
    throw new Error(`${started.code}: ${started.message}`);
  }

  const gameRecord = runtime.gameStore.findByLobbyId(host.lobbyId);
  if (!gameRecord) {
    throw new Error("Expected game record after lobby.start.");
  }

  return {
    nowMs,
    runtime,
    lobbyId: host.lobbyId,
    gameId: gameRecord.gameId,
    identities: {
      host,
      east,
      south,
      west
    }
  };
}

test("reconnect lifecycle sweeper auto-forfeits after timeout without additional commands", async () => {
  const fixture = await createRuntimeFixture();
  const sweeper = new ReconnectLifecycleSweeper({
    runtime: fixture.runtime,
    sweepIntervalMs: 5
  });
  sweeper.start();

  try {
    const hostEvents = connectCollector(fixture.runtime, fixture.identities.host, fixture.gameId);
    const eastEvents = connectCollector(fixture.runtime, fixture.identities.east, fixture.gameId);
    const southEvents = connectCollector(fixture.runtime, fixture.identities.south, fixture.gameId);
    const westEvents = connectCollector(fixture.runtime, fixture.identities.west, fixture.gameId);

    disconnectPlayer(fixture.runtime, fixture.identities.south);
    const southCountBeforeForfeit = southEvents.length;

    fixture.nowMs.value += MIN_RECONNECT_GRACE_MS + 1;
    await waitFor(() => {
      const gameRecord = fixture.runtime.gameStore.getByGameId(fixture.gameId);
      return gameRecord !== null && gameRecord.state.phase === "completed";
    });

    const gameRecord = fixture.runtime.gameStore.getByGameId(fixture.gameId);
    assert.ok(gameRecord);
    assert.equal(gameRecord.state.phase, "completed");
    assert.equal(gameRecord.state.winner, "teamB");

    for (const collector of [hostEvents, eastEvents, westEvents]) {
      assert.equal(collector.at(-2)?.type, "system.notice");
      assert.equal(collector.at(-1)?.type, "game.state");
    }
    assert.equal(southEvents.length, southCountBeforeForfeit);
  } finally {
    sweeper.stop();
  }
});

test("reconnect lifecycle sweeper prunes expired session, game, and lobby records after retention", async () => {
  const fixture = await createRuntimeFixture();
  const sweeper = new ReconnectLifecycleSweeper({
    runtime: fixture.runtime,
    sweepIntervalMs: 5
  });
  sweeper.start();

  try {
    disconnectPlayer(fixture.runtime, fixture.identities.host);
    disconnectPlayer(fixture.runtime, fixture.identities.east);
    disconnectPlayer(fixture.runtime, fixture.identities.south);
    disconnectPlayer(fixture.runtime, fixture.identities.west);

    fixture.nowMs.value += MIN_RECONNECT_GRACE_MS + 1;
    await waitFor(() => {
      const gameRecord = fixture.runtime.gameStore.getByGameId(fixture.gameId);
      return gameRecord !== null && gameRecord.state.phase === "completed";
    });

    const forfeitAppliedAtMs = fixture.nowMs.value;
    fixture.nowMs.value = forfeitAppliedAtMs + MIN_GAME_RETENTION_MS + 1;
    await waitFor(() => {
      return (
        fixture.runtime.sessionStore.listRecords().length === 0 &&
        fixture.runtime.gameStore.listRecords().length === 0 &&
        fixture.runtime.lobbyStore.listRecords().length === 0
      );
    });
  } finally {
    sweeper.stop();
  }
});

