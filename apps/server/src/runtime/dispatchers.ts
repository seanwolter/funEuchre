import type { RejectCode, ServerToClientEvent } from "@fun-euchre/protocol";
import { applyGameAction, createInitialGameState } from "@fun-euchre/game-rules";
import { GameManager } from "../domain/gameManager.js";
import type { InMemoryGameStore } from "../domain/gameStore.js";
import { parseGameId } from "../domain/ids.js";
import {
  createLobbyState,
  joinLobby,
  setLobbyPlayerConnection,
  startLobbyGame,
  updateLobbyDisplayName
} from "../domain/lobby.js";
import type { InMemoryLobbyStore } from "../domain/lobbyStore.js";
import { toGameStateEvent, toLobbyStateEvent } from "../domain/protocolAdapter.js";
import type { ReconnectPolicy } from "../domain/reconnectPolicy.js";
import {
  toSessionIdentity,
  type InMemorySessionStore
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
import { InMemorySocketServer } from "../realtime/socketServer.js";

type RuntimeDispatcherDependencies = {
  idFactory: DomainIdFactory;
  lobbyStore: InMemoryLobbyStore;
  gameStore: InMemoryGameStore;
  sessionStore: InMemorySessionStore;
  reconnectPolicy: ReconnectPolicy;
  socketServer: InMemorySocketServer;
  gameManager: GameManager;
  now?: () => number;
};

export type RuntimeDispatchers = {
  lobbyCommandDispatcher: LobbyCommandDispatcher;
  gameCommandDispatcher: GameCommandDispatcher;
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
  socketServer: InMemorySocketServer,
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

export function createRuntimeDispatchers(
  dependencies: RuntimeDispatcherDependencies
): RuntimeDispatchers {
  const now = dependencies.now ?? (() => Date.now());

  const lobbyCommandDispatcher: LobbyCommandDispatcher = async (command) => {
    switch (command.kind) {
      case "lobby.create": {
        const lobbyId = dependencies.idFactory.nextLobbyId();
        const hostPlayerId = dependencies.idFactory.nextPlayerId();
        const sessionId = dependencies.idFactory.nextSessionId();
        const reconnectToken = dependencies.idFactory.nextReconnectToken();

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
          const reconnectSession = dependencies.sessionStore.findByReconnectToken(
            command.reconnectToken
          );
          if (!reconnectSession) {
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
        const reconnectToken = dependencies.idFactory.nextReconnectToken();
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
    await publishGameOutbound(dependencies, command.gameId, submitted.outbound);
    return {
      ok: true,
      outbound: submitted.outbound
    } satisfies GameCommandDispatchResult;
  };

  return {
    lobbyCommandDispatcher,
    gameCommandDispatcher
  };
}
