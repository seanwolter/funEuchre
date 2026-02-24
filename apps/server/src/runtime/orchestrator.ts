import { GameManager } from "../domain/gameManager.js";
import { InMemoryGameStore } from "../domain/gameStore.js";
import { createIncrementalIdFactory } from "../domain/ids.js";
import { InMemoryLobbyStore } from "../domain/lobbyStore.js";
import {
  createReconnectPolicy,
  type ReconnectPolicy
} from "../domain/reconnectPolicy.js";
import { InMemorySessionStore } from "../domain/sessionStore.js";
import type { DomainIdFactory } from "../domain/types.js";
import type { GameCommandDispatcher } from "../http/gameRoutes.js";
import type { LobbyCommandDispatcher } from "../http/lobbyRoutes.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";
import { InMemorySocketServer } from "../realtime/socketServer.js";
import { createRuntimeDispatchers } from "./dispatchers.js";

type Clock = () => number;

export type RuntimeOrchestrator = {
  idFactory: DomainIdFactory;
  lobbyStore: InMemoryLobbyStore;
  gameStore: InMemoryGameStore;
  sessionStore: InMemorySessionStore;
  reconnectPolicy: ReconnectPolicy;
  socketServer: InMemorySocketServer;
  gameManager: GameManager;
  now: Clock;
  lobbyCommandDispatcher: LobbyCommandDispatcher;
  gameCommandDispatcher: GameCommandDispatcher;
};

export type RuntimeOrchestratorOptions = {
  idFactory?: DomainIdFactory;
  lobbyStore?: InMemoryLobbyStore;
  gameStore?: InMemoryGameStore;
  sessionStore?: InMemorySessionStore;
  reconnectPolicy?: ReconnectPolicy;
  socketServer?: InMemorySocketServer;
  gameManager?: GameManager;
  clock?: Clock;
  logger?: StructuredLogger;
};

export function createRuntimeOrchestrator(
  options: RuntimeOrchestratorOptions = {}
): RuntimeOrchestrator {
  const now = options.clock ?? (() => Date.now());
  const logger = options.logger ?? createNoopLogger();
  const idFactory = options.idFactory ?? createIncrementalIdFactory({ prefix: "runtime" });
  const lobbyStore = options.lobbyStore ?? new InMemoryLobbyStore({ clock: now });
  const gameStore = options.gameStore ?? new InMemoryGameStore({ clock: now });
  const sessionStore =
    options.sessionStore ??
    new InMemorySessionStore({
      clock: now,
      logger
    });
  const reconnectPolicy = options.reconnectPolicy ?? createReconnectPolicy();
  const socketServer = options.socketServer ?? new InMemorySocketServer();
  const gameManager = options.gameManager ?? new GameManager({ gameStore });
  const dispatchers = createRuntimeDispatchers({
    idFactory,
    lobbyStore,
    gameStore,
    sessionStore,
    reconnectPolicy,
    socketServer,
    gameManager,
    now
  });

  return {
    idFactory,
    lobbyStore,
    gameStore,
    sessionStore,
    reconnectPolicy,
    socketServer,
    gameManager,
    now,
    lobbyCommandDispatcher: dispatchers.lobbyCommandDispatcher,
    gameCommandDispatcher: dispatchers.gameCommandDispatcher
  };
}
