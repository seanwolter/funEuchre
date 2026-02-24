# Phase 5 Detailed Task List: Reliability, Security, and Operational Hardening

Source:
- `docs/requirements.md` (Sections 7.5, 8, 9, 12)
- `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` (Phase 5 section)
- `thoughts/shared/plans/005_phase4_client_runtime_and_gameplay_detailed_task_list.md` (Phase 4 exit)
- `thoughts/shared/research/006_phase4_client_runtime_snapshot.md`
- `thoughts/shared/sessions/011_phase4_save_progress_checkpoint.md`

## Resume Snapshot (2026-02-24)
- Git branch: `main`
- Working tree: clean
- Last commit on branch: `21173f6` (`Save Phase 4 progress checkpoint and resume context machine generated`)
- Phase 4 status: complete
- Immediate phase boundary: Phase 5 hardening kickoff before new feature scope

## Direction Locked In
- Prioritize reliability hardening over net-new gameplay features.
- Deliver persistence/restart durability and reconnect policy enforcement first.
- Add secure identity/token handling without introducing account/auth scope.
- Introduce explicit seams for distributed realtime transport without committing to a specific external provider in this phase.
- Keep client as a projection of authoritative server events.

## Scope of Phase 5
Implement Phase 5 hardening for production-like reliability by delivering:
- durable runtime persistence and crash/restart recovery flow,
- automatic reconnect timeout/forfeit enforcement and retention pruning,
- stronger token/identifier security defaults,
- realtime transport abstraction for future multi-instance fanout,
- event ordering metadata + client stale/out-of-order guards,
- measurable metrics and operational diagnostics.

Out of scope for this phase:
- full matchmaking/social/ranking features,
- long-term user accounts and authentication system,
- final cloud deployment/IaC automation,
- provider-specific distributed infra implementation (for example Redis/Kafka managed rollout).

## Priority Legend
- `P0` = reliability and correctness gates required before further feature work.
- `P1` = hardening required for safe multi-client operation and observability.
- `P2` = documentation/handoff tasks after implementation stabilizes.

## Execution Protocol (Required)
- After each task is completed, stop and request explicit user confirmation before starting the next task.
- Do not auto-advance between tasks, even if no blockers are present.
- Record completion evidence (tests/logs/files changed) before asking for confirmation.

## Execution Status (2026-02-24)
- [x] Phase 5 started.
- [x] Task 1 completed: runtime hardening configuration surface implemented.
- [x] Task 1 verification completed by user.
- [x] Task 2 completed: runtime storage/fanout ports extracted from concrete in-memory implementations.
- [x] Task 2 verification completed by user.
- [x] Task 3 completed: durable snapshot persistence + startup rehydration implemented.
- [x] Task 3 verification completed by user.
- [x] Task 4 completed: authoritative persistence checkpoints wired into lobby/game/session transitions.
- [x] Task 4 verification completed by user.
- [x] Task 5 completed: reconnect lifecycle sweeper + auto-forfeit + retention prune automation implemented.
- [x] Task 5 verification completed by user.
- [x] Task 6 completed: secure identifier and reconnect-token hardening implemented.
- [x] Task 6 verification completed by user.
- [x] Task 7 completed: realtime broker abstraction + contract harness implemented.
- [x] Task 7 verification completed by user.
- [x] Task 8 completed: protocol event ordering metadata + client stale/out-of-order guardrails implemented.
- [x] Task 8 verification completed by user.
- [x] Task 9 completed: operational metrics collection and diagnostics endpoint implemented.
- [x] Task 9 verification completed by user.
- [x] Task 10 completed: hardening test matrix, docs, and Phase 5 checkpoint artifacts completed.
- [x] Task 10 verification completed by user.

## Ordered Task List

1. [x] `P0` Add validated runtime hardening configuration and defaults
   - Files:
     - `apps/server/src/config/runtimeConfig.ts` (new)
     - `apps/server/src/server.ts`
     - `apps/server/src/index.ts`
     - `apps/server/test/runtime-config.test.ts` (new)
   - Actions:
     - Define strongly validated env-driven config for reconnect windows, retention TTLs, persistence mode, persistence path, and sweep intervals.
     - Fail fast on invalid values and log effective runtime config (with redaction for secret-bearing fields).
     - Thread config into runtime/orchestrator creation instead of hardcoded defaults.
   - Done when:
     - Server startup is deterministic for all required hardening env inputs.
     - Config tests cover defaults, invalid input rejection, and override behavior.

2. [x] `P0` Extract runtime ports for stores and realtime fanout
   - Files:
     - `apps/server/src/domain/runtimePorts.ts` (new)
     - `apps/server/src/domain/lobbyStore.ts`
     - `apps/server/src/domain/gameStore.ts`
     - `apps/server/src/domain/sessionStore.ts`
     - `apps/server/src/realtime/socketServer.ts`
     - `apps/server/src/runtime/orchestrator.ts`
     - `apps/server/src/runtime/dispatchers.ts`
     - `apps/server/test/integration/runtime-wiring.test.ts`
   - Actions:
     - Introduce explicit interfaces for lobby/game/session persistence and realtime publish/bind behavior.
     - Update orchestrator/dispatchers/game-manager wiring to depend on ports rather than concrete in-memory classes.
     - Preserve test injection seams and compatibility with existing integration tests.
   - Done when:
     - Runtime components compile against interfaces, not concrete in-memory implementations.
     - Existing runtime wiring tests pass without behavior regressions.

3. [x] `P0` Implement durable runtime snapshot repository and startup rehydration
   - Files:
     - `apps/server/src/runtime/persistence/runtimeSnapshot.ts` (new)
     - `apps/server/src/runtime/persistence/fileSnapshotRepository.ts` (new)
     - `apps/server/src/runtime/persistence/atomicWrite.ts` (new)
     - `apps/server/src/runtime/orchestrator.ts`
     - `apps/server/src/server.ts`
     - `apps/server/test/integration/runtime-persistence.test.ts` (new)
   - Actions:
     - Add snapshot schema for lobby/game/session state with versioning.
     - Persist snapshots atomically to local disk and load on startup when enabled.
     - Ensure corrupted/unsupported snapshots fail safely with explicit logs and clean fallback.
   - Done when:
     - Server restart restores active lobby/game/session state from persisted snapshot.
     - Persistence integration test covers create/join/start/action then restart then resume.

4. [x] `P0` Wire authoritative state-transition persistence checkpoints
   - Files:
     - `apps/server/src/runtime/dispatchers.ts`
     - `apps/server/src/domain/gameManager.ts`
     - `apps/server/src/realtime/wsServer.ts`
     - `apps/server/src/runtime/orchestrator.ts`
     - `apps/server/test/integration/client-contract.test.ts`
   - Actions:
     - Trigger persistence checkpoints after accepted lobby/game/session transitions and reconnect connection-state changes.
     - Keep checkpoint writes ordered to avoid snapshot regression under concurrent actions.
     - Avoid write amplification with bounded debounce/coalescing strategy.
   - Done when:
     - Persisted state always reflects last authoritative transition order.
     - Contract/integration tests confirm no response/broadcast parity drift with persistence enabled.

5. [x] `P0` Add reconnect lifecycle sweeper with automatic forfeit and retention prune
   - Files:
     - `apps/server/src/runtime/reconnectLifecycleSweeper.ts` (new)
     - `apps/server/src/domain/reconnectPolicy.ts`
     - `apps/server/src/runtime/orchestrator.ts`
     - `apps/server/src/runtime/dispatchers.ts`
     - `apps/server/test/integration/reconnect-lifecycle.test.ts`
     - `apps/server/test/integration/reconnect-forfeit-runtime.test.ts` (new)
   - Actions:
     - Schedule periodic evaluation of disconnected sessions and enforce forfeit when reconnect window expires.
     - Apply `resolveReconnectForfeit(...)` into live runtime transitions, persist resulting state, and broadcast forfeit notice + terminal game state.
     - Prune expired lobby/game/session records according to retention policy.
   - Done when:
     - Timed-out disconnects resolve without requiring a join/upgrade request to trigger forfeit.
     - Integration tests verify grace-window reconnect success and post-window auto-forfeit path.

6. [x] `P1` Harden session/reconnect identifiers and token validation
   - Files:
     - `apps/server/src/domain/ids.ts`
     - `apps/server/src/security/reconnectToken.ts` (new)
     - `apps/server/src/runtime/orchestrator.ts`
     - `apps/server/src/realtime/wsServer.ts`
     - `apps/server/src/runtime/dispatchers.ts`
     - `apps/server/test/security-token.test.ts` (new)
   - Actions:
     - Replace predictable default runtime identifier generation with cryptographically strong defaults while preserving deterministic test factories.
     - Introduce reconnect-token signing/verification (HMAC) with issue-time metadata and strict parse/validation checks.
     - Reject malformed/tampered/expired reconnect tokens consistently across HTTP join and websocket upgrade paths.
   - Done when:
     - Security tests cover forged token, altered token, expired token, and valid token cases.
     - Existing reconnect behavior remains functional for valid sessions.

7. [x] `P1` Introduce realtime broker abstraction and contract harness for multi-instance path
   - Files:
     - `apps/server/src/realtime/broker.ts` (new)
     - `apps/server/src/realtime/inMemoryBroker.ts` (new)
     - `apps/server/src/realtime/socketServer.ts`
     - `apps/server/src/runtime/orchestrator.ts`
     - `apps/server/test/realtime-broker-contract.test.ts` (new)
     - `docs/architecture/realtime-distribution.md` (new)
   - Actions:
     - Separate room membership and publish semantics behind a broker port.
     - Keep in-memory broker as default implementation with no behavior regression.
     - Document broker contract, ordering guarantees, and delivery semantics required for an eventual distributed adapter.
   - Done when:
     - Runtime is broker-port driven and current websocket behavior is unchanged.
     - Broker contract test suite passes for connect/join/leave/publish semantics.

8. [x] `P1` Add event ordering metadata and client stale/out-of-order guards
   - Files:
     - `packages/protocol/src/index.ts`
     - `packages/protocol/test/client-server-contract.test.ts`
     - `apps/server/src/realtime/inMemoryBroker.ts`
     - `apps/server/test/integration/client-contract.test.ts`
     - `apps/web/src/state/reducer.ts`
     - `apps/web/test/contract-events.test.ts`
   - Actions:
     - Extend server event schema with ordering metadata (`sequence`, `emittedAtMs`) emitted from authoritative server transitions.
     - Preserve HTTP/websocket parity while ensuring deterministic sequence progression by room/game.
     - Update client reducer to prefer sequence ordering over payload-shape heuristics for stale suppression.
   - Done when:
     - Out-of-order replay tests prove deterministic client convergence.
     - HTTP response `outbound` and websocket stream remain contract-equivalent.

9. [x] `P1` Add operational metrics and diagnostics endpoint
   - Files:
     - `apps/server/src/observability/metrics.ts` (new)
     - `apps/server/src/http/router.ts`
     - `apps/server/src/http/lobbyRoutes.ts`
     - `apps/server/src/http/gameRoutes.ts`
     - `apps/server/src/realtime/wsServer.ts`
     - `apps/server/test/metrics.test.ts` (new)
   - Actions:
     - Track command latency, reconnect attempts/success/failure, active sessions, started/completed/forfeit game counts, and rejection rates.
     - Expose metrics via a read-only endpoint (`GET /metrics`) suitable for local ops and later scraping.
     - Keep per-request overhead low and avoid blocking hot paths.
   - Done when:
     - Metrics endpoint returns accurate counters under integration test traffic.
     - Existing health endpoint behavior remains unchanged.

10. [x] `P2` Finalize hardening test matrix, docs, and Phase 5 checkpoint artifacts
   - Files:
     - `apps/server/README.md`
     - `apps/web/README.md`
     - `README.md`
     - `docs/operations/runbook.md` (new)
     - `thoughts/shared/research/007_phase5_runtime_hardening_snapshot.md` (new)
     - `thoughts/shared/sessions/012_phase5_kickoff.md` (new)
   - Actions:
     - Document runtime config, persistence semantics, reconnect/forfeit automation, and metrics interpretation.
     - Add on-call/operator runbook for reconnect storms, stale snapshot recovery, and transport incident triage.
     - Capture Phase 5 handoff research + checkpoint artifacts in the established project pattern.
   - Done when:
     - A new contributor can run, validate, and troubleshoot Phase 5 hardening paths from docs only.

## Dependency Chain
1. Task 1 gates all other tasks because hardening behavior should be env-configurable and validated up front.
2. Task 2 is required before Task 3 and Task 7 to avoid persistence and broker coupling to concrete in-memory classes.
3. Tasks 3 and 4 are paired: repository first, then authoritative transition checkpoint wiring.
4. Task 5 depends on Tasks 3-4 so sweep outcomes are persisted and safely recoverable on restart.
5. Task 6 can begin after Task 1, but must land before final reconnect hardening validation.
6. Task 7 should precede Task 8 so event-order semantics are defined over broker abstraction.
7. Task 8 depends on protocol + server + web coordinated changes; run after Tasks 2 and 7.
8. Task 9 can run in parallel with late Task 8 work but should complete before Task 10 docs/handoff.
9. Task 10 closes after Tasks 1-9 are stable and verified.

## Phase 5 Exit Checklist
- [x] Runtime state survives process restart long enough to satisfy reconnect retention target.
- [x] Disconnect timeout forfeit is enforced automatically and broadcast clearly.
- [x] Reconnect/session identifiers are non-predictable and tamper-resistant.
- [x] Realtime architecture has a tested broker contract seam for future multi-instance fanout.
- [x] Client convergence is deterministic under duplicate and out-of-order event replay.
- [x] Operators can inspect actionable metrics and triage via documented runbook.

## Verification Commands (when Node/pnpm are available)
```bash
pnpm --filter @fun-euchre/protocol test
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/server typecheck
pnpm --filter @fun-euchre/web typecheck
pnpm lint
pnpm typecheck
pnpm test
```

## Suggested Immediate Start Sequence
1. Execute Task 1 and pause for user verification.
2. Execute Task 2 and pause for user verification.
3. Execute Tasks 3-5 in order with checkpoint validation after each.
4. Execute Tasks 6-9 with contract/integration regression checks at each boundary.
5. Execute Task 10 to finalize docs and handoff artifacts.
