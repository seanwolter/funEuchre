import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LIFECYCLE_SWEEP_INTERVAL_MS,
  DEFAULT_PERSISTENCE_FILE_PATH,
  MIN_LIFECYCLE_SWEEP_INTERVAL_MS,
  RUNTIME_ENV_KEYS,
  createDefaultRuntimeConfig,
  resolveRuntimeConfig,
  toRuntimeConfigLogMetadata
} from "../src/config/runtimeConfig.js";
import {
  MIN_GAME_RETENTION_MS,
  MIN_RECONNECT_GRACE_MS
} from "../src/domain/reconnectPolicy.js";

test("resolveRuntimeConfig returns expected defaults", () => {
  const config = resolveRuntimeConfig({});

  assert.deepEqual(config, createDefaultRuntimeConfig());
  assert.equal(config.reconnectGraceMs, MIN_RECONNECT_GRACE_MS);
  assert.equal(config.gameRetentionMs, MIN_GAME_RETENTION_MS);
  assert.equal(config.lifecycleSweepIntervalMs, DEFAULT_LIFECYCLE_SWEEP_INTERVAL_MS);
  assert.equal(config.persistence.mode, "disabled");
  assert.equal(config.persistence.filePath, null);
});

test("resolveRuntimeConfig accepts valid overrides", () => {
  const config = resolveRuntimeConfig({
    [RUNTIME_ENV_KEYS.reconnectGraceMs]: String(MIN_RECONNECT_GRACE_MS + 30_000),
    [RUNTIME_ENV_KEYS.gameRetentionMs]: String(MIN_GAME_RETENTION_MS + 600_000),
    [RUNTIME_ENV_KEYS.sessionTtlMs]: "120000",
    [RUNTIME_ENV_KEYS.lobbyTtlMs]: "300000",
    [RUNTIME_ENV_KEYS.gameTtlMs]: "600000",
    [RUNTIME_ENV_KEYS.lifecycleSweepIntervalMs]: "2500",
    [RUNTIME_ENV_KEYS.persistenceMode]: "file",
    [RUNTIME_ENV_KEYS.persistencePath]: "/tmp/fun-euchre-snapshot.json",
    [RUNTIME_ENV_KEYS.reconnectTokenSecret]: "secret-value"
  });

  assert.equal(config.reconnectGraceMs, MIN_RECONNECT_GRACE_MS + 30_000);
  assert.equal(config.gameRetentionMs, MIN_GAME_RETENTION_MS + 600_000);
  assert.equal(config.sessionTtlMs, 120_000);
  assert.equal(config.lobbyTtlMs, 300_000);
  assert.equal(config.gameTtlMs, 600_000);
  assert.equal(config.lifecycleSweepIntervalMs, 2_500);
  assert.equal(config.persistence.mode, "file");
  assert.equal(config.persistence.filePath, "/tmp/fun-euchre-snapshot.json");
  assert.equal(config.security.reconnectTokenSecret, "secret-value");
});

test("resolveRuntimeConfig parses null-like ttl values", () => {
  const config = resolveRuntimeConfig({
    [RUNTIME_ENV_KEYS.sessionTtlMs]: "null",
    [RUNTIME_ENV_KEYS.lobbyTtlMs]: "off",
    [RUNTIME_ENV_KEYS.gameTtlMs]: "none"
  });

  assert.equal(config.sessionTtlMs, null);
  assert.equal(config.lobbyTtlMs, null);
  assert.equal(config.gameTtlMs, null);
});

test("resolveRuntimeConfig applies default persistence file path in file mode", () => {
  const config = resolveRuntimeConfig({
    [RUNTIME_ENV_KEYS.persistenceMode]: "file"
  });

  assert.equal(config.persistence.mode, "file");
  assert.equal(config.persistence.filePath, DEFAULT_PERSISTENCE_FILE_PATH);
});

test("resolveRuntimeConfig rejects invalid values with explicit env key errors", () => {
  assert.throws(
    () =>
      resolveRuntimeConfig({
        [RUNTIME_ENV_KEYS.reconnectGraceMs]: String(MIN_RECONNECT_GRACE_MS - 1)
      }),
    new RegExp(RUNTIME_ENV_KEYS.reconnectGraceMs)
  );
  assert.throws(
    () =>
      resolveRuntimeConfig({
        [RUNTIME_ENV_KEYS.lifecycleSweepIntervalMs]: String(
          MIN_LIFECYCLE_SWEEP_INTERVAL_MS - 1
        )
      }),
    new RegExp(RUNTIME_ENV_KEYS.lifecycleSweepIntervalMs)
  );
  assert.throws(
    () =>
      resolveRuntimeConfig({
        [RUNTIME_ENV_KEYS.persistenceMode]: "file",
        [RUNTIME_ENV_KEYS.persistencePath]: "   "
      }),
    new RegExp(RUNTIME_ENV_KEYS.persistencePath)
  );
  assert.throws(
    () =>
      resolveRuntimeConfig({
        [RUNTIME_ENV_KEYS.persistenceMode]: "bogus"
      }),
    new RegExp(RUNTIME_ENV_KEYS.persistenceMode)
  );
  assert.throws(
    () =>
      resolveRuntimeConfig({
        [RUNTIME_ENV_KEYS.reconnectTokenSecret]: " "
      }),
    new RegExp(RUNTIME_ENV_KEYS.reconnectTokenSecret)
  );
});

test("toRuntimeConfigLogMetadata redacts secret-bearing config fields", () => {
  const config = resolveRuntimeConfig({
    [RUNTIME_ENV_KEYS.persistenceMode]: "file",
    [RUNTIME_ENV_KEYS.reconnectTokenSecret]: "secret-value"
  });
  const metadata = toRuntimeConfigLogMetadata(config);
  const security = metadata.security as Record<string, unknown>;
  const persistence = metadata.persistence as Record<string, unknown>;

  assert.equal(security.reconnectTokenSecret, "[redacted]");
  assert.equal(persistence.mode, "file");
  assert.equal(persistence.filePath, DEFAULT_PERSISTENCE_FILE_PATH);
});
