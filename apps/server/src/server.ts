import { createServer, type Server } from "node:http";
import { createGameRoutes } from "./http/gameRoutes.js";
import { createLobbyRoutes } from "./http/lobbyRoutes.js";
import { createAppRouter, type AppRouterOptions } from "./http/router.js";
import { createNoopLogger, type StructuredLogger } from "./observability/logger.js";

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = "0.0.0.0";

export type AppServerOptions = {
  router?: AppRouterOptions;
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
  return createServer(
    createAppRouter({
      lobbyRoutes: routerOptions.lobbyRoutes ?? createLobbyRoutes({ logger }),
      actionRoutes: routerOptions.actionRoutes ?? createGameRoutes({ logger })
    })
  );
}
