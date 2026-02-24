---
date: 2026-02-24T00:27:08Z
researcher: Codex
topic: "Analyze this codebase"
tags: [research, codebase, monorepo, game-rules, protocol]
status: complete
---

# Research: Analyze this codebase

## Research Question
Analyze this codebase.

## Summary
`funEuchre` is a TypeScript monorepo with four active workspaces: `apps/server`, `apps/web`, `packages/protocol`, and `packages/game-rules` ([pnpm-workspace.yaml:1](pnpm-workspace.yaml), [README.md:3](README.md#L3)). The strongest implemented domain is `@fun-euchre/game-rules` (deterministic reducers for deal/bidding/trick/score/full-hand state) plus protocol runtime validators ([packages/game-rules/src/gameState.ts:251](packages/game-rules/src/gameState.ts#L251), [packages/protocol/src/index.ts:318](packages/protocol/src/index.ts#L318)). Server and web apps are still Phase-1 shells (health endpoint + static routed UI) and do not yet wire multiplayer gameplay, realtime transport, or reconnect flows required by MVP requirements ([apps/server/src/index.ts:35](apps/server/src/index.ts#L35), [apps/web/src/main.tsx:19](apps/web/src/main.tsx#L19), [docs/requirements.md:58](docs/requirements.md#L58), [docs/requirements.md:69](docs/requirements.md#L69)).

## Detailed Findings

### Workspace Topology and Build Chain
- Root scripts orchestrate all packages and explicitly prebuild `@fun-euchre/protocol` before lint/typecheck/test to satisfy path dependencies ([package.json:7](package.json#L7), [tsconfig.base.json:16](tsconfig.base.json#L16)).
- CI enforces install -> lint -> typecheck -> unit-test on Node 22 + pnpm ([.github/workflows/ci.yml:14](.github/workflows/ci.yml#L14), [.github/workflows/ci.yml:82](.github/workflows/ci.yml#L82)).
- The plan document at `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` is stale: it still claims the repo is greenfield, while implementation now includes Phase 1 and Phase 2 deliverables ([thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md:7](thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md#L7), [thoughts/shared/sessions/002_phase2_rules_engine_complete.md:17](thoughts/shared/sessions/002_phase2_rules_engine_complete.md#L17)).

### Server App (`apps/server`)
- Current server is a single Node HTTP process with only `/health` and fallback `404` JSON ([apps/server/src/index.ts:25](apps/server/src/index.ts#L25), [apps/server/src/index.ts:35](apps/server/src/index.ts#L35), [apps/server/src/index.ts:61](apps/server/src/index.ts#L61)).
- It includes basic port validation and graceful SIGINT/SIGTERM shutdown ([apps/server/src/index.ts:13](apps/server/src/index.ts#L13), [apps/server/src/index.ts:69](apps/server/src/index.ts#L69)).
- There is no lobby/game command handling, no protocol parsing, and no realtime channel wiring yet.

### Web App (`apps/web`)
- Browser app is a route shell (`lobby|game|help`) rendered from static view metadata and hash routing ([apps/web/src/main.tsx:3](apps/web/src/main.tsx#L3), [apps/web/src/main.tsx:19](apps/web/src/main.tsx#L19), [apps/web/src/main.tsx:312](apps/web/src/main.tsx#L312)).
- It uses dynamic `innerHTML` rendering and inline-injected CSS (purposeful for scaffold stage, not yet state-driven gameplay UI) ([apps/web/src/main.tsx:70](apps/web/src/main.tsx#L70), [apps/web/src/main.tsx:284](apps/web/src/main.tsx#L284)).
- Development server serves `/dist/*` assets and otherwise falls back to `index.html` for client routing ([apps/web/dev-server.mjs:64](apps/web/dev-server.mjs#L64), [apps/web/dev-server.mjs:70](apps/web/dev-server.mjs#L70)).

### Shared Protocol (`packages/protocol`)
- Protocol package defines shared enums and event shapes for client/server messages with `PROTOCOL_VERSION` gating ([packages/protocol/src/index.ts:1](packages/protocol/src/index.ts#L1), [packages/protocol/src/index.ts:118](packages/protocol/src/index.ts#L118), [packages/protocol/src/index.ts:133](packages/protocol/src/index.ts#L133)).
- Runtime validation is explicit and strict for each event type, with parse helpers that throw on invalid payloads ([packages/protocol/src/index.ts:318](packages/protocol/src/index.ts#L318), [packages/protocol/src/index.ts:427](packages/protocol/src/index.ts#L427), [packages/protocol/src/index.ts:541](packages/protocol/src/index.ts#L541)).
- Reject taxonomy is kept compact and aligned with game-layer protocol mapping (`NOT_YOUR_TURN`, `INVALID_ACTION`, `INVALID_STATE`, `UNAUTHORIZED`) ([packages/protocol/src/index.ts:7](packages/protocol/src/index.ts#L7)).

### Game Rules Engine (`packages/game-rules`)
- Rules package is the most complete subsystem and follows pure-state transition design (`applyBiddingAction`, `applyTrickAction`, `applyGameAction`) ([packages/game-rules/src/bidding.ts:125](packages/game-rules/src/bidding.ts#L125), [packages/game-rules/src/trick.ts:190](packages/game-rules/src/trick.ts#L190), [packages/game-rules/src/gameState.ts:251](packages/game-rules/src/gameState.ts#L251)).
- Domain model covers card identity/parsing, trump effective suit, deterministic deck/deal, bidding rounds, lone-hand seat skipping, trick winner resolution, and scoring to target score ([packages/game-rules/src/cards.ts:37](packages/game-rules/src/cards.ts#L37), [packages/game-rules/src/trump.ts:50](packages/game-rules/src/trump.ts#L50), [packages/game-rules/src/deal.ts:76](packages/game-rules/src/deal.ts#L76), [packages/game-rules/src/scoring.ts:54](packages/game-rules/src/scoring.ts#L54)).
- Game phase lifecycle is explicit and finite: `deal -> round1_bidding/round2_bidding -> play -> score -> completed` ([packages/game-rules/src/gameState.ts:38](packages/game-rules/src/gameState.ts#L38)).

### Test Coverage Shape
- `game-rules` has broad unit + scenario coverage including full-hand/full-game deterministic simulations and protocol-code compatibility checks ([packages/game-rules/test/scenarios/full-game.test.ts:147](packages/game-rules/test/scenarios/full-game.test.ts#L147), [packages/game-rules/test/protocol-compat.test.ts:68](packages/game-rules/test/protocol-compat.test.ts#L68)).
- `protocol` has focused smoke-level validator tests ([packages/protocol/test/smoke.test.ts:11](packages/protocol/test/smoke.test.ts#L11)).
- `apps/server` and `apps/web` tests are mostly source/build artifact assertions, not end-to-end behavior tests ([apps/server/test/health.test.ts:10](apps/server/test/health.test.ts#L10), [apps/web/test/smoke.test.tsx:11](apps/web/test/smoke.test.tsx#L11)).
- In this shell, runtime verification was blocked because `node`, `npm`, and `pnpm` are unavailable (`command not found`).

### Gaps and Risks
- MVP requirements call for realtime multiplayer and reconnect/session recovery, but current app code does not implement these runtime paths yet ([docs/requirements.md:58](docs/requirements.md#L58), [docs/requirements.md:69](docs/requirements.md#L69), [apps/server/src/index.ts:35](apps/server/src/index.ts#L35)).
- `order_up` marks `dealerExchangeRequired`, but `applyGameAction` never performs dealer pickup/discard before play, so the round-1 upcard exchange rule is modeled in bidding state but not enforced in game-state transitions ([packages/game-rules/src/bidding.ts:179](packages/game-rules/src/bidding.ts#L179), [packages/game-rules/src/gameState.ts:338](packages/game-rules/src/gameState.ts#L338)).
- `apps/web/dev-server.mjs` uses a string-prefix `startsWith(distRoot)` check for path containment; this is weaker than segment-aware realpath validation and can allow reads outside the intended directory when sibling paths share the `dist` prefix ([apps/web/dev-server.mjs:40](apps/web/dev-server.mjs#L40), [apps/web/dev-server.mjs:43](apps/web/dev-server.mjs#L43)).

## Code References
- `package.json:7` - root orchestration scripts.
- `pnpm-workspace.yaml:1` - workspace boundaries.
- `tsconfig.base.json:16` - cross-package path alias coupling.
- `.github/workflows/ci.yml:14` - CI job chain start.
- `apps/server/src/index.ts:35` - current runtime server surface (`/health`).
- `apps/web/src/main.tsx:19` - route shell registry.
- `apps/web/dev-server.mjs:40` - static path sanitization logic.
- `packages/protocol/src/index.ts:318` - client-event validation switch.
- `packages/protocol/src/index.ts:427` - server-event validation switch.
- `packages/game-rules/src/gameState.ts:251` - top-level reducer.
- `packages/game-rules/src/bidding.ts:179` - round-1 dealer exchange flag.
- `packages/game-rules/test/scenarios/full-game.test.ts:147` - deterministic full-game simulation.
- `docs/requirements.md:58` - realtime requirement.
- `docs/requirements.md:69` - reconnect requirement.

## Architecture Insights
The architecture direction is clear and sound: protocol contracts + pure rules engine are separated from transport/UI, which reduces long-term rule bugs and keeps server authority straightforward. The practical delivery bottleneck is no longer domain rules; it is integration work in `apps/server` and `apps/web` to connect protocol events, lobby/session state, realtime transport, and reconnect policy to the completed rules package.

## Open Questions
- Should dealer upcard exchange be added as an explicit transition before entering `play` (or integrated into `order_up`) to fully match MVP rules?
- Should `apps/web/dev-server.mjs` harden path checks using realpath + relative-segment validation?
- Do you want the stale `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` updated so execution tracking matches current repository reality?
