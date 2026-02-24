import assert from "node:assert/strict";
import test from "node:test";
import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { PROTOCOL_VERSION } from "@fun-euchre/protocol";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parseSessionIdOrThrow
} from "../src/domain/ids.js";
import { InMemoryEventHub, gameRoomId, lobbyRoomId } from "../src/realtime/eventHub.js";
import { InMemorySocketServer } from "../src/realtime/socketServer.js";

function noticeEvent(message: string): ServerToClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "system.notice",
    payload: {
      severity: "info",
      message
    }
  };
}

function gameStateEvent(gameId: string, handNumber: number, turn: "north" | "east" | "south" | "west"): ServerToClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "game.state",
    payload: {
      gameId,
      handNumber,
      trickNumber: handNumber,
      dealer: "north",
      turn,
      trump: "hearts",
      scores: {
        teamA: 0,
        teamB: 0
      }
    }
  };
}

function createCollector(asyncDelay = false): {
  events: ServerToClientEvent[];
  send: (event: ServerToClientEvent) => void | Promise<void>;
} {
  const events: ServerToClientEvent[] = [];
  const send = async (event: ServerToClientEvent): Promise<void> => {
    if (asyncDelay) {
      await Promise.resolve();
    }
    events.push(event);
  };

  return {
    events,
    send
  };
}

test("event hub rejects non-authoritative broadcasts", async () => {
  const lobbyId = parseLobbyIdOrThrow("lobby-1");
  const sessionId = parseSessionIdOrThrow("session-1");
  const collector = createCollector();
  const hub = new InMemoryEventHub();
  hub.connectSession({ sessionId, send: collector.send });
  hub.joinRoom(sessionId, lobbyRoomId(lobbyId));

  const result = await hub.publish({
    source: "external",
    roomId: lobbyRoomId(lobbyId),
    events: [noticeEvent("blocked")]
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected unauthorized-source rejection.");
  }
  assert.equal(result.code, "UNAUTHORIZED_SOURCE");
  assert.deepEqual(collector.events, []);
});

test("socket server fans out ordered batches to room members with payload parity", async () => {
  const lobbyId = parseLobbyIdOrThrow("lobby-1");
  const otherLobbyId = parseLobbyIdOrThrow("lobby-2");
  const sessionA = parseSessionIdOrThrow("session-A");
  const sessionB = parseSessionIdOrThrow("session-B");
  const sessionC = parseSessionIdOrThrow("session-C");

  const collectorA = createCollector();
  const collectorB = createCollector(true);
  const collectorC = createCollector();

  const socketServer = new InMemorySocketServer();
  socketServer.connectSession({ sessionId: sessionA, send: collectorA.send });
  socketServer.connectSession({ sessionId: sessionB, send: collectorB.send });
  socketServer.connectSession({ sessionId: sessionC, send: collectorC.send });
  socketServer.bindSessionToLobby(sessionA, lobbyId);
  socketServer.bindSessionToLobby(sessionB, lobbyId);
  socketServer.bindSessionToLobby(sessionC, otherLobbyId);

  const batch = [noticeEvent("one"), noticeEvent("two"), noticeEvent("three")] as const;
  const result = await socketServer.broadcastLobbyEvents(lobbyId, batch);

  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  assert.deepEqual(result.deliveredSessionIds, [sessionA, sessionB]);
  assert.equal(result.deliveredEventCount, 6);
  assert.deepEqual(collectorA.events, batch);
  assert.deepEqual(collectorB.events, batch);
  assert.deepEqual(collectorC.events, []);

  const firstA = collectorA.events[0];
  const firstB = collectorB.events[0];
  assert.ok(firstA);
  assert.ok(firstB);
  assert.notEqual(firstA, firstB);
  if (firstA.type === "system.notice") {
    firstA.payload.message = "mutated";
  }
  if (firstB.type !== "system.notice") {
    throw new Error("Expected system.notice event.");
  }
  assert.equal(firstB.payload.message, "one");
});

test("socket server uses lobby/game keyed rooms and honors unbind/disconnect", async () => {
  const lobbyId = parseLobbyIdOrThrow("lobby-1");
  const gameId = parseGameIdOrThrow("game-1");
  const sessionA = parseSessionIdOrThrow("session-A");
  const sessionB = parseSessionIdOrThrow("session-B");

  const collectorA = createCollector();
  const collectorB = createCollector();
  const socketServer = new InMemorySocketServer();
  socketServer.connectSession({ sessionId: sessionA, send: collectorA.send });
  socketServer.connectSession({ sessionId: sessionB, send: collectorB.send });

  assert.equal(socketServer.bindSessionToLobby(sessionA, lobbyId), true);
  assert.equal(socketServer.bindSessionToGame(sessionA, gameId), true);
  assert.equal(socketServer.bindSessionToGame(sessionB, gameId), true);
  assert.deepEqual(socketServer.listSessionRooms(sessionA), [
    lobbyRoomId(lobbyId),
    gameRoomId(gameId)
  ]);

  await socketServer.broadcastGameEvents(gameId, [
    gameStateEvent("game-1", 1, "north")
  ]);
  assert.equal(collectorA.events.length, 1);
  assert.equal(collectorB.events.length, 1);

  assert.equal(socketServer.unbindSessionFromGame(sessionB, gameId), true);
  socketServer.disconnectSession(sessionA);
  await socketServer.broadcastGameEvents(gameId, [gameStateEvent("game-1", 2, "east")]);
  await socketServer.broadcastLobbyEvents(lobbyId, [noticeEvent("post-disconnect")]);

  assert.equal(collectorA.events.length, 1);
  assert.equal(collectorB.events.length, 1);
});
