---
date: 2026-02-23T23:14:24Z
researcher: Codex
topic: "Research this codebase"
tags: [research, codebase, monorepo, phase1, protocol]
status: complete
---

# Research: Research this codebase

## Research Question
Research this codebase.

## Summary
The repository is no longer a planning-only skeleton; it now has a working Phase 1 baseline with three implemented workspaces (`apps/server`, `apps/web`, `packages/protocol`) and CI/lint/typecheck/test wiring (`package.json:7`, `pnpm-workspace.yaml:1`, `thoughts/shared/plans/002_phase1_prioritized_task_list.md:5`). Runtime behavior is intentionally minimal: the server exposes only `/health`, the web app is a static routed shell, and the protocol package contains the most substantial logic via runtime event validators (`apps/server/src/index.ts:35`, `apps/web/src/main.tsx:19`, `packages/protocol/src/index.ts:318`). Core MVP gameplay capabilities from requirements (rules engine, real-time multiplayer, reconnect/session recovery) are not implemented yet and align with planned next phases (`docs/requirements.md:49`, `docs/requirements.md:58`, `docs/requirements.md:69`, `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:98`).

## Detailed Findings

### Repository Shape and Delivery Status
- The monorepo is configured for `apps/*` and `packages/*`, with root scripts orchestrating recursive workspace commands and a protocol prebuild for lint/typecheck (`pnpm-workspace.yaml:1`, `package.json:8`, `package.json:11`).
- Current implementation scope matches a completed Phase 1 baseline checklist (scaffolding, health endpoint, web shell, protocol contracts, CI, smoke tests, README) (`thoughts/shared/plans/002_phase1_prioritized_task_list.md:5`, `thoughts/shared/plans/002_phase1_prioritized_task_list.md:31`, `thoughts/shared/plans/002_phase1_prioritized_task_list.md:139`).
- `tsconfig.base.json` includes path aliases for `@fun-euchre/game-rules`, but no `packages/game-rules` directory exists yet, indicating forward-looking configuration for Phase 2 (`tsconfig.base.json:22`, `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:106`).

### Server App (`apps/server`)
- Server logic is a single HTTP entrypoint that resolves port/host, handles `/health`, and falls back to JSON 404s (`apps/server/src/index.ts:22`, `apps/server/src/index.ts:35`, `apps/server/src/index.ts:61`).
- `/health` supports only `GET`/`HEAD`; other methods return 405 with an `allow` header (`apps/server/src/index.ts:36`, `apps/server/src/index.ts:39`).
- Health payload is operational metadata (`status`, `service`, `uptimeSeconds`) and not game state (`apps/server/src/index.ts:45`).
- Shutdown handling for `SIGINT`/`SIGTERM` is present, but there are no lobby/game/realtime modules yet (`apps/server/src/index.ts:69`, `apps/server/src/index.ts:76`).

### Web App (`apps/web`)
- `src/main.tsx` implements a hash-based, three-tab shell (`lobby`, `game`, `help`) with static copy and no backend interaction (`apps/web/src/main.tsx:3`, `apps/web/src/main.tsx:19`, `apps/web/src/main.tsx:312`).
- The UI is rendered via `innerHTML` templates and inline-injected CSS variables/gradients; it is a layout scaffold rather than interactive gameplay logic (`apps/web/src/main.tsx:75`, `apps/web/src/main.tsx:284`).
- Route changes are handled by `hashchange`, with unknown hashes defaulting to `lobby` (`apps/web/src/main.tsx:259`, `apps/web/src/main.tsx:316`).
- Local serving is handled by a custom Node static server (`dev-server.mjs`) that serves `/dist/*` assets and otherwise returns `index.html` (`apps/web/dev-server.mjs:64`, `apps/web/dev-server.mjs:70`, `apps/web/dev-server.mjs:82`).

### Shared Protocol Package (`packages/protocol`)
- This is the most mature implementation area: it defines event/version contracts, enum domains, payload shapes, and runtime validation helpers (`packages/protocol/src/index.ts:1`, `packages/protocol/src/index.ts:15`, `packages/protocol/src/index.ts:63`).
- Client event validation enforces version, request ID, and per-event payload constraints for lobby/game intents (`packages/protocol/src/index.ts:263`, `packages/protocol/src/index.ts:318`, `packages/protocol/src/index.ts:404`).
- Server event validation covers lobby/game snapshots and error/notice channels with strict enum and structure checks (`packages/protocol/src/index.ts:427`, `packages/protocol/src/index.ts:438`, `packages/protocol/src/index.ts:505`).
- Parse helpers wrap validators and throw on invalid payloads, enabling fail-fast boundaries for transport layers (`packages/protocol/src/index.ts:541`, `packages/protocol/src/index.ts:550`).

### Testing and CI Quality Gates
- CI is set up with install -> lint -> typecheck -> unit-test jobs, each reinstalling dependencies on clean runners (`.github/workflows/ci.yml:14`, `.github/workflows/ci.yml:34`, `.github/workflows/ci.yml:82`).
- Server/web tests are currently smoke checks that assert source/build artifact characteristics rather than exercising HTTP/browser behavior end-to-end (`apps/server/test/health.test.ts:10`, `apps/web/test/smoke.test.tsx:11`).
- Protocol tests do validate parser behavior and rejection cases for malformed payloads (`packages/protocol/test/smoke.test.ts:11`, `packages/protocol/test/smoke.test.ts:71`).
- I could not execute project scripts in this shell because both `node` and `pnpm` are unavailable in the environment, so runtime verification here is static-only.

### Requirements Coverage Gap (Implemented vs Planned MVP)
- Requirements demand full server-authoritative gameplay (deal/bidding/legal-play/scoring), real-time synchronization, and reconnect recovery (`docs/requirements.md:49`, `docs/requirements.md:58`, `docs/requirements.md:69`).
- Current code does not yet implement lobby/session APIs, rule engine modules, realtime channels, or reconnect token/state stores; these appear in future-phase plan sections (`thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:150`, `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:165`, `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:180`).
- The plan’s “current state = greenfield” statement is stale relative to repository reality; Phase 1 artifacts now exist broadly across apps/packages (`thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:6`, `thoughts/shared/plans/002_phase1_prioritized_task_list.md:5`).

## Code References
- `package.json:7` - Root workspace orchestration scripts.
- `pnpm-workspace.yaml:1` - Workspace package discovery (`apps/*`, `packages/*`).
- `tsconfig.base.json:22` - `@fun-euchre/game-rules` path alias without current package implementation.
- `apps/server/src/index.ts:35` - `/health` route handling.
- `apps/server/src/index.ts:61` - Default 404 behavior.
- `apps/web/src/main.tsx:19` - Static route/view content registry.
- `apps/web/src/main.tsx:274` - Rendering path for current route.
- `apps/web/dev-server.mjs:64` - Custom static HTTP server entrypoint.
- `packages/protocol/src/index.ts:318` - Client event validator switch.
- `packages/protocol/src/index.ts:427` - Server event validator switch.
- `packages/protocol/src/index.ts:541` - Parse wrapper throwing on invalid client event.
- `apps/server/test/health.test.ts:10` - Server smoke test scope.
- `apps/web/test/smoke.test.tsx:11` - Web smoke test scope.
- `packages/protocol/test/smoke.test.ts:71` - Protocol invalid-payload rejection coverage.
- `.github/workflows/ci.yml:14` - CI job chain start.
- `docs/requirements.md:49` - Gameplay/rules requirements baseline.
- `docs/requirements.md:58` - Real-time synchronization requirements.
- `docs/requirements.md:69` - Reconnect behavior requirements.
- `thoughts/shared/plans/002_phase1_prioritized_task_list.md:5` - Phase 1 completion record.

## Architecture Insights
The architecture direction is consistent and sensible for a multiplayer card game: shared protocol contracts are extracted early, server authority is explicitly signaled, and the web client is currently a projection shell. The strongest implemented foundation today is type-safe event validation in `packages/protocol`; the weakest area is functional gameplay depth (currently stubbed). This means near-term delivery risk is concentrated in Phase 2/3 domain correctness and server-state orchestration, not in workspace/tooling fundamentals.

## Open Questions
- Should committed build outputs (`dist`/`dist-test`) remain in the repository long-term, or be removed in favor of generated-only artifacts?
- Do you want to keep both legacy and flat ESLint configs (`.eslintrc.cjs` and `eslint.config.cjs`) or standardize on one?
- Should Phase 2 begin by creating `packages/game-rules` immediately to match existing path aliases and reduce configuration drift?
