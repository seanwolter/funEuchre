import assert from "node:assert/strict";
import test from "node:test";
import type { ServerToClientEvent } from "@fun-euchre/protocol";
import { PROTOCOL_VERSION } from "@fun-euchre/protocol";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parseSessionIdOrThrow
} from "../src/domain/ids.js";
import { gameRoomId, lobbyRoomId } from "../src/realtime/broker.js";
import { InMemoryRealtimeBroker } from "../src/realtime/inMemoryBroker.js";

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

function gameStateEvent(
  gameId: string,
  handNumber: number,
  turn: "north" | "east" | "south" | "west"
): ServerToClientEvent {
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

test("broker contract rejects non-authoritative source publishes", async () => {
  const lobbyId = parseLobbyIdOrThrow("broker-lobby-1");
  const sessionId = parseSessionIdOrThrow("broker-session-1");
  const collector = createCollector();
  const broker = new InMemoryRealtimeBroker();
  broker.connectSession({ sessionId, send: collector.send });
  broker.joinRoom(sessionId, lobbyRoomId(lobbyId));

  const result = await broker.publish({
    source: "external",
    roomId: lobbyRoomId(lobbyId),
    events: [noticeEvent("blocked")]
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected unauthorized-source rejection.");
  }
  assert.equal(result.code, "UNAUTHORIZED_SOURCE");
  assert.equal(result.deliveredEventCount, 0);
  assert.deepEqual(result.deliveredSessionIds, []);
  assert.deepEqual(collector.events, []);
});

test("broker contract enforces connect/join/leave/disconnect membership lifecycle", () => {
  const lobbyId = parseLobbyIdOrThrow("broker-lobby-2");
  const sessionId = parseSessionIdOrThrow("broker-session-2");
  const collector = createCollector();
  const broker = new InMemoryRealtimeBroker();

  assert.equal(broker.hasSession(sessionId), false);
  assert.equal(broker.joinRoom(sessionId, lobbyRoomId(lobbyId)), false);

  broker.connectSession({ sessionId, send: collector.send });
  assert.equal(broker.hasSession(sessionId), true);
  assert.equal(broker.joinRoom(sessionId, lobbyRoomId(lobbyId)), true);
  assert.equal(broker.joinRoom(sessionId, lobbyRoomId(lobbyId)), true);
  assert.deepEqual(broker.listSessionRooms(sessionId), [lobbyRoomId(lobbyId)]);

  assert.equal(broker.leaveRoom(sessionId, lobbyRoomId(lobbyId)), true);
  assert.equal(broker.leaveRoom(sessionId, lobbyRoomId(lobbyId)), false);
  assert.deepEqual(broker.listSessionRooms(sessionId), []);

  broker.disconnectSession(sessionId);
  assert.equal(broker.hasSession(sessionId), false);
  assert.equal(broker.joinRoom(sessionId, lobbyRoomId(lobbyId)), false);
});

test("broker contract publishes ordered event batches with cloned payloads per subscriber", async () => {
  const lobbyId = parseLobbyIdOrThrow("broker-lobby-3");
  const otherLobbyId = parseLobbyIdOrThrow("broker-lobby-4");
  const sessionA = parseSessionIdOrThrow("broker-session-a");
  const sessionB = parseSessionIdOrThrow("broker-session-b");
  const sessionC = parseSessionIdOrThrow("broker-session-c");

  const collectorA = createCollector();
  const collectorB = createCollector(true);
  const collectorC = createCollector();

  const broker = new InMemoryRealtimeBroker();
  broker.connectSession({ sessionId: sessionA, send: collectorA.send });
  broker.connectSession({ sessionId: sessionB, send: collectorB.send });
  broker.connectSession({ sessionId: sessionC, send: collectorC.send });
  broker.joinRoom(sessionA, lobbyRoomId(lobbyId));
  broker.joinRoom(sessionB, lobbyRoomId(lobbyId));
  broker.joinRoom(sessionC, lobbyRoomId(otherLobbyId));

  const batch = [noticeEvent("one"), noticeEvent("two"), noticeEvent("three")] as const;
  const result = await broker.publish({
    source: "domain-transition",
    roomId: lobbyRoomId(lobbyId),
    events: batch
  });

  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  assert.deepEqual(result.deliveredSessionIds, [sessionA, sessionB]);
  assert.equal(result.deliveredEventCount, 6);
  assert.deepEqual(collectorA.events, batch);
  assert.deepEqual(collectorB.events, batch);
  assert.deepEqual(collectorC.events, []);
  assert.deepEqual(
    collectorA.events.map((event) => event.ordering?.sequence),
    [1, 2, 3]
  );
  assert.deepEqual(
    collectorB.events.map((event) => event.ordering?.sequence),
    [1, 2, 3]
  );

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

test("broker contract publish scope is room-local and disconnect clears membership", async () => {
  const lobbyId = parseLobbyIdOrThrow("broker-lobby-5");
  const gameId = parseGameIdOrThrow("broker-game-1");
  const sessionId = parseSessionIdOrThrow("broker-session-3");

  const collector = createCollector();
  const broker = new InMemoryRealtimeBroker();
  broker.connectSession({ sessionId, send: collector.send });
  broker.joinRoom(sessionId, lobbyRoomId(lobbyId));
  broker.joinRoom(sessionId, gameRoomId(gameId));

  const gameResult = await broker.publish({
    source: "domain-transition",
    roomId: gameRoomId(gameId),
    events: [gameStateEvent("broker-game-1", 1, "north")]
  });
  assert.equal(gameResult.ok, true);
  assert.equal(gameResult.deliveredEventCount, 1);
  assert.deepEqual(broker.listSessionRooms(sessionId), [
    lobbyRoomId(lobbyId),
    gameRoomId(gameId)
  ]);

  broker.disconnectSession(sessionId);
  const lobbyResult = await broker.publish({
    source: "domain-transition",
    roomId: lobbyRoomId(lobbyId),
    events: [noticeEvent("after-disconnect")]
  });
  assert.equal(lobbyResult.ok, true);
  assert.equal(lobbyResult.deliveredEventCount, 0);
  assert.deepEqual(broker.listSessionRooms(sessionId), []);
});
