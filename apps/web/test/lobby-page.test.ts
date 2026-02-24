import assert from "node:assert/strict";
import test from "node:test";
import type { LobbyStatePayload } from "@fun-euchre/protocol";
import { renderSeatGrid } from "../src/components/SeatGrid.js";
import { deriveStartReadiness } from "../src/components/StartControls.js";
import { buildInviteLink, resolveInviteLobbyId } from "../src/pages/lobbyInvite.js";

const connectedLobby: LobbyStatePayload = {
  lobbyId: "lobby-42",
  hostPlayerId: "player-north",
  phase: "waiting",
  seats: [
    {
      seat: "north",
      team: "teamA",
      playerId: "player-north",
      displayName: "Host",
      connected: true
    },
    {
      seat: "east",
      team: "teamB",
      playerId: "player-east",
      displayName: "East",
      connected: true
    },
    {
      seat: "south",
      team: "teamA",
      playerId: "player-south",
      displayName: "South",
      connected: true
    },
    {
      seat: "west",
      team: "teamB",
      playerId: "player-west",
      displayName: "West",
      connected: true
    }
  ]
};

test("seat grid renders seat assignment and connected state labels", () => {
  const markup = renderSeatGrid({
    lobby: {
      ...connectedLobby,
      seats: connectedLobby.seats.map((seat) =>
        seat.seat === "west" ? { ...seat, connected: false } : seat
      )
    },
    sessionIdentity: {
      sessionId: "session-north",
      playerId: "player-north",
      lobbyId: "lobby-42",
      reconnectToken: "token-north"
    }
  });

  assert.match(markup, /Host/);
  assert.match(markup, /You/);
  assert.match(markup, /Disconnected/);
  assert.match(markup, /Team B/);
});

test("start readiness is enabled only for host when all seats are connected", () => {
  const hostReadiness = deriveStartReadiness({
    lobby: connectedLobby,
    sessionIdentity: {
      sessionId: "session-north",
      playerId: "player-north",
      lobbyId: "lobby-42",
      reconnectToken: "token-north"
    }
  });
  assert.equal(hostReadiness.canStart, true);
  assert.equal(hostReadiness.disabledReason, "All players are ready.");

  const nonHostReadiness = deriveStartReadiness({
    lobby: connectedLobby,
    sessionIdentity: {
      sessionId: "session-east",
      playerId: "player-east",
      lobbyId: "lobby-42",
      reconnectToken: "token-east"
    }
  });
  assert.equal(nonHostReadiness.canStart, false);
  assert.match(nonHostReadiness.disabledReason, /Only the host/);
});

test("start readiness reports pending seats and disconnected players", () => {
  const partialLobby: LobbyStatePayload = {
    ...connectedLobby,
    seats: connectedLobby.seats.map((seat) =>
      seat.seat === "west"
        ? { ...seat, playerId: null, displayName: null, connected: false }
        : seat.seat === "east"
          ? { ...seat, connected: false }
          : seat
    )
  };

  const readiness = deriveStartReadiness({
    lobby: partialLobby,
    sessionIdentity: {
      sessionId: "session-north",
      playerId: "player-north",
      lobbyId: "lobby-42",
      reconnectToken: "token-north"
    }
  });

  assert.equal(readiness.canStart, false);
  assert.equal(readiness.waitingSeats, 1);
  assert.match(readiness.disabledReason, /open seat/);
});

test("invite link helper encodes and resolves lobby id from URL", () => {
  const inviteLink = buildInviteLink(
    "http://127.0.0.1:5173/#/game?ignored=true",
    "lobby-42"
  );

  assert.match(inviteLink, /lobbyId=lobby-42/);
  assert.match(inviteLink, /#\/lobby$/);
  assert.equal(resolveInviteLobbyId(inviteLink), "lobby-42");
});

test("invite link helper can override origin for cross-device sharing", () => {
  const inviteLink = buildInviteLink(
    "http://127.0.0.1:5173/#/lobby",
    "lobby-42",
    "http://192.168.1.20:5173"
  );

  assert.match(inviteLink, /^http:\/\/192\.168\.1\.20:5173\//);
  assert.match(inviteLink, /lobbyId=lobby-42/);
});
