# Phase 3 Detailed Task List: Lobby, Sessions, and Authoritative Real-Time Server

Source:
- `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` (Phase 3 section)
- `docs/requirements.md` (Sections 7, 10, 12)
- `packages/protocol/src/index.ts`
- `packages/game-rules/src/gameState.ts`

## Direction Locked In
- Rule variant stays aligned to `docs/rules_of_euchre.md` MVP defaults.
- Seat assignment remains automatic.
- Reconnect timeout behavior is forfeit.
- MVP authentication remains anonymous session-based (no long-term accounts).
- Server is authoritative; clients submit intents only and render projected state.

## Scope of Phase 3
Implement server runtime capabilities for:
- Lobby lifecycle (create, join, rename, start).
- Authoritative game action processing via `@fun-euchre/game-rules`.
- Real-time state fan-out to connected players.
- Reconnect token/session reclamation and timeout/forfeit handling.

Out of scope for this phase:
- Final gameplay UI implementation details (Phase 4).
- Production-grade persistence backend migration (Phase 5+).
- Matchmaking/ranking/social features beyond private lobby links.

## Priority Legend
- `P0` = blocks all end-to-end multiplayer flows.
- `P1` = required for robust behavior and high-confidence rollout.
- `P2` = hardening/documentation tasks after core flows are stable.

## Execution Status (2026-02-24)
- [x] Phase 3 implementation completed.
- [x] Task 1 completed: server bootstrap moved to `index.ts` + `server.ts`; routing extracted to composable `http/router.ts`.
- [x] Task 2 completed: branded domain identifiers and deterministic ID factory helpers added in `apps/server/src/domain/types.ts` and `apps/server/src/domain/ids.ts`, with adapter/test wiring updates.
- [x] Task 3 completed: pure lobby domain transitions (`create/join/update-name/start`) and invariants implemented in `apps/server/src/domain/lobby.ts` with coverage in `apps/server/test/lobby.test.ts`.
- [x] Task 4 completed: in-memory lobby/game/session stores with lookup indexes and TTL/reconnect expiry hooks implemented in `apps/server/src/domain/*Store.ts`, with coverage added in `apps/server/test/stores.test.ts`.
- [x] Task 5 completed: protocol adapter now maps all MVP inbound events and projects outbound `lobby.state`/`game.state`/`action.rejected`/`system.notice` events with centralized reject-code mapping, covered in `apps/server/test/protocol-adapter.test.ts`.
- [x] Task 6 completed: per-game serialized authoritative action pipeline added in `apps/server/src/domain/gameManager.ts` with deterministic ordering and duplicate/late-action coverage in `apps/server/test/game-manager.test.ts`.
- [x] Task 7 completed: reconnect lifecycle policy and deterministic forfeit resolution implemented in `apps/server/src/domain/reconnectPolicy.ts` with timeline and terminal-state coverage in `apps/server/test/reconnect-policy.test.ts`.
- [x] Task 8 completed: HTTP lobby/action endpoints with protocol validation and normalized requestId-correlated errors implemented in `apps/server/src/http/{json,lobbyRoutes,gameRoutes}.ts`, with route coverage in `apps/server/test/http-routes.test.ts`.
- [x] Task 9 completed: realtime event hub/socket transport baseline implemented in `apps/server/src/realtime/{eventHub,socketServer}.ts` with room fan-out and authoritative-source tests in `apps/server/test/realtime.test.ts`.
- [x] Task 10 completed: rules/protocol parity gaps closed for round-1 dealer exchange and projection behavior in `packages/game-rules/src/gameState.ts` and `apps/server/src/domain/protocolAdapter.ts`, with targeted regression coverage.
- [x] Task 11 completed: acceptance-critical integration lifecycles covered in `apps/server/test/integration/*.test.ts` for lobby flow, gameplay flow, reconnect recovery, and forfeit path ordering/consistency.
- [x] Task 12 completed: structured observability baseline added in `apps/server/src/observability/logger.ts` with route/session/forfeit wiring and coverage in `apps/server/test/observability.test.ts`.
- [x] Task 13 completed: runtime contract documentation added in `apps/server/README.md` and linked from root `README.md` for Phase 4 client integration.
- [x] Task 14 completed: Phase 3 checkpoint artifacts captured in `thoughts/shared/research/005_phase3_server_integration_snapshot.md` and `thoughts/shared/sessions/003_phase3_server_integration_complete.md`.
- [x] Lobby/session/game orchestration modules implemented for Phase 3 scope.
- [x] Real-time transport and reconnect lifecycle implemented for Phase 3 scope.

## Ordered Task List

1. [x] `P0` Lock server module boundaries and bootstrap wiring
   - Files:
     - `apps/server/src/index.ts`
     - `apps/server/src/server.ts` (new)
     - `apps/server/src/http/router.ts` (new)
   - Actions:
     - Split process bootstrap from request handling so domain services can be injected/tested.
     - Introduce a composable router for `/health`, lobby endpoints, and action endpoints.
   - Done when:
     - `index.ts` only starts/stops the server.
     - Router can be instantiated in tests without opening a real port.

2. [x] `P0` Add canonical server domain types and identity helpers
   - Files:
     - `apps/server/src/domain/types.ts` (new)
     - `apps/server/src/domain/ids.ts` (new)
   - Actions:
     - Define `LobbyId`, `GameId`, `PlayerId`, `ReconnectToken`, `SessionId` opaque aliases.
     - Add deterministic ID/token factory interfaces and runtime guards.
   - Done when:
     - Domain modules do not use raw ad-hoc string IDs directly.
     - ID factory can be stubbed in tests.

3. [x] `P0` Implement lobby domain model and invariants
   - Files:
     - `apps/server/src/domain/lobby.ts` (new)
     - `apps/server/test/lobby.test.ts` (new)
   - Actions:
     - Model seat/team mapping, host identity, lobby phase, and connectivity state.
     - Implement pure transitions for create/join/update-name/start.
     - Enforce start precondition of four occupied seats.
   - Done when:
     - Unit tests cover happy path and rejects (full lobby, duplicate seat claims, unauthorized start).

4. [x] `P0` Implement in-memory stores for lobby/game/session state with TTL hooks
   - Files:
     - `apps/server/src/domain/lobbyStore.ts` (new)
     - `apps/server/src/domain/gameStore.ts` (new)
     - `apps/server/src/domain/sessionStore.ts` (new)
     - `apps/server/test/stores.test.ts` (new)
   - Actions:
     - Provide CRUD + lookup indexes (by lobby, by player, by token).
     - Attach timestamps and expiration checks to support reconnect window semantics.
   - Done when:
     - Stores support all required lookups without shared mutable aliasing bugs.
     - Expiry behavior is deterministic under fake timers.

5. [x] `P0` Expand protocol adapter to full server-side mapping surface
   - Files:
     - `apps/server/src/domain/protocolAdapter.ts`
     - `apps/server/test/protocol-adapter.test.ts`
   - Actions:
     - Map all supported inbound events (`lobby.create`, `lobby.join`, `lobby.update_name`, `lobby.start`, `game.play_card`) to domain commands.
     - Project domain snapshots to protocol events (`lobby.state`, `game.state`, `action.rejected`, `system.notice`).
     - Centralize reject-code mapping so protocol taxonomy remains stable.
   - Done when:
     - Adapter tests cover each inbound event and each reject class.
     - No endpoint performs protocol mapping inline.

6. [x] `P0` Build game manager with per-game serialized action pipeline
   - Files:
     - `apps/server/src/domain/gameManager.ts` (new)
     - `apps/server/test/game-manager.test.ts` (new)
   - Actions:
     - Implement single-writer queue/lock per game to prevent concurrent state corruption.
     - Apply mapped actions through `applyGameAction` and persist resulting state.
     - Emit deterministic outbound event batches for broadcast.
   - Done when:
     - Concurrent submissions for one game are processed in strict order.
     - Duplicate/late actions are rejected consistently.

7. [x] `P0` Implement reconnect policy and forfeit transitions
   - Files:
     - `apps/server/src/domain/reconnectPolicy.ts` (new)
     - `apps/server/test/reconnect-policy.test.ts` (new)
   - Actions:
     - Encode reconnect grace period (>=60s target) and game retention horizon (>=15m target).
     - Convert expired reconnects to a terminal forfeit outcome for opposing team.
   - Done when:
     - Policy produces deterministic outcomes for connect/disconnect/expire timelines.
     - Forfeit path emits a clear server notice and final state.

8. [x] `P0` Implement HTTP lobby APIs and command submission endpoint
   - Files:
     - `apps/server/src/http/lobbyRoutes.ts` (new)
     - `apps/server/src/http/gameRoutes.ts` (new)
     - `apps/server/src/http/json.ts` (new)
     - `apps/server/test/http-routes.test.ts` (new)
   - Actions:
     - Add endpoints for create/join/update-name/start and intent submission.
     - Validate payloads with protocol parsers before domain dispatch.
     - Return normalized errors and request IDs for client correlation.
   - Done when:
     - Route tests validate status codes, payload shapes, and failure branches.

9. [x] `P0` Implement real-time outbound transport abstraction and baseline implementation
   - Files:
     - `apps/server/src/realtime/socketServer.ts` (new)
     - `apps/server/src/realtime/eventHub.ts` (new)
     - `apps/server/test/realtime.test.ts` (new)
   - Actions:
     - Add room-based publish/subscribe keyed by lobby/game IDs.
     - Bind connected sessions to rooms and fan out protocol events.
     - Enforce that broadcasts come only from authoritative domain transitions.
   - Done when:
     - Multi-client tests observe consistent event order and payload parity.

10. [x] `P1` Close rules/protocol integration gaps discovered during analysis
    - Files:
      - `packages/game-rules/src/gameState.ts`
      - `packages/game-rules/test/gameState.test.ts`
      - `apps/server/src/domain/protocolAdapter.ts`
    - Actions:
      - Decide and implement dealer upcard exchange behavior for round-1 `order_up` flows.
      - Ensure server projection reflects any additional transition details needed for clients.
    - Done when:
      - Rules and adapter tests cover round-1 order-up exchange path end-to-end.

11. [x] `P1` Add end-to-end server integration tests for MVP acceptance-critical paths
    - Files:
      - `apps/server/test/integration/lobby-lifecycle.test.ts` (new)
      - `apps/server/test/integration/gameplay-lifecycle.test.ts` (new)
      - `apps/server/test/integration/reconnect-lifecycle.test.ts` (new)
    - Actions:
      - Simulate create -> join x4 -> start -> play -> score progression.
      - Simulate disconnect/reconnect within window and post-window forfeit behavior.
      - Validate protocol event ordering and state consistency across clients.
    - Done when:
      - Acceptance criteria #1, #2, #3 from `docs/requirements.md` are covered by automated integration tests.

12. [x] `P1` Add observability baseline for Phase 3 operations
    - Files:
      - `apps/server/src/observability/logger.ts` (new)
      - `apps/server/src/index.ts`
      - `apps/server/test/observability.test.ts` (new)
    - Actions:
      - Add structured logs for lobby actions, game transitions, rejects, disconnects, reconnects, forfeits.
      - Include correlation fields (`lobbyId`, `gameId`, `playerId`, `requestId`) in log context.
    - Done when:
      - Key state transitions are logged exactly once with stable field names.

13. [x] `P2` Document server runtime contracts for Phase 4 client integration
    - Files:
      - `apps/server/README.md` (new)
      - `README.md`
    - Actions:
      - Document endpoints, realtime channels, event envelopes, error model, and local run instructions.
      - Provide sample flows for create/join/start/play/reconnect.
    - Done when:
      - A contributor can implement client integration without reverse-engineering server internals.

14. [x] `P2` Add Phase 3 completion checkpoint artifacts
    - Files:
      - `thoughts/shared/research/005_phase3_server_integration_snapshot.md` (new)
      - `thoughts/shared/sessions/003_phase3_server_integration_complete.md` (new)
    - Actions:
      - Capture implemented architecture, known limitations, and handoff guidance.
    - Done when:
      - Phase 4 kickoff has a reliable written baseline.

## Dependency Chain
1. Tasks 1-2 unblock all domain and transport work.
2. Task 3 depends on Task 2.
3. Task 4 depends on Tasks 2-3.
4. Task 5 depends on Tasks 2-3 and should align with current adapter scaffold.
5. Task 6 depends on Tasks 4-5.
6. Tasks 7-9 depend on Tasks 4-6.
7. Task 10 depends on Tasks 5-6 and may introduce follow-up game-rules deltas.
8. Task 11 depends on Tasks 7-10.
9. Task 12 can start once Tasks 6-9 are stable.
10. Tasks 13-14 complete after Task 11 passes.

## Phase 3 Exit Checklist
- [x] Lobby create/join/update-name/start flows are implemented and validated.
- [x] Game actions are processed through a serialized authoritative pipeline.
- [x] Realtime fan-out delivers consistent protocol events to all connected clients.
- [x] Reconnect succeeds within window and forfeit triggers after timeout expiry.
- [x] Server integration tests cover acceptance-critical multiplayer flows.
- [x] Structured logs include correlation metadata for key transitions.

## Verification Commands (when Node/pnpm are available)
```bash
pnpm --filter @fun-euchre/protocol build
pnpm --filter @fun-euchre/game-rules test
pnpm --filter @fun-euchre/server lint
pnpm --filter @fun-euchre/server typecheck
pnpm --filter @fun-euchre/server test
pnpm lint
pnpm typecheck
pnpm test
```

## Suggested Immediate Start Sequence
1. Complete Tasks 1-3 to lock domain boundaries and lobby invariants.
2. Implement Tasks 4-6 to establish authoritative state transition plumbing.
3. Implement Tasks 7-9 for reconnect and real-time delivery.
4. Finish Tasks 10-12 for rules parity and integration confidence, then document with Tasks 13-14.

## Progress Checkpoint - 2026-02-23 20:00 CST

### Work Completed This Session
- [x] Task 10 completed (rules/protocol parity for round-1 dealer exchange and projection behavior).
- [x] Task 11 completed (acceptance-critical integration lifecycle coverage).
- [x] Task 12 completed (structured observability baseline with correlation logging).
- [x] Task 13 completed (server runtime contract documentation and root README linkage).
- [x] Task 14 completed (Phase 3 snapshot + session checkpoint artifacts).

### Current State
- **Active File**: `thoughts/shared/sessions/004_phase3_progress_checkpoint.md:1`
- **Current Task**: Save-progress checkpoint with WIP commit for completed Phase 3 implementation/doc artifacts.
- **Blockers**: None.

### Local Changes
- Modified: `apps/server/src/**` - Phase 3 domain/http/realtime/observability implementation and bootstrap integration updates.
- Modified: `apps/server/test/**` - unit/integration/observability coverage added for acceptance-critical flows.
- Modified: `packages/game-rules/src/gameState.ts` and `packages/game-rules/test/gameState.test.ts` - round-1 order-up/dealer exchange parity fixes.
- Modified: `README.md` and `apps/server/README.md` - server runtime contracts and integration guidance.
- Modified: `thoughts/shared/plans/004_phase3_server_integration_detailed_task_list.md` - task completion status and checkpointing.
- Untracked: `thoughts/shared/research/005_phase3_server_integration_snapshot.md`, `thoughts/shared/sessions/003_phase3_server_integration_complete.md`, `thoughts/shared/sessions/004_phase3_progress_checkpoint.md`.

### Next Steps
1. Start Phase 4 planning with a client integration task list based on server runtime contracts.
2. Assemble default server orchestration wiring (dispatchers/session/realtime integration path) as first Phase 4 backend support step.

### Commands to Resume
```bash
cd /Users/seanzach/DEV/funEuchre
git status
$implement-plan thoughts/shared/plans/004_phase3_server_integration_detailed_task_list.md
```
