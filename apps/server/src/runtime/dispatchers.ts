import type { RejectCode, ServerToClientEvent } from "@fun-euchre/protocol";
import { applyGameAction, createInitialGameState } from "@fun-euchre/game-rules";
import { GameManager } from "../domain/gameManager.js";
import { parseGameId } from "../domain/ids.js";
import {
  createLobbyState,
  joinLobby,
  setLobbyPlayerConnection,
  startLobbyGame,
  updateLobbyDisplayName
} from "../domain/lobby.js";
import { toGameStateEvent, toLobbyStateEvent } from "../domain/protocolAdapter.js";
import {
  resolveReconnectForfeit,
  type ReconnectPolicy
} from "../domain/reconnectPolicy.js";
import type {
  RuntimeGameStorePort,
  RuntimeLobbyStorePort,
  RuntimeRealtimeFanoutPort,
  RuntimeSessionStorePort
} from "../domain/runtimePorts.js";
import {
  toSessionIdentity
} from "../domain/sessionStore.js";
import type {
  DomainIdFactory,
  GameId,
  LobbyId,
  SessionId
} from "../domain/types.js";
import type {
  GameCommandDispatcher,
  GameCommandDispatchFailure,
  GameCommandDispatchResult
} from "../http/gameRoutes.js";
import type {
  CommandDispatchFailure,
  LobbyCommandDispatcher
} from "../http/lobbyRoutes.js";
import {
  createNoopLogger,
  type StructuredLogger
} from "../observability/logger.js";
import type { ReconnectTokenManager } from "../security/reconnectToken.js";

type RuntimeDispatcherDependencies = {
  idFactory: DomainIdFactory;
  lobbyStore: RuntimeLobbyStorePort;
  gameStore: RuntimeGameStorePort;
  sessionStore: RuntimeSessionStorePort;
  reconnectPolicy: ReconnectPolicy;
  socketServer: RuntimeRealtimeFanoutPort;
  gameManager: GameManager;
  reconnectTokenManager: ReconnectTokenManager;
  logger?: StructuredLogger;
  requestCheckpoint?: () => void;
  now?: () => number;
};

export type ReconnectLifecycleSweepResult = {
  nowMs: number;
  evaluatedSessionCount: number;
  forfeitAppliedCount: number;
  sessionPrunedCount: number;
  gamePrunedCount: number;
  lobbyPrunedCount: number;
  checkpointRequested: boolean;
};

export type RuntimeDispatchers = {
  lobbyCommandDispatcher: LobbyCommandDispatcher;
  gameCommandDispatcher: GameCommandDispatcher;
  runLifecycleSweep: () => Promise<ReconnectLifecycleSweepResult>;
};

const NOOP_EVENT_SINK = (): void => {};

function commandFailure(code: RejectCode, message: string): CommandDispatchFailure {
  return {
    ok: false,
    code,
    message
  };
}

function gameCommandFailure(
  code: RejectCode,
  message: string
): GameCommandDispatchFailure {
  return {
    ok: false,
    code,
    message
  };
}

function bindSession(
  socketServer: RuntimeRealtimeFanoutPort,
  sessionId: SessionId,
  lobbyId: LobbyId,
  gameId: GameId | null
): void {
  if (!socketServer.hasSession(sessionId)) {
    socketServer.connectSession({
      sessionId,
      send: NOOP_EVENT_SINK
    });
  }
  socketServer.bindSessionToLobby(sessionId, lobbyId);
  if (gameId !== null) {
    socketServer.bindSessionToGame(sessionId, gameId);
  }
}

function upsertSessionGameBindings(
  dependencies: RuntimeDispatcherDependencies,
  lobbyId: LobbyId,
  gameId: GameId
): void {
  const lobbyRecord = dependencies.lobbyStore.getByLobbyId(lobbyId);
  if (!lobbyRecord) {
    return;
  }

  for (const seat of lobbyRecord.state.seats) {
    if (seat.playerId === null) {
      continue;
    }

    const existingSession = dependencies.sessionStore.findByPlayerId(seat.playerId);
    if (!existingSession) {
      continue;
    }

    const nextSession = dependencies.sessionStore.upsert({
      sessionId: existingSession.sessionId,
      playerId: existingSession.playerId,
      lobbyId: existingSession.lobbyId,
      gameId,
      reconnectToken: existingSession.reconnectToken
    });
    bindSession(dependencies.socketServer, nextSession.sessionId, lobbyId, gameId);
  }
}

function collectLobbyOutbound(
  dependencies: RuntimeDispatcherDependencies,
  lobbyId: LobbyId,
  includeGameState: boolean
): ServerToClientEvent[] {
  const lobbyRecord = dependencies.lobbyStore.getByLobbyId(lobbyId);
  if (!lobbyRecord) {
    return [];
  }

  const outbound: ServerToClientEvent[] = [toLobbyStateEvent(lobbyRecord.state)];
  if (!includeGameState) {
    return outbound;
  }

  const gameRecord = dependencies.gameStore.findByLobbyId(lobbyId);
  if (!gameRecord) {
    return outbound;
  }

  outbound.push(toGameStateEvent(gameRecord.gameId, gameRecord.state));
  return outbound;
}

async function publishLobbyOutbound(
  dependencies: RuntimeDispatcherDependencies,
  lobbyId: LobbyId,
  outbound: readonly ServerToClientEvent[]
): Promise<void> {
  for (const event of outbound) {
    if (event.type === "lobby.state") {
      await dependencies.socketServer.broadcastLobbyEvents(lobbyId, [event]);
      continue;
    }
    if (event.type !== "game.state") {
      continue;
    }

    const gameId = parseGameId(event.payload.gameId);
    if (!gameId) {
      continue;
    }
    await dependencies.socketServer.broadcastGameEvents(gameId, [event]);
  }
}

async function publishGameOutbound(
  dependencies: RuntimeDispatcherDependencies,
  gameId: GameId,
  outbound: readonly ServerToClientEvent[]
): Promise<void> {
  await dependencies.socketServer.broadcastGameEvents(gameId, outbound);
}

function createSweepResult(nowMs: number): ReconnectLifecycleSweepResult {
  return {
    nowMs,
    evaluatedSessionCount: 0,
    forfeitAppliedCount: 0,
    sessionPrunedCount: 0,
    gamePrunedCount: 0,
    lobbyPrunedCount: 0,
    checkpointRequested: false
  };
}

function isAfterDeadline(deadlineMs: number, nowMs: number): boolean {
  return nowMs > deadlineMs;
}

export function createRuntimeDispatchers(
  dependencies: RuntimeDispatcherDependencies
): RuntimeDispatchers {
  const now = dependencies.now ?? (() => Date.now());
  const logger = dependencies.logger ?? createNoopLogger();

  const lobbyCommandDispatcher: LobbyCommandDispatcher = async (command) => {
    switch (command.kind) {
      case "lobby.create": {
        const lobbyId = dependencies.idFactory.nextLobbyId();
        const hostPlayerId = dependencies.idFactory.nextPlayerId();
        const sessionId = dependencies.idFactory.nextSessionId();
        const reconnectToken = dependencies.reconnectTokenManager.issue({
          sessionId,
          lobbyId,
          playerId: hostPlayerId
        });

        const lobbyState = createLobbyState({
          lobbyId,
          hostPlayerId,
          hostDisplayName: command.displayName
        });
        dependencies.lobbyStore.upsert({ state: lobbyState });
        const nextSession = dependencies.sessionStore.upsert({
          sessionId,
          playerId: hostPlayerId,
          lobbyId,
          gameId: null,
          reconnectToken
        });
        bindSession(dependencies.socketServer, sessionId, lobbyId, null);
        dependencies.requestCheckpoint?.();
        const outbound = [toLobbyStateEvent(lobbyState)];
        await publishLobbyOutbound(dependencies, lobbyId, outbound);

        return {
          ok: true,
          outbound,
          identity: toSessionIdentity(nextSession)
        };
      }

      case "lobby.join": {
        const lobbyRecord = dependencies.lobbyStore.getByLobbyId(command.lobbyId);
        if (!lobbyRecord) {
          return commandFailure(
            "INVALID_STATE",
            `Lobby "${command.lobbyId}" was not found.`
          );
        }

        if (command.reconnectToken !== null) {
          const verifiedReconnectToken = dependencies.reconnectTokenManager.verify(
            command.reconnectToken,
            {
              expectedLobbyId: command.lobbyId
            }
          );
          if (!verifiedReconnectToken.ok) {
            return commandFailure(
              "UNAUTHORIZED",
              "Reconnect token is invalid or expired."
            );
          }
          const reconnectSession = dependencies.sessionStore.getBySessionId(
            verifiedReconnectToken.claims.sessionId
          );
          if (!reconnectSession || reconnectSession.reconnectToken !== command.reconnectToken) {
            return commandFailure(
              "UNAUTHORIZED",
              "Reconnect token is invalid or expired."
            );
          }
          if (
            reconnectSession.playerId !== verifiedReconnectToken.claims.playerId ||
            reconnectSession.lobbyId !== verifiedReconnectToken.claims.lobbyId
          ) {
            return commandFailure(
              "UNAUTHORIZED",
              "Reconnect token is invalid or expired."
            );
          }
          if (reconnectSession.lobbyId !== command.lobbyId) {
            return commandFailure(
              "UNAUTHORIZED",
              `Reconnect token does not belong to lobby "${command.lobbyId}".`
            );
          }
          if (
            dependencies.reconnectPolicy.shouldForfeit(
              reconnectSession,
              now()
            )
          ) {
            return commandFailure(
              "INVALID_STATE",
              `Reconnect window has expired for player "${reconnectSession.playerId}".`
            );
          }

          const reconnectLobby = setLobbyPlayerConnection(lobbyRecord.state, {
            playerId: reconnectSession.playerId,
            connected: true
          });
          if (!reconnectLobby.ok) {
            return commandFailure(reconnectLobby.code, reconnectLobby.message);
          }

          dependencies.lobbyStore.upsert({ state: reconnectLobby.state });

          const gameRecord = dependencies.gameStore.findByLobbyId(command.lobbyId);
          const nextSession = dependencies.sessionStore.upsert({
            sessionId: reconnectSession.sessionId,
            playerId: reconnectSession.playerId,
            lobbyId: reconnectSession.lobbyId,
            gameId: reconnectSession.gameId ?? gameRecord?.gameId ?? null,
            reconnectToken: reconnectSession.reconnectToken
          });
          bindSession(
            dependencies.socketServer,
            nextSession.sessionId,
            command.lobbyId,
            nextSession.gameId
          );
          dependencies.requestCheckpoint?.();
          const outbound = collectLobbyOutbound(
            dependencies,
            command.lobbyId,
            nextSession.gameId !== null
          );
          await publishLobbyOutbound(dependencies, command.lobbyId, outbound);

          return {
            ok: true,
            identity: toSessionIdentity(nextSession),
            outbound
          };
        }

        const playerId = dependencies.idFactory.nextPlayerId();
        const sessionId = dependencies.idFactory.nextSessionId();
        const reconnectToken = dependencies.reconnectTokenManager.issue({
          sessionId,
          lobbyId: command.lobbyId,
          playerId
        });
        const joinedLobby = joinLobby(lobbyRecord.state, {
          playerId,
          displayName: command.displayName
        });
        if (!joinedLobby.ok) {
          return commandFailure(joinedLobby.code, joinedLobby.message);
        }

        dependencies.lobbyStore.upsert({ state: joinedLobby.state });
        const gameRecord = dependencies.gameStore.findByLobbyId(command.lobbyId);
        const nextSession = dependencies.sessionStore.upsert({
          sessionId,
          playerId,
          lobbyId: command.lobbyId,
          gameId: gameRecord?.gameId ?? null,
          reconnectToken
        });
        bindSession(
          dependencies.socketServer,
          nextSession.sessionId,
          command.lobbyId,
          nextSession.gameId
        );
        dependencies.requestCheckpoint?.();
        const outbound = collectLobbyOutbound(
          dependencies,
          command.lobbyId,
          nextSession.gameId !== null
        );
        await publishLobbyOutbound(dependencies, command.lobbyId, outbound);

        return {
          ok: true,
          identity: toSessionIdentity(nextSession),
          outbound
        };
      }

      case "lobby.update_name": {
        const lobbyRecord = dependencies.lobbyStore.getByLobbyId(command.lobbyId);
        if (!lobbyRecord) {
          return commandFailure(
            "INVALID_STATE",
            `Lobby "${command.lobbyId}" was not found.`
          );
        }

        const updatedLobby = updateLobbyDisplayName(lobbyRecord.state, {
          playerId: command.playerId,
          displayName: command.displayName
        });
        if (!updatedLobby.ok) {
          return commandFailure(updatedLobby.code, updatedLobby.message);
        }

        dependencies.lobbyStore.upsert({ state: updatedLobby.state });
        dependencies.requestCheckpoint?.();
        const outbound = [toLobbyStateEvent(updatedLobby.state)];
        await publishLobbyOutbound(dependencies, command.lobbyId, outbound);
        return {
          ok: true,
          outbound
        };
      }

      case "lobby.start": {
        const lobbyRecord = dependencies.lobbyStore.getByLobbyId(command.lobbyId);
        if (!lobbyRecord) {
          return commandFailure(
            "INVALID_STATE",
            `Lobby "${command.lobbyId}" was not found.`
          );
        }

        const startedLobby = startLobbyGame(lobbyRecord.state, {
          actorPlayerId: command.actorPlayerId
        });
        if (!startedLobby.ok) {
          return commandFailure(startedLobby.code, startedLobby.message);
        }

        dependencies.lobbyStore.upsert({ state: startedLobby.state });

        const nextGameId = dependencies.idFactory.nextGameId();
        const dealtState = applyGameAction(createInitialGameState(), {
          type: "deal_hand"
        });
        if (!dealtState.ok) {
          return commandFailure(
            dealtState.reject.protocolCode,
            dealtState.reject.message
          );
        }

        dependencies.gameStore.upsert({
          gameId: nextGameId,
          lobbyId: command.lobbyId,
          state: dealtState.state
        });
        upsertSessionGameBindings(dependencies, command.lobbyId, nextGameId);
        dependencies.requestCheckpoint?.();
        const outbound = [
          toLobbyStateEvent(startedLobby.state),
          toGameStateEvent(nextGameId, dealtState.state)
        ];
        await publishLobbyOutbound(dependencies, command.lobbyId, outbound);

        return {
          ok: true,
          outbound
        };
      }
    }
  };

  const gameCommandDispatcher: GameCommandDispatcher = async (command, event) => {
    if (
      command.kind !== "game.play_card" &&
      command.kind !== "game.pass" &&
      command.kind !== "game.order_up" &&
      command.kind !== "game.call_trump"
    ) {
      return gameCommandFailure(
        "INVALID_ACTION",
        `Unsupported command kind "${command.kind}" for /actions.`
      );
    }

    const submitted = await dependencies.gameManager.submitEvent(command.gameId, event);
    if (submitted.persisted) {
      dependencies.requestCheckpoint?.();
    }
    await publishGameOutbound(dependencies, command.gameId, submitted.outbound);
    return {
      ok: true,
      outbound: submitted.outbound
    } satisfies GameCommandDispatchResult;
  };

  const runLifecycleSweep = async (): Promise<ReconnectLifecycleSweepResult> => {
    const nowMs = now();
    const result = createSweepResult(nowMs);
    const requestId = `runtime-sweep-${nowMs}`;

    const sessionRecords = dependencies.sessionStore.listRecords();
    result.evaluatedSessionCount = sessionRecords.length;

    for (const sessionRecord of sessionRecords) {
      if (sessionRecord.connected) {
        continue;
      }
      if (!dependencies.reconnectPolicy.shouldForfeit(sessionRecord, nowMs)) {
        continue;
      }

      const lobbyRecord = dependencies.lobbyStore.getByLobbyId(sessionRecord.lobbyId);
      if (!lobbyRecord) {
        continue;
      }

      const gameRecord =
        sessionRecord.gameId === null
          ? dependencies.gameStore.findByLobbyId(sessionRecord.lobbyId)
          : dependencies.gameStore.getByGameId(sessionRecord.gameId) ??
            dependencies.gameStore.findByLobbyId(sessionRecord.lobbyId);
      if (!gameRecord || gameRecord.state.phase === "completed") {
        continue;
      }

      const forfeitResult = resolveReconnectForfeit({
        gameId: gameRecord.gameId,
        state: gameRecord.state,
        lobbyState: lobbyRecord.state,
        forfeitingPlayerId: sessionRecord.playerId,
        requestId,
        logger
      });
      if (!forfeitResult.ok) {
        continue;
      }

      dependencies.gameStore.upsert({
        gameId: gameRecord.gameId,
        lobbyId: gameRecord.lobbyId,
        state: forfeitResult.state
      });
      await publishGameOutbound(dependencies, gameRecord.gameId, forfeitResult.outbound);
      result.forfeitAppliedCount += 1;
      result.checkpointRequested = true;
    }

    const retainedLobbyIds = new Set<LobbyId>();
    const retainedGameIds = new Set<GameId>();
    for (const sessionRecord of dependencies.sessionStore.listRecords()) {
      const retentionExpired =
        !sessionRecord.connected &&
        dependencies.reconnectPolicy.isRetentionExpired(sessionRecord, nowMs);
      const ttlExpired =
        sessionRecord.connected && dependencies.sessionStore.isExpired(sessionRecord, nowMs);
      if (retentionExpired || ttlExpired) {
        if (dependencies.sessionStore.deleteBySessionId(sessionRecord.sessionId)) {
          dependencies.socketServer.disconnectSession(sessionRecord.sessionId);
          result.sessionPrunedCount += 1;
          result.checkpointRequested = true;
        }
        continue;
      }

      retainedLobbyIds.add(sessionRecord.lobbyId);
      if (sessionRecord.gameId !== null) {
        retainedGameIds.add(sessionRecord.gameId);
      }
    }

    for (const gameRecord of dependencies.gameStore.listRecords()) {
      if (retainedGameIds.has(gameRecord.gameId)) {
        continue;
      }

      const retentionExpired = isAfterDeadline(
        dependencies.reconnectPolicy.retentionDeadlineFromActivity(gameRecord.updatedAtMs),
        nowMs
      );
      const ttlExpired = dependencies.gameStore.isExpired(gameRecord, nowMs);
      if (!retentionExpired && !ttlExpired) {
        continue;
      }

      if (dependencies.gameStore.deleteByGameId(gameRecord.gameId)) {
        result.gamePrunedCount += 1;
        result.checkpointRequested = true;
      }
    }

    const activeGameLobbyIds = new Set<LobbyId>();
    for (const gameRecord of dependencies.gameStore.listRecords()) {
      activeGameLobbyIds.add(gameRecord.lobbyId);
    }

    for (const lobbyRecord of dependencies.lobbyStore.listRecords()) {
      if (retainedLobbyIds.has(lobbyRecord.lobbyId)) {
        continue;
      }
      if (activeGameLobbyIds.has(lobbyRecord.lobbyId)) {
        continue;
      }

      const retentionExpired = isAfterDeadline(
        dependencies.reconnectPolicy.retentionDeadlineFromActivity(lobbyRecord.updatedAtMs),
        nowMs
      );
      const ttlExpired = dependencies.lobbyStore.isExpired(lobbyRecord, nowMs);
      if (!retentionExpired && !ttlExpired) {
        continue;
      }

      if (dependencies.lobbyStore.deleteByLobbyId(lobbyRecord.lobbyId)) {
        result.lobbyPrunedCount += 1;
        result.checkpointRequested = true;
      }
    }

    if (result.checkpointRequested) {
      dependencies.requestCheckpoint?.();
    }

    return result;
  };

  return {
    lobbyCommandDispatcher,
    gameCommandDispatcher,
    runLifecycleSweep
  };
}
