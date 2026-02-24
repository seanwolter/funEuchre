import assert from "node:assert/strict";
import test from "node:test";
import type { LobbyStateEvent, Seat, ServerToClientEvent } from "@fun-euchre/protocol";
import {
  createLobbyState,
  joinLobby,
  startLobbyGame,
  updateLobbyDisplayName,
  type LobbyState,
  type LobbyTransitionResult
} from "../../src/domain/lobby.js";
import { InMemoryLobbyStore } from "../../src/domain/lobbyStore.js";
import {
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow,
  parseSessionIdOrThrow
} from "../../src/domain/ids.js";
import { toLobbyStateEvent } from "../../src/domain/protocolAdapter.js";
import { InMemorySocketServer } from "../../src/realtime/socketServer.js";
import type { SessionId } from "../../src/domain/types.js";

type Collector = {
  sessionId: SessionId;
  events: ServerToClientEvent[];
  send: (event: ServerToClientEvent) => void;
};

function createCollector(sessionId: SessionId): Collector {
  const events: ServerToClientEvent[] = [];
  return {
    sessionId,
    events,
    send: (event) => {
      events.push(event);
    }
  };
}

function expectLobbySuccess(result: LobbyTransitionResult): LobbyState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  return result.state;
}

function lobbyStateEvents(events: readonly ServerToClientEvent[]): LobbyStateEvent[] {
  return events.filter((event): event is LobbyStateEvent => event.type === "lobby.state");
}

function requireLastTwo(events: readonly LobbyStateEvent[]): [LobbyStateEvent, LobbyStateEvent] {
  if (events.length < 2) {
    throw new Error("Expected at least two lobby.state events.");
  }

  const secondToLast = events[events.length - 2];
  const last = events[events.length - 1];
  if (!secondToLast || !last) {
    throw new Error("Missing tail lobby.state events.");
  }

  return [secondToLast, last];
}

function requireSeat(event: LobbyStateEvent, seat: Seat): LobbyStateEvent["payload"]["seats"][number] {
  const found = event.payload.seats.find((entry) => entry.seat === seat);
  if (!found) {
    throw new Error(`Expected seat "${seat}" in lobby.state payload.`);
  }

  return found;
}

function requireOrderingSequence(event: ServerToClientEvent): number {
  const ordering = event.ordering;
  if (!ordering || !Number.isInteger(ordering.sequence) || ordering.sequence <= 0) {
    throw new Error("Expected positive integer event ordering.sequence.");
  }
  return ordering.sequence;
}

function withoutOrdering(event: ServerToClientEvent): Omit<ServerToClientEvent, "ordering"> {
  const { ordering: _ordering, ...rest } = event;
  return rest;
}

async function publishLobbyState(socketServer: InMemorySocketServer, state: LobbyState): Promise<void> {
  const result = await socketServer.broadcastLobbyEvents(state.lobbyId, [toLobbyStateEvent(state)]);
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
}

test("lobby lifecycle create/join/start preserves ordered lobby.state parity across clients", async () => {
  const lobbyId = parseLobbyIdOrThrow("integration-lobby-1");
  const hostPlayerId = parsePlayerIdOrThrow("integration-player-1");
  const eastPlayerId = parsePlayerIdOrThrow("integration-player-2");
  const southPlayerId = parsePlayerIdOrThrow("integration-player-3");
  const westPlayerId = parsePlayerIdOrThrow("integration-player-4");
  const hostSessionId = parseSessionIdOrThrow("integration-session-1");
  const eastSessionId = parseSessionIdOrThrow("integration-session-2");
  const southSessionId = parseSessionIdOrThrow("integration-session-3");
  const westSessionId = parseSessionIdOrThrow("integration-session-4");

  const hostCollector = createCollector(hostSessionId);
  const eastCollector = createCollector(eastSessionId);
  const southCollector = createCollector(southSessionId);
  const westCollector = createCollector(westSessionId);
  const collectors = [hostCollector, eastCollector, southCollector, westCollector] as const;

  const socketServer = new InMemorySocketServer();
  for (const collector of collectors) {
    socketServer.connectSession({
      sessionId: collector.sessionId,
      send: collector.send
    });
  }

  const lobbyStore = new InMemoryLobbyStore();
  let lobby = createLobbyState({
    lobbyId,
    hostPlayerId,
    hostDisplayName: "Host"
  });
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(hostSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: eastPlayerId,
      displayName: "East"
    })
  );
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(eastSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: southPlayerId,
      displayName: "South"
    })
  );
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(southSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: westPlayerId,
      displayName: "West"
    })
  );
  lobbyStore.upsert({ state: lobby });
  assert.equal(socketServer.bindSessionToLobby(westSessionId, lobbyId), true);
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    updateLobbyDisplayName(lobby, {
      playerId: eastPlayerId,
      displayName: "East Renamed"
    })
  );
  lobbyStore.upsert({ state: lobby });
  await publishLobbyState(socketServer, lobby);

  lobby = expectLobbySuccess(
    startLobbyGame(lobby, {
      actorPlayerId: hostPlayerId
    })
  );
  lobbyStore.upsert({ state: lobby });
  await publishLobbyState(socketServer, lobby);

  const persisted = lobbyStore.getByLobbyId(lobbyId);
  assert.ok(persisted);
  assert.equal(persisted.state.phase, "in_game");
  assert.equal(
    persisted.state.seats.every((seat) => seat.playerId !== null),
    true
  );

  const expectedTail = requireLastTwo(lobbyStateEvents(hostCollector.events));
  const expectedFinalEvent = toLobbyStateEvent(lobby);
  assert.deepEqual(withoutOrdering(expectedTail[1]), expectedFinalEvent);
  assert.equal(requireOrderingSequence(expectedTail[1]) > requireOrderingSequence(expectedTail[0]), true);
  assert.equal(requireSeat(expectedTail[0], "east").displayName, "East Renamed");

  for (const collector of collectors) {
    const [renameEvent, startEvent] = requireLastTwo(lobbyStateEvents(collector.events));
    assert.equal(renameEvent.payload.phase, "waiting");
    assert.equal(startEvent.payload.phase, "in_game");
    assert.equal(requireSeat(renameEvent, "east").displayName, "East Renamed");
    assert.deepEqual([renameEvent, startEvent], expectedTail);
  }
});
