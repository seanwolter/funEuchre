# Phase 4 Detailed Task List: Runtime Orchestration and Responsive Web Gameplay

Source:
- `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` (Phase 4 section)
- `thoughts/shared/plans/004_phase3_server_integration_detailed_task_list.md` (completed status + handoff)
- `thoughts/shared/sessions/004_phase3_progress_checkpoint.md`
- `thoughts/shared/research/005_phase3_server_integration_snapshot.md`
- `apps/server/README.md` (runtime contract baseline)
- `docs/requirements.md` (Sections 7, 8, 12)

## Resume Snapshot (2026-02-24)
- Git branch: `main`
- Working tree: clean
- Last commit on branch: `79cbed6` (`phase 3 complete. machine generated`)
- Phase 3 status: complete
- Immediate phase boundary: Phase 4 kickoff

## Direction Locked In
- Start Phase 4 by wiring default server orchestration so runtime endpoints are usable without fallback dispatchers.
- Keep server authority model: client sends intents only, client state is projection of server events.
- Expand protocol and event payloads to support full bidding + play UX before building final gameplay UI interactions.
- Implement public realtime transport in Phase 4 so web client behavior matches target runtime, not only HTTP polling.
- Keep anonymous session model and reconnect-token reclaim flow for MVP (no long-term accounts).

## Scope of Phase 4
Implement end-to-end player-facing gameplay for desktop and mobile browsers by delivering:
- fully wired server runtime command dispatch and realtime transport,
- client-consumable protocol surface for lobby + bidding + trick play + reconnect,
- responsive web app flows for lobby creation/join/start, full hand/game progression, and reconnect recovery.

Out of scope for this phase:
- durable persistence backend migration beyond in-memory stores,
- account/auth system beyond anonymous sessions,
- production scaling/distributed fanout and deployment hardening (Phase 5+),
- matchmaking/ranking/social features beyond private invite flow.

## Priority Legend
- `P0` = blocks playable end-to-end multiplayer in browser.
- `P1` = required for robust reconnect, UX quality, and contract confidence.
- `P2` = documentation/checkpoint tasks after core implementation is stable.

## Execution Status (2026-02-24)
- [x] Phase 4 started.
- [x] Task 1 completed: default server runtime orchestration + dispatcher wiring + integration coverage added.
- [x] Task 1 verification completed by user.
- [x] Task 2 completed: protocol bidding-intent expansion + adapter mapping + coverage updates.
- [x] Task 2 verification completed by user.
- [x] Task 3 completed: enriched public/private game projection implemented.
- [x] Task 3 verification completed by user.
- [x] Task 4 completed: session identity/reconnect HTTP lobby contract implemented.
- [x] Task 4 verification completed by user.
- [x] Task 5 completed: websocket transport endpoint + runtime broadcast integration implemented.
- [x] Task 5 verification completed by user.
- [x] Task 6 completed: web shell modular route/page architecture refactor implemented.
- [x] Task 6 verification completed by user.
- [x] Task 7 completed: typed web API/session client layer implemented.
- [x] Task 7 verification completed by user.
- [x] Task 8 completed: unified client reducer + realtime lifecycle client implemented.
- [x] Task 8 verification completed by user.
- [x] Task 9 completed: lobby/join UX implementation delivered.
- [x] Task 9 verification completed by user.
- [x] Task 10 completed: gameplay surface and legal action feedback implementation delivered.
- [x] Task 10 verification completed by user.
- [x] Task 11 completed: reconnect recovery UX and lifecycle messaging implemented.
- [x] Task 12 completed: accessibility and responsive UX hardening implemented.
- [x] Task 12 verification completed by user.
- [x] Task 13 completed: cross-package client/server contract coverage implemented.
- [x] Task 13 verification completed by user.
- [x] Task 14 completed: docs and checkpoint artifacts updated for Phase 4 handoff.
- [x] Phase 3 artifacts and tests provide baseline for kickoff.

## Ordered Task List

1. [x] `P0` Wire default server runtime orchestration and remove fallback command path
   - Files:
     - `apps/server/src/server.ts`
     - `apps/server/src/index.ts`
     - `apps/server/src/runtime/orchestrator.ts` (new)
     - `apps/server/src/runtime/dispatchers.ts` (new)
     - `apps/server/test/integration/runtime-wiring.test.ts` (new)
   - Actions:
     - Compose lobby/game/session stores, ID factories, reconnect policy, game manager, and realtime broadcaster in one default runtime.
     - Inject real lobby/action dispatchers into route creation by default.
     - Keep test-friendly injection seams for alternate orchestrations.
   - Done when:
     - Default `POST /lobbies/create` and `POST /actions` no longer return dispatcher-not-configured fallbacks.
     - Runtime wiring integration test validates accepted command flow through HTTP -> domain -> outbound events.

2. [x] `P0` Expand protocol command surface for full bidding lifecycle
   - Files:
     - `packages/protocol/src/index.ts`
     - `packages/protocol/test/smoke.test.ts`
     - `apps/server/src/domain/protocolAdapter.ts`
     - `apps/server/test/protocol-adapter.test.ts`
   - Actions:
     - Add client events for bidding intents (`pass`, `order_up`, `call_trump`) with strict payload validation.
     - Map new protocol events to `@fun-euchre/game-rules` bidding actions.
     - Preserve reject taxonomy parity with existing protocol reject codes.
   - Done when:
     - Protocol validators accept/reject new bidding events deterministically.
     - Adapter tests cover round 1 and round 2 bidding mappings and failure paths.

3. [x] `P0` Add client-usable game projection payloads without hidden-state leaks
   - Files:
     - `packages/protocol/src/index.ts`
     - `apps/server/src/domain/protocolAdapter.ts`
     - `apps/server/src/domain/gameManager.ts`
     - `apps/server/test/integration/gameplay-lifecycle.test.ts`
   - Actions:
     - Extend server projection fields needed by UI (phase, bidding state summary, trick cards, lead suit, turn/dealer/trump/scores).
     - Introduce player-scoped hand projection event for own hand + legal action hints.
     - Keep room-broadcast payloads free of opponent private cards.
   - Done when:
     - Integration tests confirm every seat gets identical public state and only its own private hand projection.
     - UI-required state indicators from `docs/requirements.md` Section 7.2 are present in protocol events.

4. [x] `P0` Implement session identity and reconnect contract in HTTP lobby flows
   - Files:
     - `apps/server/src/domain/sessionStore.ts`
     - `apps/server/src/runtime/dispatchers.ts`
     - `apps/server/src/http/lobbyRoutes.ts`
     - `apps/server/test/http-routes.test.ts`
     - `apps/server/test/integration/reconnect-lifecycle.test.ts`
   - Actions:
     - Emit stable session identity metadata from create/join responses (player/session/reconnect token contract).
     - Support reconnect-token reclaim during join flow while preserving seat ownership and authorization checks.
     - Keep requestId-correlated normalized error envelopes.
   - Done when:
     - Client can refresh and rejoin same seat using stored reconnect token.
     - Route/integration tests verify issued identity metadata and reclaim behavior.

5. [x] `P0` Expose realtime transport endpoint for browser clients
   - Files:
     - `apps/server/src/realtime/wsServer.ts` (new)
     - `apps/server/src/realtime/socketServer.ts`
     - `apps/server/src/server.ts`
     - `apps/server/test/realtime-transport.test.ts` (new)
   - Actions:
     - Add websocket endpoint that authenticates/binds sessions to lobby/game rooms.
     - Bridge transport lifecycle to existing in-memory hub and session connection tracking.
     - Ensure disconnects trigger reconnect-window behavior hooks.
   - Done when:
     - Multiple browser-like clients receive ordered realtime event batches for the same room.
     - Transport tests cover connect, subscribe, disconnect, and reconnect flow.

6. [x] `P0` Replace web shell with modular app architecture for lobby/game/help routes
   - Files:
     - `apps/web/src/main.tsx`
     - `apps/web/src/app/router.ts` (new)
     - `apps/web/src/styles/theme.css` (new)
     - `apps/web/src/pages/LobbyPage.tsx` (new)
     - `apps/web/src/pages/GamePage.tsx` (new)
     - `apps/web/src/pages/HelpPage.tsx` (new)
   - Actions:
     - Move from single-file template shell to page modules and shared layout primitives.
     - Preserve responsive baseline for mobile + desktop during refactor.
   - Done when:
     - Route switching renders page modules instead of inline hardcoded view text.
     - App loads without regressions in existing smoke checks.

7. [x] `P0` Build typed web API/session client layer
   - Files:
     - `apps/web/src/lib/httpClient.ts` (new)
     - `apps/web/src/lib/session.ts` (new)
     - `apps/web/src/lib/requestId.ts` (new)
     - `apps/web/test/session.test.ts` (new)
   - Actions:
     - Add typed wrappers for lobby/action endpoints and normalized error handling.
     - Persist reconnect/session metadata in browser storage.
     - Reuse requestId generation across HTTP and realtime correlation surfaces.
   - Done when:
     - Refresh retains client identity metadata needed for reconnect.
     - Session tests verify storage hydration, update, and clear behavior.

8. [x] `P0` Implement unified client event reducer and realtime lifecycle client
   - Files:
     - `apps/web/src/realtime/client.ts` (new)
     - `apps/web/src/state/gameStore.ts` (new)
     - `apps/web/src/state/reducer.ts` (new)
     - `apps/web/test/state-reducer.test.ts` (new)
   - Actions:
     - Route both HTTP `outbound` events and websocket events through a single reducer path.
     - Handle stale/duplicate events deterministically.
     - Surface `action.rejected` and `system.notice` messages for user feedback.
   - Done when:
     - Equivalent event sequences from HTTP vs realtime produce identical client state snapshots.
     - Reducer tests cover out-of-order and duplicate-event guards.

9. [x] `P0` Implement lobby and join UX
   - Files:
     - `apps/web/src/pages/LobbyPage.tsx`
     - `apps/web/src/components/SeatGrid.tsx` (new)
     - `apps/web/src/components/StartControls.tsx` (new)
     - `apps/web/test/lobby-page.test.ts` (new)
   - Actions:
     - Build create/join/update-name/start flows with seat/team visualization.
     - Show host-only start controls and readiness states for all four seats.
     - Surface invite-link copy/share affordance.
   - Done when:
     - Four players can create/join/start from browser UI without manual API calls.
     - Lobby UI reflects connected/disconnected seat state changes in realtime.

10. [x] `P0` Implement gameplay surface with legal action feedback
   - Files:
     - `apps/web/src/pages/GamePage.tsx`
     - `apps/web/src/components/BiddingPanel.tsx` (new)
     - `apps/web/src/components/CardHand.tsx` (new)
     - `apps/web/src/components/TrickTable.tsx` (new)
     - `apps/web/src/components/Scoreboard.tsx` (new)
     - `apps/web/test/game-page.test.ts` (new)
   - Actions:
     - Render bidding prompts, trick progression, trump/dealer/turn indicators, and team score context.
     - Enable/disable controls according to server-projected legal action state.
     - Submit bidding/play intents and display pending/reject status inline.
   - Done when:
     - UI clearly blocks illegal actions and displays rejection reason text when server rejects.
     - Phase transitions (deal -> bidding -> play -> score -> next hand) are visible in UI state.

11. [x] `P1` Implement reconnect recovery UX and lifecycle messaging
   - Files:
     - `apps/web/src/app/bootstrap.ts` (new)
     - `apps/web/src/lib/session.ts`
     - `apps/web/src/realtime/client.ts`
     - `apps/web/test/reconnect-ui.test.ts` (new)
   - Actions:
     - Attempt automatic rejoin on app load using stored reconnect metadata.
     - Show reconnecting/disconnected/forfeit notices with clear next steps.
     - Prevent stale session metadata from causing ghost-seat UI state.
   - Done when:
     - Browser refresh within reconnect window reclaims prior seat automatically.
     - Expired reconnect path lands in clear failure state without silent desync.

12. [x] `P1` Add accessibility and responsive UX hardening
   - Files:
     - `apps/web/src/styles/theme.css`
     - `apps/web/src/components/*.tsx`
     - `apps/web/test/accessibility-smoke.test.ts` (new)
   - Actions:
     - Add keyboard support and visible focus states for interactive controls.
     - Validate semantic labels/roles for lobby and gameplay controls.
     - Harden layouts for common mobile and desktop breakpoints.
   - Done when:
     - Keyboard-only user can complete create/join/start and at least one gameplay action.
     - No blocking layout breakpoints at narrow mobile widths.

13. [x] `P1` Add cross-package client/server contract coverage
   - Files:
     - `apps/server/test/integration/client-contract.test.ts` (new)
     - `apps/web/test/contract-events.test.ts` (new)
     - `packages/protocol/test/client-server-contract.test.ts` (new)
   - Actions:
     - Encode golden create/join/start/bid/play/reconnect event sequences.
     - Assert parity between HTTP `outbound` envelopes and websocket-delivered events.
     - Gate protocol changes with compatibility assertions.
   - Done when:
     - Contract tests fail on payload/schema drift before manual QA catches regressions.

14. [x] `P2` Update docs and checkpoint artifacts for Phase 4 handoff
   - Files:
     - `apps/web/README.md` (new)
     - `apps/server/README.md`
     - `README.md`
     - `thoughts/shared/research/006_phase4_client_runtime_snapshot.md` (new)
     - `thoughts/shared/sessions/005_phase4_kickoff.md` (new)
   - Actions:
     - Document runtime wiring, transport contract, and client state architecture.
     - Add local multi-client smoke workflow and reconnect troubleshooting notes.
     - Capture checkpoint artifact for next-phase continuity.
   - Done when:
     - A new contributor can run server + web and validate a full multiplayer flow using docs only.

## Dependency Chain
1. Task 1 is the runtime foundation for Tasks 4, 5, and all browser integration work.
2. Tasks 2-3 define required protocol/state surface before Tasks 8-10 can be fully implemented.
3. Task 4 depends on Task 1 and informs Task 7 session persistence behavior.
4. Task 5 depends on Task 1 and feeds Task 8 realtime client implementation.
5. Task 6 can begin early, but final wiring depends on Tasks 7-8.
6. Task 7 depends on Task 4 response contract stability.
7. Task 8 depends on Tasks 3 and 5 for event shape and transport availability.
8. Tasks 9-10 depend on Tasks 6-8.
9. Task 11 depends on Tasks 4, 5, and 7-8.
10. Task 12 depends on Tasks 9-10 baseline UI completeness.
11. Task 13 depends on Tasks 2-5 and 8-11.
12. Task 14 closes after Tasks 1-13 are stable.

## Phase 4 Exit Checklist
- [x] Default server runtime executes real lobby/action commands without fallback dispatcher errors.
- [x] Browser client supports create/join/start plus full bidding + trick gameplay loops.
- [x] Realtime transport delivers ordered authoritative updates to all connected players.
- [x] Reconnect within window restores same seat/context; timeout path shows clear forfeit outcome.
- [x] Desktop and mobile gameplay remain usable without blocking UX issues.
- [x] Contract tests guard protocol/runtime drift between server and web client.

### Validation Snapshot - 2026-02-24 (UTC)
- `pnpm --filter @fun-euchre/protocol test` passes.
- `pnpm --filter @fun-euchre/server test` passes (requires localhost bind permissions for integration tests).
- `pnpm --filter @fun-euchre/web test` passes.
- Live dev smoke via web proxy (`PUBLIC_ORIGIN=http://192.168.40.150:5173`) passes: create/join/start/action + websocket subscribe + invite link host/hash checks.
- LAN-host smoke via `http://192.168.40.150:5173` passes: endpoint reachability, websocket subscribe, reconnect reclaim (`playerId` preserved), and in-game late-join rejection (`409 INVALID_STATE`).
- Manual cross-device validation with a second machine remains pending.

## Verification Commands (when Node/pnpm are available)
```bash
pnpm --filter @fun-euchre/protocol test
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/web typecheck
pnpm lint
pnpm typecheck
pnpm test
```

## Suggested Immediate Start Sequence
1. Execute Tasks 1-3 to establish runtime + protocol foundations.
2. Execute Tasks 4-5 to complete identity/reconnect and realtime transport contracts.
3. Execute Tasks 6-8 to establish web architecture and event/state plumbing.
4. Execute Tasks 9-11 for playable UX and reconnect behavior.
5. Finish Tasks 12-14 for hardening, contract confidence, and handoff artifacts.

## Progress Checkpoint - 2026-02-23 23:55 CST

### Work Completed This Session
- [x] Completed Phase 4 Tasks 1-14 implementation and stabilization across server, protocol, and web packages.
- [x] Fixed browser module/runtime integration using import maps plus dev-server HTTP/WS proxy routes.
- [x] Added cross-device invite origin configuration (`PUBLIC_ORIGIN`) and invite link override plumbing.
- [x] Validate the final cross-device lobby-join flow from a second machine with `PUBLIC_ORIGIN` configured.

### Current State
- **Active File**: `apps/web/src/pages/LobbyPage.tsx:1`
- **Current Task**: Execute final manual multi-device invite/join verification with `PUBLIC_ORIGIN` configured.
- **Blockers**: Requires a second machine/device on reachable network for end-to-end invite validation.

### Local Changes
- Modified: `thoughts/shared/plans/005_phase4_client_runtime_and_gameplay_detailed_task_list.md` - Added this progress checkpoint.
- Untracked: `thoughts/shared/sessions/006_phase4_runtime_multiclient_followup.md` - Session handoff summary for resume context.
- Untracked: `tsc` - Empty local artifact intentionally excluded from checkpoint commits.

### Next Steps
1. Run server and web with `PUBLIC_ORIGIN` set to a network-reachable host URL, then open an invite link from a second machine.
2. Execute multiplayer smoke flow (create, join, start, bid/play, reconnect) and capture any remaining regressions.
3. If validation passes, mark the cross-device follow-up complete and prepare Phase 5 handoff.

## Progress Checkpoint - 2026-02-24 15:32 UTC

### Work Completed This Session
- [x] Ran live runtime smoke against running server + web dev proxy with `PUBLIC_ORIGIN` configured.
- [x] Verified `/app-config.js` exposes configured `PUBLIC_ORIGIN`.
- [x] Verified `/lobbies/create`, `/lobbies/join`, `/lobbies/start`, and `/actions` succeed through web proxy.
- [x] Verified websocket proxy (`/realtime/ws`) emits `ws.ready`, `ws.subscribed`, and live `lobby.state`/`game.state` events.
- [x] Verified invite links resolve with `PUBLIC_ORIGIN` and `#/lobby?lobbyId=...` hash payload.
- [x] Validate from a physically separate second device/browser on the same network.

### Commands Executed
```bash
PUBLIC_ORIGIN=http://192.168.40.150:5173 API_ORIGIN=http://127.0.0.1:3000 pnpm --filter @fun-euchre/web dev
pnpm --filter @fun-euchre/server dev
node --input-type=module - <<'NODE'
# smoke flow: config check + create/join/start/pass + websocket subscribe + invite link assertion
NODE
```

## Progress Checkpoint - 2026-02-24 15:35 UTC

### Work Completed This Session
- [x] Validated LAN-host access path by executing smoke traffic directly against `http://192.168.40.150:5173`.
- [x] Confirmed reconnect reclaim behavior via `/lobbies/join` with reconnect token preserves `playerId`.
- [x] Confirmed non-reconnect in-game join attempts are rejected with `409 INVALID_STATE`.
- [x] Confirm identical behavior from a physically separate device/browser over LAN.

### Validation Artifacts
- Reconnect reclaim sample: `guestBPlayerId=runtime-player-5` and `reconnectPlayerId=runtime-player-5`.
- Invite sample: `http://192.168.40.150:5173/?lobbyId=runtime-lobby-1#/lobby?lobbyId=runtime-lobby-1`.

## Progress Checkpoint - 2026-02-24 15:45 UTC

### Work Completed This Session
- [x] Reproduced the manual second-device flow with live logs attached.
- [x] Confirmed second-device join success and host visibility after user validation.
- [x] Confirmed multi-client behavior across two devices and three browsers.
- [x] Closed final manual cross-device validation follow-up.

### Commands to Resume
```bash
cd /Users/seanzach/DEV/funEuchre
git status
$implement-plan thoughts/shared/plans/005_phase4_client_runtime_and_gameplay_detailed_task_list.md
```
