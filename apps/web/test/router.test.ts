import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoute } from "../src/app/router.js";

test("resolveRoute accepts hash routes with query parameters", () => {
  assert.equal(resolveRoute("#/lobby?lobbyId=lobby-42"), "lobby");
  assert.equal(resolveRoute("#/game?gameId=game-7"), "game");
  assert.equal(resolveRoute("#/help?source=invite"), "help");
});

test("resolveRoute falls back to lobby for unknown routes", () => {
  assert.equal(resolveRoute("#/unknown?foo=bar"), "lobby");
});
