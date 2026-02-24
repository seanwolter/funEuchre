import type { ServerToClientEvent, Team } from "@fun-euchre/protocol";
import { createTeamScore, type GameState } from "@fun-euchre/game-rules";
import { toActionRejectedEvent, toGameStateEvent, toSystemNoticeEvent } from "./protocolAdapter.js";
import type { LobbyState } from "./lobby.js";
import type { GameId, PlayerId } from "./types.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";

export const MIN_RECONNECT_GRACE_MS = 60_000;
export const MIN_GAME_RETENTION_MS = 15 * 60_000;

export type ReconnectPolicyOptions = {
  reconnectGraceMs?: number;
  gameRetentionMs?: number;
};

export type ReconnectSessionSnapshot = {
  connected: boolean;
  reconnectByMs: number | null;
  updatedAtMs: number;
};

export type ReconnectLifecycleState =
  | "active"
  | "grace_period"
  | "forfeit_due"
  | "retention_expired";

export type ReconnectLifecycle = {
  state: ReconnectLifecycleState;
  reconnectByMs: number | null;
  retentionByMs: number;
};

export type ReconnectForfeitSuccess = {
  ok: true;
  state: GameState;
  winningTeam: Team;
  outbound: ServerToClientEvent[];
};

export type ReconnectForfeitFailure = {
  ok: false;
  code: "INVALID_ACTION" | "INVALID_STATE";
  message: string;
  outbound: ServerToClientEvent[];
};

export type ReconnectForfeitResult = ReconnectForfeitSuccess | ReconnectForfeitFailure;

export type ReconnectPolicy = {
  reconnectGraceMs: number;
  gameRetentionMs: number;
  reconnectDeadlineFromDisconnect(disconnectedAtMs: number): number;
  retentionDeadlineFromActivity(updatedAtMs: number): number;
  evaluateSessionLifecycle(
    session: ReconnectSessionSnapshot,
    nowMs: number
  ): ReconnectLifecycle;
  shouldForfeit(session: ReconnectSessionSnapshot, nowMs: number): boolean;
  isRetentionExpired(session: ReconnectSessionSnapshot, nowMs: number): boolean;
};

function assertMinimumWindow(value: number, minimum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
}

function opposingTeam(team: Team): Team {
  return team === "teamA" ? "teamB" : "teamA";
}

function findPlayerTeam(lobbyState: LobbyState, playerId: PlayerId): Team | null {
  for (const seat of lobbyState.seats) {
    if (seat.playerId === playerId) {
      return seat.team;
    }
  }

  return null;
}

export function createReconnectPolicy(
  options: ReconnectPolicyOptions = {}
): ReconnectPolicy {
  const reconnectGraceMs = options.reconnectGraceMs ?? MIN_RECONNECT_GRACE_MS;
  const gameRetentionMs = options.gameRetentionMs ?? MIN_GAME_RETENTION_MS;

  assertMinimumWindow(reconnectGraceMs, MIN_RECONNECT_GRACE_MS, "reconnectGraceMs");
  assertMinimumWindow(gameRetentionMs, MIN_GAME_RETENTION_MS, "gameRetentionMs");

  function reconnectDeadlineFromDisconnect(disconnectedAtMs: number): number {
    return disconnectedAtMs + reconnectGraceMs;
  }

  function retentionDeadlineFromActivity(updatedAtMs: number): number {
    return updatedAtMs + gameRetentionMs;
  }

  function evaluateSessionLifecycle(
    session: ReconnectSessionSnapshot,
    nowMs: number
  ): ReconnectLifecycle {
    const retentionByMs = retentionDeadlineFromActivity(session.updatedAtMs);

    if (session.connected) {
      return {
        state: "active",
        reconnectByMs: null,
        retentionByMs
      };
    }

    if (nowMs > retentionByMs) {
      return {
        state: "retention_expired",
        reconnectByMs: session.reconnectByMs,
        retentionByMs
      };
    }

    if (session.reconnectByMs !== null && nowMs <= session.reconnectByMs) {
      return {
        state: "grace_period",
        reconnectByMs: session.reconnectByMs,
        retentionByMs
      };
    }

    return {
      state: "forfeit_due",
      reconnectByMs: session.reconnectByMs,
      retentionByMs
    };
  }

  function shouldForfeit(session: ReconnectSessionSnapshot, nowMs: number): boolean {
    return evaluateSessionLifecycle(session, nowMs).state === "forfeit_due";
  }

  function isRetentionExpired(session: ReconnectSessionSnapshot, nowMs: number): boolean {
    return evaluateSessionLifecycle(session, nowMs).state === "retention_expired";
  }

  return {
    reconnectGraceMs,
    gameRetentionMs,
    reconnectDeadlineFromDisconnect,
    retentionDeadlineFromActivity,
    evaluateSessionLifecycle,
    shouldForfeit,
    isRetentionExpired
  };
}

export type ResolveReconnectForfeitInput = {
  gameId: GameId;
  state: GameState;
  lobbyState: LobbyState;
  forfeitingPlayerId: PlayerId;
  requestId?: string | null;
  logger?: StructuredLogger;
};

export function resolveReconnectForfeit(
  input: ResolveReconnectForfeitInput
): ReconnectForfeitResult {
  const logger = input.logger ?? createNoopLogger();

  if (input.state.phase === "completed") {
    const message = `Game "${input.gameId}" is already completed.`;
    return {
      ok: false,
      code: "INVALID_STATE",
      message,
      outbound: [toActionRejectedEvent(null, "INVALID_STATE", message)]
    };
  }

  const forfeitingTeam = findPlayerTeam(input.lobbyState, input.forfeitingPlayerId);
  if (!forfeitingTeam) {
    const message = `Player "${input.forfeitingPlayerId}" is not seated in lobby "${input.lobbyState.lobbyId}".`;
    return {
      ok: false,
      code: "INVALID_ACTION",
      message,
      outbound: [toActionRejectedEvent(null, "INVALID_ACTION", message)]
    };
  }

  const winningTeam = opposingTeam(forfeitingTeam);
  const scores = createTeamScore(input.state.scores.teamA, input.state.scores.teamB);
  if (scores[winningTeam] < input.state.targetScore) {
    scores[winningTeam] = input.state.targetScore;
  }

  const nextState: GameState = {
    ...input.state,
    phase: "completed",
    scores,
    winner: winningTeam
  };

  const noticeMessage = `Player "${input.forfeitingPlayerId}" failed to reconnect before timeout. ${winningTeam} wins by forfeit.`;
  logger.logForfeit({
    message: noticeMessage,
    lobbyId: input.lobbyState.lobbyId,
    gameId: input.gameId,
    playerId: input.forfeitingPlayerId,
    requestId: input.requestId ?? null,
    metadata: {
      winningTeam
    }
  });

  return {
    ok: true,
    state: nextState,
    winningTeam,
    outbound: [
      toSystemNoticeEvent("warning", noticeMessage),
      toGameStateEvent(input.gameId, nextState)
    ]
  };
}
