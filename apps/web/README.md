# @fun-euchre/web

Browser client for the funEuchre MVP.

This README documents runtime architecture, reconnect behavior, event-ordering guardrails, and validation workflows after Phase 5 hardening.

## Local Run

From repo root:

```bash
pnpm install
pnpm --filter @fun-euchre/web dev
```

Default dev URL: `http://127.0.0.1:5173`

Server dependency: run `@fun-euchre/server` at `http://127.0.0.1:3000` unless `API_ORIGIN` is set.

### Cross-Device Dev Notes

For LAN invite testing:

```bash
PUBLIC_ORIGIN=http://<lan-ip>:5173 API_ORIGIN=http://127.0.0.1:3000 pnpm --filter @fun-euchre/web dev
```

- `PUBLIC_ORIGIN` controls invite-link host.
- `API_ORIGIN` controls proxy target for `/lobbies/*`, `/actions`, and `/realtime/ws`.

## Runtime Architecture

### App Bootstrap

Entry point: `apps/web/src/main.tsx`

Startup flow:

1. create store, HTTP client, and session client,
2. run `bootstrapAppSession(...)` to attempt reconnect,
3. route to `lobby`, `game`, or `help` page,
4. bind UI feedback to bootstrap/realtime state.

### Router + Pages

- router: `apps/web/src/app/router.ts`
- lobby page: `apps/web/src/pages/LobbyPage.tsx`
- game page: `apps/web/src/pages/GamePage.tsx`
- help page: `apps/web/src/pages/HelpPage.tsx`

### Transport Clients

- HTTP: `apps/web/src/lib/httpClient.ts`
- realtime websocket: `apps/web/src/realtime/client.ts`
- session persistence: `apps/web/src/lib/session.ts`

Realtime lifecycle states:

- `idle`
- `connecting`
- `connected`
- `subscribed`
- `disconnected`
- `error`

## State Reducer and Ordering Guardrails

Reducer implementation: `apps/web/src/state/reducer.ts`

Both HTTP `outbound` events and websocket events pass through one reducer path.

Guardrails:

- deterministic duplicate suppression via bounded `seenEventKeys`,
- stale rejection using server ordering metadata (`ordering.sequence`) when present,
- fallback stale checks by phase/hand/trick progression when ordering metadata is absent,
- bounded notices/rejections history to avoid unbounded client growth.

Ordering metadata source is server broker fanout (`ordering.sequence`, `ordering.emittedAtMs`) and is validated by contract suites.

## Session and Reconnect Behavior

Persisted session fields:

- `lobbyId`, `playerId`, `sessionId`, `reconnectToken`, `displayName`,
- `savedAtMs` (staleness guard).

Default client-side stale-session window: `6 hours`.

Reconnect semantics:

- reconnect attempts use stored `sessionId` + `reconnectToken`.
- server accepts reconnect only within configured reconnect grace window.
- if reconnect grace expires, server lifecycle sweeper may force forfeit and complete the game.

## Multi-Client Smoke Workflow

1. Start server and web app.
2. In browser A, create lobby.
3. In browser B/C/D (separate profiles/incognito), join via invite link.
4. Start game from host.
5. Submit bidding and gameplay actions in turn order.
6. Trigger one illegal action and confirm inline rejection feedback.
7. Close browser B and verify disconnected seat state.
8. Reopen browser B and verify reconnect and state convergence.

## Troubleshooting

- App does not auto-rejoin:
  - saved session is stale and was cleared on hydrate.
- Reconnect rejected as invalid/expired:
  - reconnect grace window elapsed or token no longer valid.
- Lobby/game projection appears stale:
  - inspect network stream for out-of-order replay and confirm latest sequence is applied.
- Websocket repeatedly fails to connect:
  - verify latest `sessionId` + `reconnectToken` pair from create/join response.

Operational incident workflows live in `docs/operations/runbook.md`.

## Validation Commands

From repo root:

```bash
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/web typecheck
pnpm --filter @fun-euchre/web lint
```

High-signal suites:

- `apps/web/test/contract-events.test.ts`
- `apps/web/test/state-reducer.test.ts`
- `apps/web/test/reconnect-ui.test.ts`
- `apps/web/test/lobby-page.test.ts`
- `apps/web/test/game-page.test.ts`
- `apps/web/test/accessibility-smoke.test.ts`
