# Operations Runbook

Runbook for Phase 5 reliability hardening incidents in the server runtime.

Scope:

- reconnect storms and reconnect auth failures,
- stale or corrupted snapshot recovery,
- websocket transport/fanout incident triage.

## 1. Fast Triage Checklist

1. Confirm process is reachable:

```bash
curl -sSf http://127.0.0.1:3000/health
```

2. Capture current runtime counters:

```bash
curl -sSf http://127.0.0.1:3000/metrics
```

3. Capture recent server logs (JSON structured events):

- `server.lifecycle`
- `action.rejected`
- `session.disconnected`
- `session.reconnected`
- `game.forfeit`

4. Check runtime config values used at startup (`server.lifecycle` metadata includes redacted config).

## 2. Metrics and Log Signals

Most useful `GET /metrics` fields:

- `counters.reconnect.attempted/successful/failed`
- `counters.reconnect.failuresByReason`
- `counters.sessions.active/peak`
- `counters.commands.rejectionRate`
- `counters.commands.rejectionsByCode`
- `counters.games.started/completed/forfeits`
- `latencyMs.commands.averageMs/maxMs`

Common reconnect failure reasons:

- `INVALID_QUERY`: missing or malformed upgrade query params.
- `UNAUTHORIZED`: token signature/claims mismatch or stale token.
- `FORBIDDEN`: reconnect grace expired, forfeit due.
- `INVALID_HANDSHAKE` or `INVALID_REQUEST_URL`: malformed upgrade request.

## 3. Playbook: Reconnect Storm

Symptoms:

- spike in websocket reconnect attempts and failures,
- users repeatedly drop and fail to reclaim seats,
- increasing `session.disconnected` and `game.forfeit` logs.

Actions:

1. Inspect reconnect counters and failure reasons from `/metrics`.
2. Validate startup config in logs:
   - `FUN_EUCHRE_RECONNECT_GRACE_MS`
   - `FUN_EUCHRE_GAME_RETENTION_MS`
   - `FUN_EUCHRE_LIFECYCLE_SWEEP_INTERVAL_MS`
3. Verify stable reconnect token secret:
   - ensure `FUN_EUCHRE_RECONNECT_TOKEN_SECRET` is explicitly set,
   - if secret changed between restarts, previously issued tokens are invalid.
4. If failures are mostly `FORBIDDEN`, users are outside grace window:
   - increase reconnect grace only if product policy allows,
   - communicate expected reconnect deadline behavior.
5. If failures are mostly `UNAUTHORIZED`:
   - confirm clients are using latest `sessionId` + `reconnectToken` from join/create responses,
   - confirm no stale persisted session reuse on client side.

Exit criteria:

- reconnect success rate recovers,
- failure rate and forfeit rate return to baseline,
- no ongoing unauthorized spike.

## 4. Playbook: Stale or Corrupt Snapshot Recovery

Symptoms:

- startup logs `Runtime snapshot load failed; starting with empty in-memory state.`,
- users report lost runtime state after restart,
- snapshot JSON parse/schema errors.

Actions:

1. Identify active snapshot path:
   - `FUN_EUCHRE_PERSISTENCE_PATH` when mode is `file`,
   - default: `./var/fun-euchre/runtime-snapshot.json`.
2. Preserve the failing snapshot for analysis:

```bash
mv ./var/fun-euchre/runtime-snapshot.json ./var/fun-euchre/runtime-snapshot.json.bad-$(date +%s)
```

3. Restart server and verify healthy empty-state fallback:

```bash
curl -sSf http://127.0.0.1:3000/health
```

4. If persistence must be temporarily bypassed, set:

```bash
FUN_EUCHRE_PERSISTENCE_MODE=disabled
```

5. Root-cause check:
   - file write interruptions,
   - manual edits to snapshot JSON,
   - schema/version mismatch.

Notes:

- snapshot writes are atomic and debounced.
- restored sessions are normalized to disconnected on startup and must reconnect again.

## 5. Playbook: Transport/Fanout Incident

Symptoms:

- websocket upgrade failures,
- clients stop receiving lobby/game events,
- HTTP command responses and websocket replay diverge.

Actions:

1. Verify upgrade endpoint path and auth parameters:
   - `/realtime/ws?sessionId=<id>&reconnectToken=<token>`.
2. Check `/metrics`:
   - `reconnect.failed` trend,
   - `sessions.active` unexpectedly zero or rapidly oscillating.
3. Confirm command path still operates (`POST /lobbies/*`, `POST /actions`) and `outbound` exists.
4. Validate parity with contract suites:

```bash
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/protocol test
```

5. Review broker semantics doc for ordering guarantees and source restrictions:
   - `docs/architecture/realtime-distribution.md`.

Exit criteria:

- successful websocket upgrades,
- expected room fanout resumes,
- contract parity tests pass.

## 6. Hardening Verification Matrix

Run from repo root:

```bash
pnpm --filter @fun-euchre/server typecheck
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/web typecheck
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/protocol test
pnpm lint
pnpm typecheck
pnpm test
```

## 7. Escalation Notes

Collect before escalation:

- `/metrics` snapshot,
- relevant structured log window,
- runtime config values (redacted secret),
- exact failing request/upgrade payload shape,
- current snapshot file path and persistence mode.
