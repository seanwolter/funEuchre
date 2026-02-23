# Multiplayer Web Euchre MVP Implementation Plan

## Overview
Build a browser-based, invitation-only 4-player Euchre experience with an authoritative server, full rule validation, and reconnect support for temporary disconnects.

## Current State Analysis
- The repository is greenfield and currently contains only requirements in `docs/requirements.md`.
- No application scaffolding, runtime services, UI, tests, or deployment assets exist yet.
- Core product risks are in rule correctness, turn synchronization, and reconnect behavior under network instability.
- Key policy decisions are now finalized in `docs/requirements.md` Section 10 and should be treated as fixed inputs for implementation.

## Desired End State
- A deployable MVP where 4 invited players can create/join a game, complete full games to target score, and reconnect into active sessions without losing seats.
- Server fully validates game flow (bidding, legal card play, scoring, turn order, and trick resolution), and clients only render authoritative state.
- Desktop and mobile browsers support core gameplay flows without blocking usability issues.
- Verification:
  - Functional acceptance criteria in `docs/requirements.md` Section 12 pass.
  - P95 action-to-remote-update latency stays below 300 ms in staging conditions.
  - Disconnect recovery within configured window succeeds in at least 90% of controlled test runs.

## What We’re NOT Doing
- Public matchmaking
- Bots/AI players
- Tournament mode
- Native mobile apps
- Voice/video chat
- Ranked ladders, profiles, long-term stats/history
- Social systems beyond invite links and display names

## Implementation Approach
- Use a TypeScript monorepo with clear boundaries:
  - `apps/server`: authoritative game + session service with real-time transport
  - `apps/web`: responsive browser client
  - `packages/game-rules`: pure Euchre rules engine and state machine
  - `packages/protocol`: shared event payload schemas/types
- Enforce all game actions server-side through an event command layer; clients submit intents only.
- Build deterministic rules first, then integrate transport/lobby, then UI, then resilience/observability, then release hardening.
- Represent game flow as explicit state transitions to avoid implicit/hidden rule coupling.

## Phase 1: Foundation and Technical Baseline

### Overview
Establish project scaffolding, coding standards, shared types, and CI so later feature work lands on stable foundations.

### Changes Required:

#### 1. Repository and Workspace Scaffolding
**File**: `package.json`  
**Changes**: Define workspace scripts (`dev`, `build`, `test`, `lint`, `typecheck`) and toolchain dependencies.

**File**: `pnpm-workspace.yaml`  
**Changes**: Configure workspace package locations for `apps/*` and `packages/*`.

**File**: `tsconfig.base.json`  
**Changes**: Define strict TypeScript defaults and path aliases shared across workspace packages.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

#### 2. App/Package Skeleton
**File**: `apps/server/src/index.ts`  
**Changes**: Create server bootstrap entrypoint and health endpoint.

**File**: `apps/web/src/main.tsx`  
**Changes**: Create client bootstrap with router/layout shell.

**File**: `packages/protocol/src/index.ts`  
**Changes**: Add shared event contracts and runtime schema validation strategy.

#### 3. CI and Quality Gates
**File**: `.github/workflows/ci.yml`  
**Changes**: Add install, lint, typecheck, unit-test jobs and fail-fast behavior.

**File**: `.eslintrc.cjs`  
**Changes**: Enable strict lint rules aligned with server-authoritative architecture.

### Success Criteria:

#### Automated Verification:
- [ ] Workspace install succeeds: `pnpm install`
- [ ] Lint passes: `pnpm lint`
- [ ] Typecheck passes: `pnpm typecheck`
- [ ] Unit test scaffold runs: `pnpm test`

#### Manual Verification:
- [ ] `pnpm dev` starts both web and server locally
- [ ] Health endpoint responds and web shell loads on desktop and mobile viewport sizes

---

## Phase 2: Rules Engine and Deterministic Game Domain

### Overview
Implement an isolated, test-first Euchre engine that models deck, bidding, legal play, trick resolution, and scoring independent of transport/UI.

### Changes Required:

#### 1. Core Card and Trump Modeling
**File**: `packages/game-rules/src/cards.ts`  
**Changes**: Implement suit/rank enums, bowers, and effective suit logic.

**File**: `packages/game-rules/src/deck.ts`  
**Changes**: Implement 24-card deck generation and deterministic shuffle support for testing.

```ts
export function effectiveSuit(card: Card, trump: Suit): Suit {
  if (isRightBower(card, trump)) return trump;
  if (isLeftBower(card, trump)) return trump;
  return card.suit;
}
```

#### 2. Bidding, Turn Flow, and Play Validation
**File**: `packages/game-rules/src/bidding.ts`  
**Changes**: Model ordering up, passing, calling trump, and going alone options.

**File**: `packages/game-rules/src/trick.ts`  
**Changes**: Enforce follow-suit using effective suit and resolve trick winner.

**File**: `packages/game-rules/src/gameState.ts`  
**Changes**: Define explicit phase state machine (`deal`, `round1_bidding`, `round2_bidding`, `play`, `score`).

#### 3. Scoring and End Conditions
**File**: `packages/game-rules/src/scoring.ts`  
**Changes**: Implement team scoring rules, loner adjustments, euchre outcomes, and game completion threshold.

**File**: `packages/game-rules/test/*.test.ts`  
**Changes**: Add exhaustive rule tests for edge cases (left bower following, revoke attempts, loner scoring).

### Success Criteria:

#### Automated Verification:
- [ ] Rule engine unit tests pass: `pnpm --filter @fun-euchre/game-rules test`
- [ ] Mutation-sensitive edge cases are covered (bowers, trump shifts, illegal actions)
- [ ] Typecheck/lint pass for package

#### Manual Verification:
- [ ] Deterministic test scenario can simulate a full game end-to-end via CLI harness
- [ ] Illegal actions return explicit rejection reasons usable by UI

---

## Phase 3: Lobby, Sessions, and Authoritative Real-Time Server

### Overview
Build lobby creation/join/start flows, seat ownership, reconnect handling, and authoritative game action processing.

### Changes Required:

#### 1. Lobby and Seat Management APIs
**File**: `apps/server/src/http/lobbyRoutes.ts`  
**Changes**: Add endpoints for create lobby, join lobby, update display name, and start game.

**File**: `apps/server/src/domain/lobby.ts`  
**Changes**: Implement automatic 4-seat assignment, team mapping, and host start permissions.

#### 2. Real-Time Transport and Action Pipeline
**File**: `apps/server/src/realtime/socketServer.ts`  
**Changes**: Add authenticated socket session binding and room broadcast model.

**File**: `apps/server/src/domain/gameManager.ts`  
**Changes**: Serialize incoming player intents, apply through rules engine, and emit authoritative snapshots/diffs.

```ts
if (!isPlayersTurn(state, actorSeat)) {
  return reject("NOT_YOUR_TURN");
}
const nextState = applyAction(state, action);
broadcastGameState(gameId, nextState);
```

#### 3. Reconnect and State Retention
**File**: `apps/server/src/domain/sessionStore.ts`  
**Changes**: Store reconnect tokens with TTL and bind them to seat/game identity.

**File**: `apps/server/src/domain/gameStore.ts`  
**Changes**: Persist in-progress game snapshots for at least 15 minutes (in-memory + persistence adapter).

**File**: `apps/server/src/domain/reconnectPolicy.ts`  
**Changes**: Encode forfeit behavior when reconnect window expires.

### Success Criteria:

#### Automated Verification:
- [ ] Integration tests pass for create/join/start/rejoin flows: `pnpm --filter @fun-euchre/server test:integration`
- [ ] Concurrency tests confirm late/duplicate actions are rejected deterministically
- [ ] Replay tests confirm server state remains source of truth

#### Manual Verification:
- [ ] 4 browser sessions can complete a round with synchronized state
- [ ] Refreshing one client and reconnecting restores same seat and hand inside recovery window

---

## Phase 4: Responsive Web Client Gameplay Experience

### Overview
Deliver player-facing UI for lobby, seating, bidding, trick play, score/state indicators, and reconnect UX on mobile and desktop.

### Changes Required:

#### 1. Lobby and Join Experience
**File**: `apps/web/src/pages/LobbyPage.tsx`  
**Changes**: Create/join flows, display name entry, seat visualization, and start controls.

**File**: `apps/web/src/lib/session.ts`  
**Changes**: Persist reconnect token and rejoin metadata in browser storage.

#### 2. Gameplay Surface and Turn Feedback
**File**: `apps/web/src/pages/GamePage.tsx`  
**Changes**: Render current trick, hand cards, legal action highlights, dealer/turn/trump indicators, and score.

**File**: `apps/web/src/components/CardHand.tsx`  
**Changes**: Support legal/illegal interaction states and selected-card feedback.

**File**: `apps/web/src/components/Scoreboard.tsx`  
**Changes**: Show team score progression and round/trick context.

#### 3. Real-Time State Sync and Error Handling
**File**: `apps/web/src/realtime/client.ts`  
**Changes**: Handle socket lifecycle, reconnection, stale-event guards, and action ack errors.

**File**: `apps/web/src/state/gameStore.ts`  
**Changes**: Keep client state as projection of server messages; avoid local rule authority.

### Success Criteria:

#### Automated Verification:
- [ ] Web unit tests pass for critical components and state reducers
- [ ] Contract tests pass between server events and client handlers
- [ ] Accessibility lint checks pass for interactive game controls

#### Manual Verification:
- [ ] Mobile and desktop layouts remain usable throughout full-game flow
- [ ] Illegal actions are clearly blocked with understandable feedback
- [ ] Reconnect UX restores player context without manual re-entry

---

## Phase 5: Reliability, Security, and Observability

### Overview
Harden the MVP with logging, validation, abuse safeguards, and measurable operational signals aligned with non-functional requirements.

### Changes Required:

#### 1. Input Validation and Token Hardening
**File**: `apps/server/src/security/token.ts`  
**Changes**: Sign and validate join/reconnect tokens with expiry and audience claims.

**File**: `apps/server/src/security/validation.ts`  
**Changes**: Enforce schema validation for all inbound HTTP/socket payloads.

#### 2. Logging and Diagnostics
**File**: `apps/server/src/observability/logger.ts`  
**Changes**: Add structured logs for lobby, game transitions, disconnect/reconnect, and rejected actions.

**File**: `apps/server/src/observability/metrics.ts`  
**Changes**: Add metrics for action latency, reconnect success rate, and game completion ratio.

#### 3. Failure and Recovery Testing
**File**: `apps/server/test/recovery.test.ts`  
**Changes**: Simulate disconnect/reconnect timing windows and failure paths.

**File**: `apps/web/test/reconnect-ui.test.tsx`  
**Changes**: Validate reconnect indicators and recovery messaging.

### Success Criteria:

#### Automated Verification:
- [ ] Security validation tests pass for malformed/forged tokens and payloads
- [ ] Recovery tests pass across reconnect window boundaries
- [ ] Metrics/logging smoke tests pass in staging

#### Manual Verification:
- [ ] Operators can trace a game lifecycle through logs
- [ ] Reconnect policy behavior is consistent with product decision for abandoned games

---

## Phase 6: End-to-End Validation and Release Readiness

### Overview
Finalize the MVP through acceptance testing, deployment rehearsal, and go-live safeguards.

### Changes Required:

#### 1. End-to-End Acceptance Coverage
**File**: `apps/e2e/tests/mvp-acceptance.spec.ts`  
**Changes**: Automate key acceptance criteria from requirements Section 12.

#### 2. Deployment and Runtime Configuration
**File**: `infra/docker/Dockerfile.server`  
**Changes**: Containerize server runtime.

**File**: `infra/deploy/staging.md`  
**Changes**: Document environment variables, rollout, and rollback steps.

#### 3. Launch Checklist and Runbook
**File**: `docs/release/mvp-go-live-checklist.md`  
**Changes**: Create launch gating checklist tied to performance/reliability metrics.

**File**: `docs/operations/runbook.md`  
**Changes**: Add incident triage steps for desync, reconnect failures, and elevated action latency.

### Success Criteria:

#### Automated Verification:
- [ ] E2E acceptance suite passes in CI and staging
- [ ] Load smoke test shows acceptable latency at 4 concurrent players/game across multiple games
- [ ] Build artifacts are reproducible and deployable

#### Manual Verification:
- [ ] Controlled playtest completes multiple full games on mobile + desktop
- [ ] Go-live checklist is fully signed off

---

## Testing Strategy

### Unit Tests:
- `packages/game-rules`: card ordering, effective suit logic, trick winner logic, bidding/scoring branches
- `apps/server`: command handlers, turn guards, token validators, reconnect policy transitions
- `apps/web`: reducers/store projection logic, card interaction rules, score and status rendering

### Integration Tests:
- Lobby lifecycle (create -> join -> seat -> start)
- Game action lifecycle (submit intent -> validate -> state transition -> broadcast)
- Disconnect/reconnect lifecycle (drop -> reconnect within window -> resume seat)
- Duplicate/late action handling and idempotency behavior

### Manual Testing Steps:
1. Host creates lobby and shares URL with three players.
2. All four players join, set names, and confirm seat/team display.
3. Host starts game; verify dealer/turn/trump indicators update correctly.
4. Play through bidding with pass/order/call scenarios.
5. Attempt illegal move; verify rejection and preserved state.
6. Complete a full round and confirm scoring behavior.
7. Refresh one client during active hand; verify reconnect into same seat/hand.
8. Continue to target score and verify winner presentation.
9. Repeat on mobile browser for layout and input usability.

## Performance Considerations
- Keep payloads lean by emitting incremental state updates where possible; fall back to snapshots on resync.
- Serialize actions per game room to avoid race-driven state corruption.
- Use monotonic sequence numbers on server events so clients can detect stale/out-of-order messages.
- Track end-to-end action latency from player submit to remote render acknowledgment.

## Migration Notes
- No data migration required for initial MVP because the codebase is greenfield.
- If persistence backend changes post-MVP (in-memory to Redis/DB), provide a storage adapter interface now to avoid refactors in game/session domains.

## Resolved Decisions for Phase 3
- Rule variant: follow `docs/rules_of_euchre.md` MVP defaults.
- Seat assignment policy: automatic.
- Reconnect timeout policy: forfeit.
- Authentication posture: anonymous sessions only (no long-term accounts).
- Hosting constraint: optimize for ease of deployment for a small audience (about 8 players total).
