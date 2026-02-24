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

test("validateClientToServerEvent accepts bidding intent payloads", () => {
  const orderUp = validateClientToServerEvent({
    version: PROTOCOL_VERSION,
    type: "game.order_up",
    requestId: "req-order-up",
    payload: {
      gameId: "game-1",
      actorSeat: "east",
      alone: true
    }
  });
  assert.equal(orderUp.ok, true);
  if (!orderUp.ok) {
    return;
  }
  assert.equal(orderUp.data.type, "game.order_up");
  assert.equal(orderUp.data.payload.alone, true);

  const callTrump = validateClientToServerEvent({
    version: PROTOCOL_VERSION,
    type: "game.call_trump",
    requestId: "req-call-trump",
    payload: {
      gameId: "game-1",
      actorSeat: "south",
      trump: "spades"
    }
  });
  assert.equal(callTrump.ok, true);
  if (!callTrump.ok) {
    return;
  }
  assert.equal(callTrump.data.type, "game.call_trump");
  assert.equal(callTrump.data.payload.trump, "spades");
});

test("validateClientToServerEvent rejects invalid bidding intent payloads", () => {
  const invalidAlone = validateClientToServerEvent({
    version: PROTOCOL_VERSION,
    type: "game.order_up",
    requestId: "req-bad-order-up",
    payload: {
      gameId: "game-1",
      actorSeat: "east",
      alone: "yes"
    }
  });
  assert.equal(invalidAlone.ok, false);

  const invalidTrump = validateClientToServerEvent({
    version: PROTOCOL_VERSION,
    type: "game.call_trump",
    requestId: "req-bad-call-trump",
    payload: {
      gameId: "game-1",
      actorSeat: "south",
      trump: "invalid"
    }
  });
  assert.equal(invalidTrump.ok, false);
});

test("validateServerToClientEvent accepts game.state payload", () => {
  const result = validateServerToClientEvent({
    version: PROTOCOL_VERSION,
    type: "game.state",
    ordering: {
      sequence: 1,
      emittedAtMs: 1_700_000_000_001
    },
    payload: {
      gameId: "game-1",
      handNumber: 2,
      trickNumber: 1,
      dealer: "north",
      turn: "east",
      trump: "hearts",
      phase: "play",
      maker: "north",
      alone: false,
      partnerSitsOut: null,
      bidding: null,
      trick: {
        leader: "north",
        leadSuit: "clubs",
        complete: false,
        winner: null,
        plays: [
          {
            seat: "north",
            cardId: "clubs:9"
          }
        ]
      },
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
  assert.equal(result.data.payload.phase, "play");
});

test("validateServerToClientEvent accepts game.private_state payload", () => {
  const result = validateServerToClientEvent({
    version: PROTOCOL_VERSION,
    type: "game.private_state",
    ordering: {
      sequence: 2,
      emittedAtMs: 1_700_000_000_002
    },
    payload: {
      gameId: "game-1",
      seat: "north",
      phase: "play",
      handCardIds: ["clubs:9", "hearts:A"],
      legalActions: {
        playableCardIds: ["clubs:9"],
        canPass: false,
        canOrderUp: false,
        callableTrumpSuits: []
      }
    }
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.data.type, "game.private_state");
  assert.deepEqual(result.data.payload.handCardIds, ["clubs:9", "hearts:A"]);
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
      ordering: {
        sequence: 3,
        emittedAtMs: 1_700_000_000_003
      },
      payload: {
        severity: "fatal",
        message: "bad"
      }
    });
  }, /Invalid server event/);
});
