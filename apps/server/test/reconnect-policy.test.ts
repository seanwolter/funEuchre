import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialGameState,
  createTeamScore,
  createTrickState,
  type Card,
  type GameState
} from "@fun-euchre/game-rules";
import {
  MIN_GAME_RETENTION_MS,
  MIN_RECONNECT_GRACE_MS,
  createReconnectPolicy,
  resolveReconnectForfeit
} from "../src/domain/reconnectPolicy.js";
import {
  parseGameIdOrThrow,
  parseLobbyIdOrThrow,
  parsePlayerIdOrThrow
} from "../src/domain/ids.js";
import {
  createLobbyState,
  joinLobby,
  type LobbyState,
  type LobbyTransitionResult
} from "../src/domain/lobby.js";

const GAME_ID = parseGameIdOrThrow("game-1");

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function buildPlayState(): GameState {
  const base = createInitialGameState({
    dealer: "north",
    handNumber: 1,
    scores: createTeamScore(0, 0)
  });

  return {
    ...base,
    phase: "play",
    hands: {
      north: [card("clubs", "9")],
      east: [card("clubs", "A")],
      south: [card("spades", "9")],
      west: [card("diamonds", "9")]
    },
    upcard: card("hearts", "10"),
    kitty: [card("clubs", "10"), card("clubs", "J"), card("clubs", "Q")],
    bidding: null,
    trump: "hearts",
    maker: "north",
    alone: false,
    partnerSitsOut: null,
    trick: createTrickState("north", "hearts"),
    tricksWon: createTeamScore(),
    lastHand: null,
    winner: null
  };
}

function expectLobbySuccess(result: LobbyTransitionResult): LobbyState {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.state;
}

function buildLobbyState(): LobbyState {
  let lobby = createLobbyState({
    lobbyId: parseLobbyIdOrThrow("lobby-1"),
    hostPlayerId: parsePlayerIdOrThrow("player-1"),
    hostDisplayName: "Host"
  });

  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-2"),
      displayName: "East"
    })
  );
  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-3"),
      displayName: "South"
    })
  );
  lobby = expectLobbySuccess(
    joinLobby(lobby, {
      playerId: parsePlayerIdOrThrow("player-4"),
      displayName: "West"
    })
  );

  return lobby;
}

test("createReconnectPolicy enforces minimum reconnect and retention windows", () => {
  const defaults = createReconnectPolicy();
  assert.equal(defaults.reconnectGraceMs, MIN_RECONNECT_GRACE_MS);
  assert.equal(defaults.gameRetentionMs, MIN_GAME_RETENTION_MS);
  assert.equal(defaults.reconnectDeadlineFromDisconnect(10_000), 10_000 + MIN_RECONNECT_GRACE_MS);
  assert.equal(defaults.retentionDeadlineFromActivity(10_000), 10_000 + MIN_GAME_RETENTION_MS);

  assert.throws(
    () =>
      createReconnectPolicy({
        reconnectGraceMs: MIN_RECONNECT_GRACE_MS - 1
      }),
    /reconnectGraceMs/
  );
  assert.throws(
    () =>
      createReconnectPolicy({
        gameRetentionMs: MIN_GAME_RETENTION_MS - 1
      }),
    /gameRetentionMs/
  );
});

test("reconnect policy lifecycle is deterministic across active, grace, forfeit, and retention expiry", () => {
  const policy = createReconnectPolicy({
    reconnectGraceMs: MIN_RECONNECT_GRACE_MS,
    gameRetentionMs: MIN_GAME_RETENTION_MS
  });
  const base = 1_000_000;
  const snapshot = {
    connected: false,
    reconnectByMs: base + MIN_RECONNECT_GRACE_MS,
    updatedAtMs: base
  };

  const active = policy.evaluateSessionLifecycle(
    {
      ...snapshot,
      connected: true
    },
    base + 1
  );
  assert.equal(active.state, "active");

  const grace = policy.evaluateSessionLifecycle(snapshot, base + MIN_RECONNECT_GRACE_MS);
  assert.equal(grace.state, "grace_period");
  assert.equal(policy.shouldForfeit(snapshot, base + MIN_RECONNECT_GRACE_MS), false);

  const forfeitDue = policy.evaluateSessionLifecycle(snapshot, base + MIN_RECONNECT_GRACE_MS + 1);
  assert.equal(forfeitDue.state, "forfeit_due");
  assert.equal(policy.shouldForfeit(snapshot, base + MIN_RECONNECT_GRACE_MS + 1), true);
  assert.equal(
    policy.isRetentionExpired(snapshot, base + MIN_RECONNECT_GRACE_MS + 1),
    false
  );

  const retentionExpired = policy.evaluateSessionLifecycle(
    snapshot,
    base + MIN_GAME_RETENTION_MS + 1
  );
  assert.equal(retentionExpired.state, "retention_expired");
  assert.equal(policy.shouldForfeit(snapshot, base + MIN_GAME_RETENTION_MS + 1), false);
  assert.equal(
    policy.isRetentionExpired(snapshot, base + MIN_GAME_RETENTION_MS + 1),
    true
  );
});

test("resolveReconnectForfeit emits clear notice and terminal game state for opposing team", () => {
  const lobby = buildLobbyState();
  const state = buildPlayState();

  const result = resolveReconnectForfeit({
    gameId: GAME_ID,
    state,
    lobbyState: lobby,
    forfeitingPlayerId: parsePlayerIdOrThrow("player-1")
  });
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }

  assert.equal(result.winningTeam, "teamB");
  assert.equal(result.state.phase, "completed");
  assert.equal(result.state.winner, "teamB");
  assert.equal(result.state.scores.teamB, state.targetScore);
  assert.equal(result.outbound[0]?.type, "system.notice");
  assert.deepEqual(result.outbound[0], {
    version: 1,
    type: "system.notice",
    payload: {
      severity: "warning",
      message: 'Player "player-1" failed to reconnect before timeout. teamB wins by forfeit.'
    }
  });
  assert.equal(result.outbound[1]?.type, "game.state");
  assert.deepEqual(result.outbound[1], {
    version: 1,
    type: "game.state",
    payload: {
      gameId: "game-1",
      phase: "completed",
      handNumber: state.handNumber,
      trickNumber: 0,
      dealer: state.dealer,
      turn: "east",
      trump: state.trump,
      maker: state.maker,
      alone: state.alone,
      partnerSitsOut: state.partnerSitsOut,
      bidding: null,
      trick: {
        leader: "north",
        leadSuit: null,
        complete: false,
        winner: null,
        plays: []
      },
      scores: {
        teamA: 0,
        teamB: state.targetScore
      }
    }
  });
});

test("resolveReconnectForfeit rejects invalid forfeit transitions", () => {
  const lobby = buildLobbyState();

  const unknownPlayer = resolveReconnectForfeit({
    gameId: GAME_ID,
    state: buildPlayState(),
    lobbyState: lobby,
    forfeitingPlayerId: parsePlayerIdOrThrow("player-9")
  });
  assert.equal(unknownPlayer.ok, false);
  if (unknownPlayer.ok) {
    throw new Error("Expected unknown player rejection.");
  }
  assert.equal(unknownPlayer.code, "INVALID_ACTION");
  assert.equal(unknownPlayer.outbound[0]?.type, "action.rejected");

  const completedState = createInitialGameState({
    dealer: "north",
    handNumber: 7,
    scores: createTeamScore(10, 6)
  });
  const alreadyCompleted = resolveReconnectForfeit({
    gameId: GAME_ID,
    state: {
      ...completedState,
      phase: "completed",
      winner: "teamA"
    },
    lobbyState: lobby,
    forfeitingPlayerId: parsePlayerIdOrThrow("player-2")
  });
  assert.equal(alreadyCompleted.ok, false);
  if (alreadyCompleted.ok) {
    throw new Error("Expected completed-state rejection.");
  }
  assert.equal(alreadyCompleted.code, "INVALID_STATE");
  assert.equal(alreadyCompleted.outbound[0]?.type, "action.rejected");
});
