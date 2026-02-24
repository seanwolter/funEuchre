import assert from "node:assert/strict";
import test from "node:test";
import {
  createIncrementalIdFactory,
  isGameId,
  isLobbyId,
  isPlayerId,
  isReconnectToken,
  isSessionId,
  parseGameId,
  parseGameIdOrThrow,
  parseLobbyId,
  parseLobbyIdOrThrow,
  parsePlayerId,
  parsePlayerIdOrThrow,
  parseReconnectToken,
  parseReconnectTokenOrThrow,
  parseSessionId,
  parseSessionIdOrThrow
} from "../src/domain/ids.js";
import type { DomainIdFactory } from "../src/domain/types.js";

test("identifier parsers accept canonical values and reject malformed input", () => {
  assert.equal(parseLobbyId("lobby-1"), "lobby-1");
  assert.equal(parseGameId("game_2"), "game_2");
  assert.equal(parsePlayerId("Player-3"), "Player-3");
  assert.equal(parseSessionId("session-1"), "session-1");
  assert.equal(parseReconnectToken("reconnect-token"), "reconnect-token");

  for (const value of ["", " ", "abc def", "abc.def", "@id", "id!"] as const) {
    assert.equal(parseLobbyId(value), null);
    assert.equal(parseGameId(value), null);
    assert.equal(parsePlayerId(value), null);
    assert.equal(parseSessionId(value), null);
    assert.equal(parseReconnectToken(value), null);
  }

  assert.equal(isLobbyId("lobby-1"), true);
  assert.equal(isGameId("game-1"), true);
  assert.equal(isPlayerId("player-1"), true);
  assert.equal(isSessionId("session-1"), true);
  assert.equal(isReconnectToken("token-1"), true);
  assert.equal(isGameId("bad token"), false);
});

test("parseGameIdOrThrow throws for invalid values", () => {
  assert.equal(parseGameIdOrThrow("game-9"), "game-9");
  assert.throws(() => parseGameIdOrThrow("bad token"), /Invalid gameId/);
});

test("incremental id factory is deterministic and monotonic", () => {
  const factory = createIncrementalIdFactory({ prefix: "test", startAt: 9 });
  assert.equal(factory.nextLobbyId(), "test-lobby-10");
  assert.equal(factory.nextGameId(), "test-game-11");
  assert.equal(factory.nextPlayerId(), "test-player-12");
  assert.equal(factory.nextSessionId(), "test-session-13");
  assert.equal(factory.nextReconnectToken(), "test-reconnect-14");
});

test("domain id factory can be stubbed in tests", () => {
  const stubFactory: DomainIdFactory = {
    nextLobbyId: () => parseLobbyIdOrThrow("stub-lobby-1"),
    nextGameId: () => parseGameIdOrThrow("stub-game-1"),
    nextPlayerId: () => parsePlayerIdOrThrow("stub-player-1"),
    nextSessionId: () => parseSessionIdOrThrow("stub-session-1"),
    nextReconnectToken: () => parseReconnectTokenOrThrow("stub-reconnect-1")
  };

  assert.equal(stubFactory.nextLobbyId(), "stub-lobby-1");
  assert.equal(stubFactory.nextGameId(), "stub-game-1");
  assert.equal(stubFactory.nextPlayerId(), "stub-player-1");
  assert.equal(stubFactory.nextSessionId(), "stub-session-1");
  assert.equal(stubFactory.nextReconnectToken(), "stub-reconnect-1");
});
