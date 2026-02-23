import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_VERSION,
  parseClientToServerEvent,
  parseServerToClientEvent,
  validateClientToServerEvent,
  validateServerToClientEvent
} from "../src/index.js";

test("validateClientToServerEvent accepts lobby.create payload", () => {
  const result = validateClientToServerEvent({
    version: PROTOCOL_VERSION,
    type: "lobby.create",
    requestId: "req-1",
    payload: {
      displayName: "Sean"
    }
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.data.type, "lobby.create");
  assert.equal(result.data.payload.displayName, "Sean");
});

test("validateClientToServerEvent rejects malformed payload", () => {
  const result = validateClientToServerEvent({
    version: PROTOCOL_VERSION,
    type: "lobby.join",
    requestId: "req-2",
    payload: {
      lobbyId: "",
      displayName: "Player"
    }
  });

  assert.equal(result.ok, false);
});

test("validateServerToClientEvent accepts game.state payload", () => {
  const result = validateServerToClientEvent({
    version: PROTOCOL_VERSION,
    type: "game.state",
    payload: {
      gameId: "game-1",
      handNumber: 2,
      trickNumber: 1,
      dealer: "north",
      turn: "east",
      trump: "hearts",
      scores: {
        teamA: 3,
        teamB: 2
      }
    }
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.data.type, "game.state");
  assert.equal(result.data.payload.scores.teamA, 3);
});

test("parse functions throw on invalid payloads", () => {
  assert.throws(() => {
    parseClientToServerEvent({
      version: PROTOCOL_VERSION,
      type: "lobby.start",
      requestId: "req-3",
      payload: {
        lobbyId: "lobby-1"
      }
    });
  }, /Invalid client event/);

  assert.throws(() => {
    parseServerToClientEvent({
      version: PROTOCOL_VERSION,
      type: "system.notice",
      payload: {
        severity: "fatal",
        message: "bad"
      }
    });
  }, /Invalid server event/);
});
