---
date: 2026-02-24T10:20:00Z
researcher: Codex
topic: "Phase 4 client runtime and gameplay snapshot"
tags: [research, phase4, web, runtime, reconnect, contract]
status: complete
---

# Research: Phase 4 Client Runtime Snapshot

## Research Goal

Capture the implemented Phase 4 browser/runtime state, contract coverage posture, and handoff guidance for post-Phase-4 work.

## Summary

Phase 4 implementation is now documented and test-backed across server, web, protocol, and cross-contract paths.

Current baseline includes:

- default server runtime orchestration wired in `createAppServer()`,
- public websocket transport endpoint with session-bound subscription,
- web modular route architecture with lobby/game/help surfaces,
- unified reducer ingestion for HTTP and realtime events,
- reconnect bootstrap with stale-session protection,
- accessibility/responsive hardening,
- cross-package contract tests for create/join/start/bid/play/reconnect flows.

## Implemented Phase 4 Architecture

### 1) Server Runtime Orchestration

Key files:

- `apps/server/src/server.ts`
- `apps/server/src/runtime/orchestrator.ts`
- `apps/server/src/runtime/dispatchers.ts`

What is wired by default:

- lobby/game/session in-memory stores,
- reconnect policy and reconnect-token reclaim,
- authoritative game manager,
- lobby/action command dispatchers,
- in-memory fanout + websocket transport bridge.

### 2) Protocol Surface Expansion

Key file:

- `packages/protocol/src/index.ts`

Contract supports full Phase 4 input intent set:

- `game.pass`
- `game.order_up`
- `game.call_trump`
- `game.play_card`

Validation and parse paths are covered by protocol tests and downstream integration tests.

### 3) Realtime Transport

Key files:

- `apps/server/src/realtime/wsServer.ts`
- `apps/server/src/realtime/socketServer.ts`

Transport behavior:

- websocket upgrade at `/realtime/ws`,
- auth via `sessionId` + `reconnectToken`,
- subscribe contract with lobby/game authorization checks,
- control frames: `ws.ready`, `ws.subscribed`, `ws.error`,
- protocol events emitted as websocket messages.

### 4) Web Runtime and State Model

Key files:

- `apps/web/src/main.tsx`
- `apps/web/src/app/bootstrap.ts`
- `apps/web/src/state/reducer.ts`
- `apps/web/src/realtime/client.ts`

Client model:

- app bootstraps session and attempts auto-rejoin,
- HTTP and websocket events converge through one reducer,
- duplicate and stale events are handled deterministically,
- reconnect/disconnect/error lifecycle feedback is surfaced in UI.

### 5) Gameplay and UX Surfaces

Key files:

- `apps/web/src/pages/LobbyPage.tsx`
- `apps/web/src/pages/GamePage.tsx`
- `apps/web/src/components/*.tsx`
- `apps/web/src/styles/theme.css`

Delivered user-facing behavior:

- create/join/update-name/start lobby controls,
- bidding and play controls with legal-action gating,
- inline rejection/notice feedback,
- responsive and keyboard-friendly controls.

## Contract Coverage Baseline

New/updated coverage includes:

- server: `apps/server/test/integration/client-contract.test.ts`
- web: `apps/web/test/contract-events.test.ts`
- protocol: `packages/protocol/test/client-server-contract.test.ts`

Coverage intent:

- detect payload drift between HTTP outbound and websocket delivery,
- enforce stable create/join/start/bid/play/reconnect sequences,
- keep client reducer behavior deterministic under replay/duplicate conditions.

## Known Constraints

1. Runtime stores are still in-memory only (restart clears active sessions/games).
2. Anonymous session model remains the MVP authentication approach.
3. Reducer duplicate guard is payload-key based (exact event replay is intentionally dropped).
4. Production concerns (durability, distributed fanout, deployment hardening) remain Phase 5+.

## Handoff Guidance

1. Keep `packages/protocol` as the source of truth and gate changes with contract tests.
2. Preserve parity requirement: HTTP `outbound` and websocket events must remain interchangeable for the web reducer.
3. If private-state fanout requirements expand, wire seat-scoped projections explicitly and add contract tests before UI reliance.
4. For persistence migration, preserve reconnect/session semantics first, then replace store backends behind existing interfaces.

## Recommended Next Focus

- Phase 5 hardening: persistence strategy, reconnect durability, and distributed realtime transport design.
