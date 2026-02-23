# Phase 1 Prioritized Task List

Source: `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` (Phase 1: Foundation and Technical Baseline)

## Execution Status (2026-02-23)
- [x] Task 1 implementation started and root workspace files were added (`package.json`, `pnpm-workspace.yaml`).
- [x] `pnpm install` verification passed.
- [x] `pnpm -r exec pwd` verification passed (workspace packages now resolve).
- [x] Task 2 implementation completed: `tsconfig.base.json` plus package-level `tsconfig.json` files for `apps/server`, `apps/web`, and `packages/protocol`.
- [x] Task 2 config validation passed via direct `tsc` checks (`apps/server`, `apps/web`, `packages/protocol`).
- [x] Full Task 2 verification via `pnpm -r --if-present typecheck` passed.
- [x] Task 3 implementation completed: package manifests added for `apps/server`, `apps/web`, and `packages/protocol`.
- [x] Task 3 verification passed via `pnpm -r build`.
- [x] Task 4 implementation completed in `apps/server/src/index.ts` with configurable port and `/health` endpoint.
- [x] Task 4 static verification passed (`pnpm --filter @fun-euchre/server typecheck` and `pnpm --filter @fun-euchre/server build`).
- [x] Task 4 runtime verification completed successfully outside the sandbox (server returns expected `/health` response).
- [x] Task 5 implementation completed in `apps/web/src/main.tsx` with a routed, responsive shell and baseline desktop/mobile layout.
- [x] Task 5 static verification passed (`pnpm --filter @fun-euchre/web typecheck` and `pnpm --filter @fun-euchre/web build`).
- [x] Task 5 runtime verification completed successfully outside the sandbox (page renders as expected).
- [x] Task 6 implementation completed in `packages/protocol/src/index.ts` with shared event contracts and runtime validation functions.
- [x] Task 6 smoke test added and passing (`pnpm --filter @fun-euchre/protocol test`).
- [x] Task 6 integration verification passed (`pnpm --filter @fun-euchre/server typecheck` and `pnpm --filter @fun-euchre/web typecheck` with `@fun-euchre/protocol` imports).
- [x] Task 7 implementation completed with repository lint configuration (`.eslintrc.cjs`, `eslint.config.cjs`) and package-level lint scripts.
- [x] Task 7 verification passed (`pnpm lint` exits successfully with zero errors).
- [x] Task 8 implementation completed with CI workflow at `.github/workflows/ci.yml` (install, lint, typecheck, and unit-test jobs in fail-fast sequence).
- [x] Task 8 local gate verification passed (`pnpm lint`, `pnpm typecheck`, `pnpm test`).
- [x] Task 8 follow-up fix applied: root `lint`/`typecheck` now build `@fun-euchre/protocol` declarations first to avoid CI module-resolution failures on clean runners.
- [x] Task 8 final validation completed via successful GitHub PR checks.
- [x] Task 9 implementation completed with smoke tests in `apps/server/test/health.test.ts`, `apps/web/test/smoke.test.tsx`, and `packages/protocol/test/smoke.test.ts`.
- [x] Task 9 verification passed (`pnpm test` executes tests across all workspaces and passes).
- [x] Task 10 implementation completed with contributor onboarding documentation in `README.md`.

## Priority Legend
- `P0` = Blocker for all downstream phases
- `P1` = Required for stable team velocity
- `P2` = Nice-to-have in Phase 1 (can slip without blocking Phase 2)

## Ordered Task List

1. `P0` Create workspace root configuration
   - Files: `package.json`, `pnpm-workspace.yaml`
   - Actions:
     - Initialize monorepo workspaces for `apps/*` and `packages/*`.
     - Add root scripts: `dev`, `build`, `test`, `lint`, `typecheck`.
     - Add baseline dev dependencies used across the repo.
   - Done when:
     - `pnpm install` succeeds at repo root.
     - `pnpm -r exec pwd` resolves all workspace packages.

2. `P0` Define shared TypeScript baseline
   - Files: `tsconfig.base.json` plus per-package `tsconfig.json` files.
   - Actions:
     - Configure strict compiler options (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
     - Add shared path aliases for `@fun-euchre/*`.
   - Done when:
     - `pnpm typecheck` runs successfully for all workspace packages.

3. `P0` Scaffold package/application boundaries
   - Files/dirs:
     - `apps/server/package.json`
     - `apps/web/package.json`
     - `packages/protocol/package.json`
     - Corresponding `src/` directories
   - Actions:
     - Create minimal package manifests and build/test/typecheck scripts per workspace.
     - Wire each package to shared TypeScript config.
   - Done when:
     - `pnpm -r build` runs without missing-package errors.

4. `P0` Implement server bootstrap and health endpoint
   - File: `apps/server/src/index.ts`
   - Actions:
     - Start HTTP server with configurable port.
     - Add `/health` endpoint returning 200 and lightweight status payload.
   - Done when:
     - Server starts via `pnpm --filter @fun-euchre/server dev`.
     - `GET /health` returns 200 locally.

5. `P0` Implement web bootstrap shell
   - File: `apps/web/src/main.tsx`
   - Actions:
     - Create app root and router/layout shell.
     - Add responsive baseline layout for desktop/mobile viewports.
   - Done when:
     - `pnpm --filter @fun-euchre/web dev` serves the shell.
     - Main shell renders cleanly at common mobile and desktop widths.

6. `P1` Create shared protocol package baseline
   - File: `packages/protocol/src/index.ts`
   - Actions:
     - Define initial event contract types for lobby/game transport.
     - Establish runtime schema validation approach (e.g., zod-based schemas).
   - Done when:
     - Server and web can both import protocol types from `@fun-euchre/protocol`.
     - Protocol package has a passing unit smoke test.

7. `P1` Establish linting/format quality gate
   - File: `.eslintrc.cjs` (and optional ignore files)
   - Actions:
     - Configure strict linting with TypeScript support.
     - Add lint scripts at root and package levels.
   - Done when:
     - `pnpm lint` passes with zero errors.

8. `P1` Add CI workflow for baseline checks
   - File: `.github/workflows/ci.yml`
   - Actions:
     - Run install, lint, typecheck, and tests on pull requests.
     - Fail fast on any quality gate failure.
   - Done when:
     - CI workflow validates cleanly on a test PR.

9. `P2` Add minimal test scaffolds to prevent regressions
   - Files:
     - `apps/server/test/health.test.ts`
     - `apps/web/test/smoke.test.tsx`
     - `packages/protocol/test/smoke.test.ts`
   - Actions:
     - Add one smoke test per workspace to verify baseline wiring.
   - Done when:
     - `pnpm test` passes and executes tests across all workspaces.

10. `P2` Add developer onboarding short README
    - File: `README.md`
    - Actions:
      - Document Node/pnpm prerequisites and core commands.
      - Document local startup flow for server + web.
    - Done when:
      - A new contributor can run setup and start dev from README only.

## Dependency Chain
1. Task 1 -> Task 2 -> Task 3
2. Task 3 -> Tasks 4, 5, 6
3. Tasks 1-6 -> Task 7
4. Tasks 1-7 -> Task 8
5. Tasks 4-7 -> Task 9
6. Task 10 can run in parallel once Tasks 1-5 are stable

## Phase 1 Exit Checklist
- [x] `pnpm install` succeeds from a clean clone
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm dev` starts both server and web
- [x] Server `/health` endpoint is reachable
- [x] Web shell is usable on desktop and mobile viewport sizes

## Progress Checkpoint - 2026-02-23 23:08 UTC

### Work Completed This Session
- [x] Confirmed Phase 1 is complete with all tasks (1-10) and checklist items checked.
- [x] Finalized CI + local validation status for lint, typecheck, tests, and manual runtime checks.

### Current State
- **Active File**: `thoughts/shared/plans/002_phase1_prioritized_task_list.md:139`
- **Current Task**: Save progress checkpoint and session summary after Phase 1 completion.
- **Blockers**: None.

### Local Changes
- Modified: `thoughts/shared/plans/002_phase1_prioritized_task_list.md` - Added this checkpoint section.
- Added: `thoughts/shared/sessions/001_phase1_foundation_complete.md` - Session resume summary for Phase 1 completion.
- Untracked: `.DS_Store`, `.github/.DS_Store`, `apps/.DS_Store`, `thoughts/.DS_Store`, `thoughts/shared/.DS_Store` - Local OS metadata files not part of project work.

### Next Steps
1. Begin Phase 2 implementation (`Rules Engine and Deterministic Game Domain`).
2. Implement card/trump modeling in `packages/game-rules` with test-first coverage.

### Commands to Resume
```bash
cd /Users/seanzach/DEV/funEuchre
HOME=/tmp git status
$implement-plan thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md
```
