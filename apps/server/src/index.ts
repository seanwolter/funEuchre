import {
  resolveRuntimeConfig,
  toRuntimeConfigLogMetadata
} from "./config/runtimeConfig.js";
import { DEFAULT_HOST, createAppServer, resolvePort } from "./server.js";
import { createConsoleStructuredLogger } from "./observability/logger.js";

const port = resolvePort(process.env.PORT);
const host = process.env.HOST ?? DEFAULT_HOST;
const logger = createConsoleStructuredLogger();
const runtimeConfig = resolveRuntimeConfig(process.env);
const server = createAppServer({
  logger,
  runtimeConfig
});

server.listen(port, host, () => {
  logger.logServerLifecycle({
    phase: "starting",
    message: "fun-euchre server listening",
    metadata: {
      host,
      port,
      runtimeConfig: toRuntimeConfigLogMetadata(runtimeConfig)
    }
  });
});

function shutdown(signal: NodeJS.Signals): void {
  logger.logServerLifecycle({
    phase: "stopping",
    message: "received shutdown signal",
    metadata: { signal }
  });
  server.close(() => {
    logger.logServerLifecycle({
      phase: "stopped",
      message: "fun-euchre server shutdown complete",
      metadata: { signal }
    });
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
