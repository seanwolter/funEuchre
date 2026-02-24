import {
  MIN_GAME_RETENTION_MS,
  MIN_RECONNECT_GRACE_MS
} from "../domain/reconnectPolicy.js";

const NULL_LIKE_VALUES = new Set(["null", "none", "off", "disabled"]);
const REDACTED_SECRET = "[redacted]";

export const DEFAULT_LIFECYCLE_SWEEP_INTERVAL_MS = 5_000;
export const MIN_LIFECYCLE_SWEEP_INTERVAL_MS = 1_000;
export const DEFAULT_PERSISTENCE_FILE_PATH = "./var/fun-euchre/runtime-snapshot.json";

export const RUNTIME_PERSISTENCE_MODE_VALUES = ["disabled", "file"] as const;

export const RUNTIME_ENV_KEYS = {
  reconnectGraceMs: "FUN_EUCHRE_RECONNECT_GRACE_MS",
  gameRetentionMs: "FUN_EUCHRE_GAME_RETENTION_MS",
  sessionTtlMs: "FUN_EUCHRE_SESSION_TTL_MS",
  lobbyTtlMs: "FUN_EUCHRE_LOBBY_TTL_MS",
  gameTtlMs: "FUN_EUCHRE_GAME_TTL_MS",
  lifecycleSweepIntervalMs: "FUN_EUCHRE_LIFECYCLE_SWEEP_INTERVAL_MS",
  persistenceMode: "FUN_EUCHRE_PERSISTENCE_MODE",
  persistencePath: "FUN_EUCHRE_PERSISTENCE_PATH",
  reconnectTokenSecret: "FUN_EUCHRE_RECONNECT_TOKEN_SECRET"
} as const;

export type RuntimePersistenceMode = (typeof RUNTIME_PERSISTENCE_MODE_VALUES)[number];

export type RuntimePersistenceConfig = {
  mode: RuntimePersistenceMode;
  filePath: string | null;
};

export type RuntimeSecurityConfig = {
  reconnectTokenSecret: string | null;
};

export type RuntimeConfig = {
  reconnectGraceMs: number;
  gameRetentionMs: number;
  sessionTtlMs: number | null;
  lobbyTtlMs: number | null;
  gameTtlMs: number | null;
  lifecycleSweepIntervalMs: number;
  persistence: RuntimePersistenceConfig;
  security: RuntimeSecurityConfig;
};

type RuntimeEnv = Record<string, string | undefined>;

function parseIntegerMs(
  env: RuntimeEnv,
  envKey: string,
  defaultValue: number,
  minimumValue: number
): number {
  const raw = env[envKey];
  if (raw === undefined) {
    return defaultValue;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${envKey} must be a non-empty integer value.`);
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${envKey} must be an integer value in milliseconds.`);
  }
  if (parsed < minimumValue) {
    throw new Error(`${envKey} must be >= ${minimumValue}.`);
  }

  return parsed;
}

function parseNullableIntegerMs(
  env: RuntimeEnv,
  envKey: string,
  defaultValue: number | null,
  minimumValue: number
): number | null {
  const raw = env[envKey];
  if (raw === undefined) {
    return defaultValue;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${envKey} must be an integer value or null-like keyword.`);
  }

  if (NULL_LIKE_VALUES.has(trimmed.toLowerCase())) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${envKey} must be an integer value in milliseconds.`);
  }
  if (parsed < minimumValue) {
    throw new Error(`${envKey} must be >= ${minimumValue} when set.`);
  }

  return parsed;
}

function parseEnumValue<T extends string>(
  env: RuntimeEnv,
  envKey: string,
  defaultValue: T,
  allowedValues: readonly T[]
): T {
  const raw = env[envKey];
  if (raw === undefined) {
    return defaultValue;
  }

  const trimmed = raw.trim().toLowerCase();
  if (allowedValues.includes(trimmed as T)) {
    return trimmed as T;
  }

  throw new Error(`${envKey} must be one of: ${allowedValues.join(", ")}.`);
}

function parseOptionalSecret(env: RuntimeEnv, envKey: string): string | null {
  const raw = env[envKey];
  if (raw === undefined) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${envKey} must be a non-empty string when set.`);
  }

  return trimmed;
}

function parsePersistencePath(
  env: RuntimeEnv,
  mode: RuntimePersistenceMode
): string | null {
  if (mode === "disabled") {
    return null;
  }

  const raw = env[RUNTIME_ENV_KEYS.persistencePath];
  if (raw === undefined) {
    return DEFAULT_PERSISTENCE_FILE_PATH;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${RUNTIME_ENV_KEYS.persistencePath} must be a non-empty path.`);
  }

  return trimmed;
}

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    reconnectGraceMs: MIN_RECONNECT_GRACE_MS,
    gameRetentionMs: MIN_GAME_RETENTION_MS,
    sessionTtlMs: null,
    lobbyTtlMs: null,
    gameTtlMs: null,
    lifecycleSweepIntervalMs: DEFAULT_LIFECYCLE_SWEEP_INTERVAL_MS,
    persistence: {
      mode: "disabled",
      filePath: null
    },
    security: {
      reconnectTokenSecret: null
    }
  };
}

export function resolveRuntimeConfig(env: RuntimeEnv = process.env): RuntimeConfig {
  const defaults = createDefaultRuntimeConfig();
  const persistenceMode = parseEnumValue(
    env,
    RUNTIME_ENV_KEYS.persistenceMode,
    defaults.persistence.mode,
    RUNTIME_PERSISTENCE_MODE_VALUES
  );

  return {
    reconnectGraceMs: parseIntegerMs(
      env,
      RUNTIME_ENV_KEYS.reconnectGraceMs,
      defaults.reconnectGraceMs,
      MIN_RECONNECT_GRACE_MS
    ),
    gameRetentionMs: parseIntegerMs(
      env,
      RUNTIME_ENV_KEYS.gameRetentionMs,
      defaults.gameRetentionMs,
      MIN_GAME_RETENTION_MS
    ),
    sessionTtlMs: parseNullableIntegerMs(
      env,
      RUNTIME_ENV_KEYS.sessionTtlMs,
      defaults.sessionTtlMs,
      1
    ),
    lobbyTtlMs: parseNullableIntegerMs(
      env,
      RUNTIME_ENV_KEYS.lobbyTtlMs,
      defaults.lobbyTtlMs,
      1
    ),
    gameTtlMs: parseNullableIntegerMs(
      env,
      RUNTIME_ENV_KEYS.gameTtlMs,
      defaults.gameTtlMs,
      1
    ),
    lifecycleSweepIntervalMs: parseIntegerMs(
      env,
      RUNTIME_ENV_KEYS.lifecycleSweepIntervalMs,
      defaults.lifecycleSweepIntervalMs,
      MIN_LIFECYCLE_SWEEP_INTERVAL_MS
    ),
    persistence: {
      mode: persistenceMode,
      filePath: parsePersistencePath(env, persistenceMode)
    },
    security: {
      reconnectTokenSecret: parseOptionalSecret(
        env,
        RUNTIME_ENV_KEYS.reconnectTokenSecret
      )
    }
  };
}

export function toRuntimeConfigLogMetadata(config: RuntimeConfig): Record<string, unknown> {
  return {
    reconnectGraceMs: config.reconnectGraceMs,
    gameRetentionMs: config.gameRetentionMs,
    sessionTtlMs: config.sessionTtlMs,
    lobbyTtlMs: config.lobbyTtlMs,
    gameTtlMs: config.gameTtlMs,
    lifecycleSweepIntervalMs: config.lifecycleSweepIntervalMs,
    persistence: {
      mode: config.persistence.mode,
      filePath: config.persistence.filePath
    },
    security: {
      reconnectTokenSecret:
        config.security.reconnectTokenSecret === null ? null : REDACTED_SECRET
    }
  };
}
