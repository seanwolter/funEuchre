import { createServer, type Server } from "node:http";
import { createGameRoutes } from "./http/gameRoutes.js";
import { createLobbyRoutes } from "./http/lobbyRoutes.js";
import { createAppRouter, type AppRouterOptions } from "./http/router.js";
import { createNoopLogger, type StructuredLogger } from "./observability/logger.js";
import { createWsServer } from "./realtime/wsServer.js";
import {
  createRuntimeOrchestrator,
  type RuntimeOrchestrator
} from "./runtime/orchestrator.js";

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = "0.0.0.0";

export type AppServerOptions = {
  router?: AppRouterOptions;
  runtime?: RuntimeOrchestrator;
  logger?: StructuredLogger;
};

export function resolvePort(rawPort: string | undefined): number {
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_PORT;
  }

  return parsed;
}

export function createAppServer(options: AppServerOptions = {}): Server {
  const routerOptions = options.router ?? {};
  const logger = options.logger ?? createNoopLogger();
  const needsDefaultLobbyRoutes = routerOptions.lobbyRoutes === undefined;
  const needsDefaultActionRoutes = routerOptions.actionRoutes === undefined;
  const runtime =
    needsDefaultLobbyRoutes || needsDefaultActionRoutes
      ? options.runtime ?? createRuntimeOrchestrator({ logger })
      : null;
  const lobbyRoutes =
    routerOptions.lobbyRoutes ??
    createLobbyRoutes(
      runtime
        ? {
            logger,
            dispatchCommand: runtime.lobbyCommandDispatcher
          }
        : {
            logger
          }
    );
  const actionRoutes =
    routerOptions.actionRoutes ??
    createGameRoutes(
      runtime
        ? {
            logger,
            dispatchCommand: runtime.gameCommandDispatcher
          }
        : {
            logger
          }
    );

  const server = createServer(
    createAppRouter({
      lobbyRoutes,
      actionRoutes
    })
  );
  const wsServerHandle =
    runtime !== null
      ? createWsServer({
          server,
          runtime,
          logger
        })
      : null;
  if (runtime) {
    server.once("close", () => {
      wsServerHandle?.close();
    });
  }

  return server;
}
