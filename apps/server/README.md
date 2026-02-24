# @fun-euchre/server

Authoritative multiplayer Euchre runtime.

This README covers Phase 5 runtime hardening: validated config, persistence/restart behavior, reconnect-forfeit automation, secure reconnect tokens, metrics, and operational verification.

## Runtime Wiring

`createAppServer()` composes the default runtime stack:

- runtime orchestrator: `apps/server/src/runtime/orchestrator.ts`
- domain dispatchers: `apps/server/src/runtime/dispatchers.ts`
- persistence checkpointing: `apps/server/src/runtime/persistence/*`
- lifecycle sweeper: `apps/server/src/runtime/reconnectLifecycleSweeper.ts`
- realtime transport: `apps/server/src/realtime/{socketServer,wsServer}.ts`
- observability: `apps/server/src/observability/{logger,metrics}.ts`

Default runtime is live for lobby/action endpoints without custom dispatcher injection.

## Local Run

From repo root:

```bash
pnpm install
pnpm --filter @fun-euchre/server dev
```

Default bind:

- host: `0.0.0.0`
- port: `3000` (`PORT` overrides)

Quick checks:

```bash
curl -sSf http://127.0.0.1:3000/health
curl -sSf http://127.0.0.1:3000/metrics
```

## Cloud Run Notes

- GitHub source deploy Dockerfile: `apps/server/Dockerfile`
- Container entrypoint: `node apps/server/dist/index.js`
- Cloud Run provides `PORT`; server binds to `0.0.0.0` and respects `PORT`.
- Set `FUN_EUCHRE_RECONNECT_TOKEN_SECRET` in Cloud Run env vars.
- Keep max instances at `1` for consistent in-memory runtime behavior.

## Runtime Hardening Configuration

Environment keys are validated at startup by `resolveRuntimeConfig(...)`.

| Env key | Default | Constraints | Purpose |
| --- | --- | --- | --- |
| `FUN_EUCHRE_RECONNECT_GRACE_MS` | `60000` | integer >= `60000` | reconnect grace window before forfeit |
| `FUN_EUCHRE_GAME_RETENTION_MS` | `900000` | integer >= `900000` | retention window for disconnected sessions and inactive state |
| `FUN_EUCHRE_SESSION_TTL_MS` | `null` | integer >= `1` or `null/none/off/disabled` | optional TTL prune for connected sessions |
| `FUN_EUCHRE_LOBBY_TTL_MS` | `null` | integer >= `1` or `null/none/off/disabled` | optional TTL prune for lobby records |
| `FUN_EUCHRE_GAME_TTL_MS` | `null` | integer >= `1` or `null/none/off/disabled` | optional TTL prune for game records |
| `FUN_EUCHRE_LIFECYCLE_SWEEP_INTERVAL_MS` | `5000` | integer >= `1000` | reconnect/retention sweep interval |
| `FUN_EUCHRE_PERSISTENCE_MODE` | `disabled` | `disabled` or `file` | runtime snapshot persistence strategy |
| `FUN_EUCHRE_PERSISTENCE_PATH` | `./var/fun-euchre/runtime-snapshot.json` | non-empty path (when mode=`file`) | snapshot file location |
| `FUN_EUCHRE_RECONNECT_TOKEN_SECRET` | random process secret | non-empty string when set | stable HMAC secret for reconnect token verification |

Important: if `FUN_EUCHRE_RECONNECT_TOKEN_SECRET` is not set, a process-random fallback secret is used. Tokens issued before restart will not verify after restart.

Example production-like local run:

```bash
FUN_EUCHRE_PERSISTENCE_MODE=file \
FUN_EUCHRE_PERSISTENCE_PATH=./var/fun-euchre/runtime-snapshot.json \
FUN_EUCHRE_RECONNECT_TOKEN_SECRET=replace-with-long-random-secret \
pnpm --filter @fun-euchre/server dev
```

## HTTP and Realtime Contract

Base URL: `http://127.0.0.1:3000`

### HTTP endpoints

- `GET /health`
- `HEAD /health`
- `GET /metrics`
- `HEAD /metrics`
- `POST /lobbies/create`
- `POST /lobbies/join`
- `POST /lobbies/update-name`
- `POST /lobbies/start`
- `POST /actions`

### Status code mapping

HTTP command rejects:

- `400` => `INVALID_ACTION`
- `403` => `UNAUTHORIZED`
- `409` => `INVALID_STATE` / `NOT_YOUR_TURN`

WebSocket upgrade (`/realtime/ws`) failures:

- `400` malformed request/frame
- `401` invalid session id or reconnect token
- `403` reconnect window expired (forfeit due)
- `404` wrong upgrade path

### Realtime subscribe contract

Client message:

```json
{
  "type": "subscribe",
  "requestId": "req-1",
  "payload": {
    "lobbyId": "runtime-lobby-...",
    "gameId": "runtime-game-..."
  }
}
```

Rules:

- `lobbyId` must match the authenticated session lobby.
- optional `gameId` must match the authenticated session game.
- outbound protocol events are delivered as top-level websocket JSON messages.

## Persistence Semantics

When `FUN_EUCHRE_PERSISTENCE_MODE=file`:

1. Server loads snapshot from `FUN_EUCHRE_PERSISTENCE_PATH` on startup.
2. Corrupt/unsupported snapshots fail safe with lifecycle log detail and empty-state fallback.
3. Checkpoints are requested after accepted lobby/game/session transitions and lifecycle sweep changes.
4. Checkpoint writes are debounced (`75ms`) to reduce write amplification.
5. Server close performs a final snapshot write attempt.

Snapshot schema is versioned in `apps/server/src/runtime/persistence/runtimeSnapshot.ts`.

Rehydration behavior: restored sessions/lobby seats are normalized to disconnected state and receive a fresh reconnect deadline from current startup time.

## Reconnect/Forfeit Automation

`ReconnectLifecycleSweeper` runs every `FUN_EUCHRE_LIFECYCLE_SWEEP_INTERVAL_MS` and executes `runLifecycleSweep()`:

- evaluates disconnected sessions,
- applies automatic forfeit when reconnect grace is exceeded,
- emits forfeit notice + terminal `game.state`,
- prunes expired session/game/lobby records by retention and optional TTL rules,
- requests persistence checkpoint when state changes.

Forfeit transition behavior is defined in `resolveReconnectForfeit(...)`.

## Metrics Endpoint and Interpretation

`GET /metrics` returns read-only JSON metrics intended for local diagnostics and future scraping.

Shape (abbreviated):

```json
{
  "generatedAtMs": 1771960000000,
  "counters": {
    "commands": {
      "total": 0,
      "accepted": 0,
      "rejected": 0,
      "rejectionRate": 0,
      "rejectionsByCode": {},
      "byKind": {}
    },
    "reconnect": {
      "attempted": 0,
      "successful": 0,
      "failed": 0,
      "successRate": 0,
      "byTransport": {
        "http": { "attempted": 0, "successful": 0, "failed": 0 },
        "websocket": { "attempted": 0, "successful": 0, "failed": 0 }
      },
      "failuresByReason": {}
    },
    "sessions": { "active": 0, "peak": 0 },
    "games": { "started": 0, "completed": 0, "forfeits": 0 }
  },
  "latencyMs": {
    "commands": {
      "count": 0,
      "totalMs": 0,
      "averageMs": null,
      "minMs": null,
      "maxMs": null
    }
  }
}
```

Interpretation notes:

- `commands.*` includes lobby and `/actions` command paths.
- `commands.byKind` keys are `scope:kind` (example: `lobby:lobby.join`, `actions:game.pass`).
- `reconnect.*` counts both HTTP reconnect joins and websocket upgrades.
- `sessions.active`/`sessions.peak` track active websocket sessions.
- `games.forfeits` increments when a forfeit notice is observed with a terminal game completion event.

## Troubleshooting

Use `docs/operations/runbook.md` for incident playbooks:

- reconnect storms and token failures,
- stale/corrupt snapshot recovery,
- websocket transport incident triage.

## Hardening Test Matrix

From repo root:

```bash
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/server typecheck
```

High-signal suites:

- `apps/server/test/runtime-config.test.ts`
- `apps/server/test/integration/runtime-persistence.test.ts`
- `apps/server/test/integration/reconnect-lifecycle.test.ts`
- `apps/server/test/integration/reconnect-forfeit-runtime.test.ts`
- `apps/server/test/security-token.test.ts`
- `apps/server/test/realtime-broker-contract.test.ts`
- `apps/server/test/realtime-transport.test.ts`
- `apps/server/test/metrics.test.ts`
- `apps/server/test/integration/client-contract.test.ts`
