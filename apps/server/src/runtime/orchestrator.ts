import type { RuntimeConfig } from "../config/runtimeConfig.js";
import { createDefaultRuntimeConfig } from "../config/runtimeConfig.js";
import { GameManager } from "../domain/gameManager.js";
import { InMemoryGameStore } from "../domain/gameStore.js";
import { createSecureIdFactory } from "../domain/ids.js";
import { InMemoryLobbyStore } from "../domain/lobbyStore.js";
import {
  createReconnectPolicy,
  type ReconnectPolicy
} from "../domain/reconnectPolicy.js";
import { InMemorySessionStore } from "../domain/sessionStore.js";
import type {
  RuntimeGameStorePort,
  RuntimeLobbyStorePort,
  RuntimeRealtimeFanoutPort,
  RuntimeSessionStorePort
} from "../domain/runtimePorts.js";
import type { DomainIdFactory } from "../domain/types.js";
import type { GameCommandDispatcher } from "../http/gameRoutes.js";
import type { LobbyCommandDispatcher } from "../http/lobbyRoutes.js";
import { createNoopLogger, type StructuredLogger } from "../observability/logger.js";
import type { OperationalMetrics } from "../observability/metrics.js";
import type { RealtimeBroker } from "../realtime/broker.js";
import { InMemorySocketServer, type SocketServerOptions } from "../realtime/socketServer.js";
import {
  createReconnectTokenManager,
  resolveReconnectTokenSecret,
  type ReconnectTokenManager
} from "../security/reconnectToken.js";
import {
  createRuntimeDispatchers,
  type ReconnectLifecycleSweepResult
} from "./dispatchers.js";

type Clock = () => number;

export type RuntimeOrchestrator = {
  idFactory: DomainIdFactory;
  lobbyStore: RuntimeLobbyStorePort;
  gameStore: RuntimeGameStorePort;
  sessionStore: RuntimeSessionStorePort;
  reconnectPolicy: ReconnectPolicy;
  socketServer: RuntimeRealtimeFanoutPort;
  gameManager: GameManager;
  reconnectTokenManager: ReconnectTokenManager;
  requestCheckpoint: () => void;
  now: Clock;
  lobbyCommandDispatcher: LobbyCommandDispatcher;
  gameCommandDispatcher: GameCommandDispatcher;
  runLifecycleSweep: () => Promise<ReconnectLifecycleSweepResult>;
};

export type RuntimeOrchestratorOptions = {
  runtimeConfig?: RuntimeConfig;
  idFactory?: DomainIdFactory;
  lobbyStore?: RuntimeLobbyStorePort;
  gameStore?: RuntimeGameStorePort;
  sessionStore?: RuntimeSessionStorePort;
  reconnectPolicy?: ReconnectPolicy;
  realtimeBroker?: RealtimeBroker;
  realtimeMetrics?: OperationalMetrics;
  socketServer?: RuntimeRealtimeFanoutPort;
  gameManager?: GameManager;
  reconnectTokenManager?: ReconnectTokenManager;
  requestCheckpoint?: () => void;
  clock?: Clock;
  logger?: StructuredLogger;
};

export function createRuntimeOrchestrator(
  options: RuntimeOrchestratorOptions = {}
): RuntimeOrchestrator {
  const runtimeConfig = options.runtimeConfig ?? createDefaultRuntimeConfig();
  const now = options.clock ?? (() => Date.now());
  const logger = options.logger ?? createNoopLogger();
  const requestCheckpoint = options.requestCheckpoint ?? (() => {});
  const idFactory = options.idFactory ?? createSecureIdFactory({ prefix: "runtime" });
  const lobbyStore =
    options.lobbyStore ??
    new InMemoryLobbyStore({
      clock: now,
      ttlMs: runtimeConfig.lobbyTtlMs
    });
  const gameStore =
    options.gameStore ??
    new InMemoryGameStore({
      clock: now,
      ttlMs: runtimeConfig.gameTtlMs
    });
  const sessionStore =
    options.sessionStore ??
    new InMemorySessionStore({
      clock: now,
      reconnectWindowMs: runtimeConfig.reconnectGraceMs,
      ttlMs: runtimeConfig.sessionTtlMs,
      logger
    });
  const reconnectPolicy =
    options.reconnectPolicy ??
    createReconnectPolicy({
      reconnectGraceMs: runtimeConfig.reconnectGraceMs,
      gameRetentionMs: runtimeConfig.gameRetentionMs
    });
  const reconnectTokenManager =
    options.reconnectTokenManager ??
    createReconnectTokenManager({
      secret: resolveReconnectTokenSecret(
        runtimeConfig.security.reconnectTokenSecret
      ),
      maxAgeMs: runtimeConfig.gameRetentionMs,
      now
    });
  const socketServerOptions: SocketServerOptions = {};
  if (options.realtimeBroker) {
    socketServerOptions.broker = options.realtimeBroker;
  }
  if (options.realtimeMetrics) {
    socketServerOptions.metrics = options.realtimeMetrics;
  }
  const socketServer =
    options.socketServer ??
    new InMemorySocketServer(socketServerOptions);
  const gameManager = options.gameManager ?? new GameManager({ gameStore });
  const dispatchers = createRuntimeDispatchers({
    idFactory,
    lobbyStore,
    gameStore,
    sessionStore,
    reconnectPolicy,
    socketServer,
    gameManager,
    reconnectTokenManager,
    logger,
    requestCheckpoint,
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
    reconnectTokenManager,
    requestCheckpoint,
    now,
    lobbyCommandDispatcher: dispatchers.lobbyCommandDispatcher,
    gameCommandDispatcher: dispatchers.gameCommandDispatcher,
    runLifecycleSweep: dispatchers.runLifecycleSweep
  };
}
