# Phase 2 Detailed Task List: Rules Engine and Deterministic Game Domain

Source:
- `thoughts/shared/plans/001_multiplayer_web_euchre_mvp.md` (Phase 2 section)
- `docs/requirements.md` (Sections 7, 10, 12)
- `docs/rules_of_euchre.md` (MVP defaults)

## Direction Locked In
- Standardize on flat ESLint configuration (`eslint.config.cjs`) for ongoing work.
- Treat `dist` and `dist-test` as generated outputs only (already ignored).
- Start Phase 2 with a detailed implementation task list before coding.

## Scope of Phase 2
Implement a pure, deterministic `@fun-euchre/game-rules` package that models:
- Card/trump rules including left/right bower behavior.
- Bidding flow (round 1, round 2, pass/redeal, going alone).
- Legal play validation and trick resolution.
- Hand and game scoring through game end at 10 points.

Out of scope for this phase:
- HTTP/socket transport.
- Lobby/session/reconnect persistence mechanics.
- Web UI interactions and rendering.

## Priority Legend
- `P0` = Blocks all gameplay/server integration work.
- `P1` = Required for high-confidence integration in Phase 3.
- `P2` = Strong hardening tasks that can finish after core engine completeness.

## Execution Status (2026-02-23)
- [x] Task 1 implemented: `packages/game-rules/package.json`, `packages/game-rules/tsconfig.json`, `packages/game-rules/tsconfig.test.json`, and `packages/game-rules/src/index.ts` created.
- [x] Task 1 command verification (`pnpm --filter @fun-euchre/game-rules build`) confirmed by human tester
- [x] Task 2 implemented: `packages/game-rules/src/types.ts`, `packages/game-rules/src/cards.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/cards.test.ts`.
- [x] Task 2 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 3 implemented: `packages/game-rules/src/trump.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/trump.test.ts`.
- [x] Task 3 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 4 implemented: `packages/game-rules/src/deck.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/deck.test.ts`.
- [x] Task 4 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 5 implemented: `packages/game-rules/src/deal.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/deal.test.ts`.
- [x] Task 5 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 6 implemented: `packages/game-rules/src/bidding.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/bidding.test.ts`.
- [x] Task 6 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 7 implemented: `packages/game-rules/src/trick.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/trick.test.ts`.
- [x] Task 7 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 8 implemented: `packages/game-rules/src/trick.ts` winner-resolution helpers and `packages/game-rules/test/trick-winner.test.ts`.
- [x] Task 8 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 9 implemented: `packages/game-rules/src/scoring.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/scoring.test.ts`.
- [x] Task 9 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 10 implemented: `packages/game-rules/src/gameState.ts`, `packages/game-rules/src/index.ts` exports, and `packages/game-rules/test/gameState.test.ts`.
- [x] Task 10 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 11 implemented: `packages/game-rules/test/scenarios/full-hand.test.ts` and `packages/game-rules/test/scenarios/full-game.test.ts`, plus package test script updated to run scenario tests.
- [x] Task 11 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 12 implemented: `packages/game-rules/test/protocol-compat.test.ts` validates game reject taxonomy compatibility with `@fun-euchre/protocol` reject codes and verifies trick-reject mapping.
- [x] Task 12 command verification (`pnpm --filter @fun-euchre/game-rules test`) confirmed by human tester.
- [x] Task 13 implemented: removed legacy `.eslintrc.cjs` and standardized on flat config `eslint.config.cjs` as single lint source.
- [x] Task 13 command verification (`pnpm lint`) confirmed by human tester.
- [x] Task 14 implemented: added `packages/game-rules/README.md` and updated root `README.md` with rules-package documentation link.
- [x] Coverage hardening pass completed: added reducer/trick tests for all-pass redeal and alone-hand turn progression/opening-lead behavior.

## Ordered Task List

1. `P0` Create `packages/game-rules` workspace scaffold
   - Files:
     - `packages/game-rules/package.json`
     - `packages/game-rules/tsconfig.json`
     - `packages/game-rules/tsconfig.test.json`
     - `packages/game-rules/src/index.ts`
   - Actions:
     - Add build/typecheck/lint/test scripts aligned with existing workspaces.
     - Export package as ESM with declaration output.
   - Done when:
     - `pnpm --filter @fun-euchre/game-rules build` succeeds.
     - Package can be imported by typecheck in another workspace.

2. `P0` Establish domain primitives for cards and suits
   - Files:
     - `packages/game-rules/src/cards.ts`
     - `packages/game-rules/src/types.ts`
   - Actions:
     - Define `Suit`, `Rank`, `Card`, and canonical ordering for Euchre ranks (9-A).
     - Add card identity format and parse/format helpers for deterministic tests.
   - Done when:
     - Unit tests verify all 24 unique card identities.
     - Invalid suit/rank/card inputs are rejected.

3. `P0` Implement trump/effective-suit logic
   - Files:
     - `packages/game-rules/src/trump.ts`
     - `packages/game-rules/test/trump.test.ts`
   - Actions:
     - Implement `isRightBower`, `isLeftBower`, `effectiveSuit`.
     - Implement trump-aware card comparison for led-suit vs trump cases.
   - Done when:
     - Tests cover all four trump suits and both bowers.
     - Follow-suit edge cases with left bower pass.

4. `P0` Implement deterministic deck creation and shuffling
   - Files:
     - `packages/game-rules/src/deck.ts`
     - `packages/game-rules/test/deck.test.ts`
   - Actions:
     - Generate exact 24-card deck (9, 10, J, Q, K, A by suit).
     - Implement pure shuffle function that accepts injected RNG for repeatable tests.
   - Done when:
     - Tests confirm deck size/content/uniqueness.
     - Same seed produces identical ordering.

5. `P0` Implement dealing model and dealer rotation helpers
   - Files:
     - `packages/game-rules/src/deal.ts`
     - `packages/game-rules/test/deal.test.ts`
   - Actions:
     - Encode seat order and dealer-left lead semantics.
     - Deal five cards per player, surface upcard, and remaining kitty state.
   - Done when:
     - Tests validate hand sizes and card conservation.
     - Dealer rotation helper is deterministic and consistent.

6. `P0` Implement bidding state machine
   - Files:
     - `packages/game-rules/src/bidding.ts`
     - `packages/game-rules/test/bidding.test.ts`
   - Actions:
     - Model round-1 order-up/pass and dealer pickup/discard behavior.
     - Model round-2 call/pass with turned-down suit disallowed.
     - Model all-pass redeal by next dealer (no stick-the-dealer per MVP).
     - Support “go alone” declaration at trump-fix decision point.
   - Done when:
     - Tests cover full pass cycles, legal/illegal calls, and redeal transition.
     - Tests verify alone-state partner sits out.

7. `P0` Implement trick play state and legal action checks
   - Files:
     - `packages/game-rules/src/trick.ts`
     - `packages/game-rules/test/trick.test.ts`
   - Actions:
     - Track trick leader, plays in order, and current lead suit.
     - Enforce turn order and follow-suit constraints using effective suit logic.
     - Return explicit machine-readable reject reasons for invalid play attempts.
   - Done when:
     - Tests reject out-of-turn and revoke attempts.
     - Tests pass for left-bower follow-suit scenarios.

8. `P0` Implement trick winner resolution
   - Files:
     - `packages/game-rules/src/trick.ts`
     - `packages/game-rules/test/trick-winner.test.ts`
   - Actions:
     - Resolve each completed trick using trump + lead precedence.
     - Determine next leader from trick winner.
   - Done when:
     - Tests cover no-trump-in-trick, single trump, multiple trump, and bower ordering.

9. `P0` Implement hand scoring and game scoring rules
   - Files:
     - `packages/game-rules/src/scoring.ts`
     - `packages/game-rules/test/scoring.test.ts`
   - Actions:
     - Score makers/defenders outcomes including euchre and march.
     - Score lone-hand outcomes including 4-point lone march.
     - Evaluate game-over threshold at 10 points.
   - Done when:
     - Tests cover all scoring rows from MVP defaults.
     - Tests confirm game-over detection.

10. `P1` Implement top-level game state reducer/API
    - Files:
      - `packages/game-rules/src/gameState.ts`
      - `packages/game-rules/src/index.ts`
      - `packages/game-rules/test/gameState.test.ts`
    - Actions:
      - Define explicit phases: `deal`, `round1_bidding`, `round2_bidding`, `play`, `score`, `completed`.
      - Implement pure `applyAction(state, action)` with typed action/result union.
      - Emit rejection metadata suitable for mapping to protocol reject codes.
    - Done when:
      - Tests verify legal phase transitions only.
      - Invalid transitions produce deterministic errors.

11. `P1` Add deterministic full-hand and full-game simulation tests
    - Files:
      - `packages/game-rules/test/scenarios/full-hand.test.ts`
      - `packages/game-rules/test/scenarios/full-game.test.ts`
    - Actions:
      - Build fixed-seed/fixed-deck scenario harness for reproducible end-to-end outcomes.
      - Validate sequence: deal -> bidding -> five tricks -> score -> next hand until game end.
    - Done when:
      - A full-game test runs without non-deterministic failures.
      - Snapshot/state assertions prove repeatability.

12. `P1` Wire protocol compatibility checks
    - Files:
      - `packages/game-rules/test/protocol-compat.test.ts`
      - `packages/protocol/src/index.ts` (if needed for reject mapping additions)
    - Actions:
      - Verify game-rules rejection taxonomy maps cleanly to protocol reject codes.
      - Identify and document any protocol changes needed before Phase 3 integration.
    - Done when:
      - Compatibility tests pass or follow-up protocol deltas are explicitly documented.

13. `P1` Standardize lint configuration usage to flat config only
    - Files:
      - `eslint.config.cjs`
      - `.eslintrc.cjs` (remove)
      - package-level lint scripts as needed
    - Actions:
      - Remove legacy config to eliminate dual-source lint behavior.
      - Confirm all lint commands still pass using flat config.
    - Done when:
      - Repository has a single ESLint config source.
      - `pnpm lint` passes without behavior changes.

14. `P2` Add lightweight developer docs for rules package
    - Files:
      - `packages/game-rules/README.md`
      - `README.md` (short link/update)
    - Actions:
      - Document public API, deterministic test approach, and invariants.
      - Include example of applying an action and handling rejection.
    - Done when:
      - Another contributor can run and extend game-rules tests without reverse engineering internals.

## Dependency Chain
1. Task 1 -> Tasks 2, 3, 4.
2. Tasks 2, 3, 4 -> Task 5.
3. Tasks 3, 5 -> Task 6.
4. Tasks 3, 6 -> Tasks 7, 8.
5. Tasks 6, 7, 8 -> Task 9.
6. Tasks 5-9 -> Task 10.
7. Task 10 -> Tasks 11, 12.
8. Task 13 can run in parallel after Task 1.
9. Task 14 runs after Task 10 stabilizes.

## Phase 2 Exit Checklist
- [x] `packages/game-rules` exists with build/typecheck/lint/test scripts.
- [x] Bower/effective-suit logic is covered by deterministic unit tests.
- [x] Bidding and trick-play legality are enforced by pure domain logic.
- [x] Scoring covers makers/euchre/march/loner outcomes and game-to-10 completion.
- [x] Full-hand and full-game deterministic scenario tests pass.
- [x] Protocol compatibility risks for Phase 3 are identified and documented.
- [x] Repository linting is standardized on flat config only.

## Progress Checkpoint - 2026-02-24 00:23 UTC

### Work Completed This Session
- [x] Completed Phase 2 implementation of `@fun-euchre/game-rules`.
- [x] Added coverage hardening for all-pass redeal and alone-hand turn progression.
- [x] Verified flat ESLint standardization and Phase 2 exit checklist completion.

### Current State
- **Active File**: `packages/game-rules/src/gameState.ts:338`
- **Current Task**: Save Phase 2 completion checkpoint and session handoff notes.
- **Blockers**: None.

### Local Changes
- Modified: None (clean working tree after commit `ee3e6b7`).
- Untracked: None.

### Next Steps
1. Start Phase 3 integration by wiring `@fun-euchre/game-rules` into server/session orchestration.
2. Define protocol-to-rules adapter boundaries (action mapping, reject handling, deterministic replay paths).

### Commands to Resume
```bash
cd /Users/seanzach/DEV/funEuchre
git status
$implement-plan thoughts/shared/plans/003_phase2_rules_engine_detailed_task_list.md
```

## Verification Commands (when Node/pnpm are available)
```bash
pnpm --filter @fun-euchre/game-rules lint
pnpm --filter @fun-euchre/game-rules typecheck
pnpm --filter @fun-euchre/game-rules test
pnpm lint
pnpm typecheck
pnpm test
```

## Suggested Immediate Start Sequence
1. Execute Tasks 1-4 first to establish package and immutable card/trump/deck primitives.
2. Implement Tasks 5-10 as the vertical “single hand to score” slice.
3. Finish with Tasks 11-14 for deterministic confidence and integration readiness.
