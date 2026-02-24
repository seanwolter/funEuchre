import { createServer, type Server } from "node:http";
import {
  createDefaultRuntimeConfig,
  type RuntimeConfig
} from "./config/runtimeConfig.js";
import { createGameRoutes } from "./http/gameRoutes.js";
import { createLobbyRoutes } from "./http/lobbyRoutes.js";
import { createAppRouter, type AppRouterOptions } from "./http/router.js";
import { createNoopLogger, type StructuredLogger } from "./observability/logger.js";
import {
  createOperationalMetrics,
  type OperationalMetrics
} from "./observability/metrics.js";
import { createWsServer } from "./realtime/wsServer.js";
import { RuntimeSnapshotCheckpointer } from "./runtime/persistence/checkpointer.js";
import { FileRuntimeSnapshotRepository } from "./runtime/persistence/fileSnapshotRepository.js";
import {
  applyRuntimeSnapshot,
  createRuntimeSnapshot
} from "./runtime/persistence/runtimeSnapshot.js";
import { ReconnectLifecycleSweeper } from "./runtime/reconnectLifecycleSweeper.js";
import {
  createRuntimeOrchestrator,
  type RuntimeOrchestrator
} from "./runtime/orchestrator.js";

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = "0.0.0.0";

export type AppServerOptions = {
  router?: AppRouterOptions;
  runtime?: RuntimeOrchestrator;
  runtimeConfig?: RuntimeConfig;
  logger?: StructuredLogger;
  metrics?: OperationalMetrics;
};

export function resolvePort(rawPort: string | undefined): number {
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_PORT;
  }

  return parsed;
}

function normalizeRestoredConnectionState(runtime: RuntimeOrchestrator, nowMs: number): void {
  const reconnectByMs = runtime.reconnectPolicy.reconnectDeadlineFromDisconnect(nowMs);
  runtime.sessionStore.replaceAll(
    runtime.sessionStore.listRecords().map((record) => ({
      ...record,
      connected: false,
      reconnectByMs,
      updatedAtMs: nowMs
    }))
  );

  runtime.lobbyStore.replaceAll(
    runtime.lobbyStore.listRecords().map((record) => ({
      ...record,
      updatedAtMs: nowMs,
      state: {
        ...record.state,
        seats: record.state.seats.map((seat) => ({
          ...seat,
          connected: false
        }))
      }
    }))
  );
}

export function createAppServer(options: AppServerOptions = {}): Server {
  const routerOptions = options.router ?? {};
  const logger = options.logger ?? createNoopLogger();
  const runtimeConfig = options.runtimeConfig ?? createDefaultRuntimeConfig();
  const metrics = options.metrics ?? createOperationalMetrics();
  const needsDefaultLobbyRoutes = routerOptions.lobbyRoutes === undefined;
  const needsDefaultActionRoutes = routerOptions.actionRoutes === undefined;
  let snapshotCheckpointer: RuntimeSnapshotCheckpointer | null = null;
  let reconnectLifecycleSweeper: ReconnectLifecycleSweeper | null = null;
  const requestCheckpoint = (): void => {
    snapshotCheckpointer?.schedule();
  };
  const runtimeOrchestratorOptions = {
    logger,
    runtimeConfig,
    realtimeMetrics: metrics,
    requestCheckpoint
  };
  const runtime =
    needsDefaultLobbyRoutes || needsDefaultActionRoutes
      ? options.runtime ??
        createRuntimeOrchestrator(runtimeOrchestratorOptions)
      : null;
  const snapshotRepository =
    runtime !== null &&
    runtimeConfig.persistence.mode === "file" &&
    runtimeConfig.persistence.filePath !== null
      ? new FileRuntimeSnapshotRepository({
          filePath: runtimeConfig.persistence.filePath
        })
      : null;
  if (runtime && snapshotRepository) {
    const loadResult = snapshotRepository.load();
    if (!loadResult.ok) {
      logger.logServerLifecycle({
        phase: "starting",
        message: "Runtime snapshot load failed; starting with empty in-memory state.",
        metadata: {
          sourcePath: loadResult.sourcePath,
          code: loadResult.code,
          detail: loadResult.message
        }
      });
    } else if (loadResult.snapshot) {
      applyRuntimeSnapshot(runtime, loadResult.snapshot);
      normalizeRestoredConnectionState(runtime, Date.now());
      logger.logServerLifecycle({
        phase: "starting",
        message: "Runtime snapshot restored.",
        metadata: {
          sourcePath: loadResult.sourcePath,
          generatedAtMs: loadResult.snapshot.generatedAtMs,
          lobbyCount: loadResult.snapshot.lobbyRecords.length,
          gameCount: loadResult.snapshot.gameRecords.length,
          sessionCount: loadResult.snapshot.sessionRecords.length
        }
      });
    } else {
      logger.logServerLifecycle({
        phase: "starting",
        message: "No runtime snapshot found; starting with empty in-memory state.",
        metadata: {
          sourcePath: loadResult.sourcePath
        }
      });
    }

    snapshotCheckpointer = new RuntimeSnapshotCheckpointer({
      repository: snapshotRepository,
      runtime,
      logger
    });
  }
  if (runtime) {
    reconnectLifecycleSweeper = new ReconnectLifecycleSweeper({
      runtime,
      sweepIntervalMs: runtimeConfig.lifecycleSweepIntervalMs,
      logger
    });
    reconnectLifecycleSweeper.start();
  }
  const lobbyRoutes =
    routerOptions.lobbyRoutes ??
    createLobbyRoutes(
      runtime
        ? {
            logger,
            metrics,
            dispatchCommand: runtime.lobbyCommandDispatcher
          }
        : {
            logger,
            metrics
          }
    );
  const actionRoutes =
    routerOptions.actionRoutes ??
    createGameRoutes(
      runtime
        ? {
            logger,
            metrics,
            dispatchCommand: runtime.gameCommandDispatcher
          }
        : {
            logger,
            metrics
          }
    );

  const server = createServer(
    createAppRouter({
      metrics,
      lobbyRoutes,
      actionRoutes
    })
  );
  const wsServerHandle =
    runtime !== null
      ? createWsServer({
          server,
          runtime,
          logger,
          metrics
        })
      : null;
  if (runtime) {
    server.once("close", () => {
      reconnectLifecycleSweeper?.stop();
      snapshotCheckpointer?.stop();
      if (snapshotRepository) {
        const snapshot = createRuntimeSnapshot(runtime);
        const saveResult = snapshotRepository.save(snapshot);
        if (!saveResult.ok) {
          logger.logServerLifecycle({
            phase: "stopping",
            message: "Failed to persist runtime snapshot.",
            metadata: {
              sourcePath: saveResult.sourcePath,
              code: saveResult.code,
              detail: saveResult.message
            }
          });
        } else {
          logger.logServerLifecycle({
            phase: "stopping",
            message: "Runtime snapshot persisted.",
            metadata: {
              sourcePath: saveResult.sourcePath,
              generatedAtMs: snapshot.generatedAtMs,
              lobbyCount: snapshot.lobbyRecords.length,
              gameCount: snapshot.gameRecords.length,
              sessionCount: snapshot.sessionRecords.length
            }
          });
        }
      }
      wsServerHandle?.close();
    });
  }

  return server;
}
