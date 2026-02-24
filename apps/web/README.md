# @fun-euchre/web

Browser client for the Fun Euchre MVP.

This document covers runtime architecture, local run workflow, multi-client smoke testing, and reconnect troubleshooting.

## Local Run

From repo root:

```bash
pnpm install
pnpm --filter @fun-euchre/web dev
```

Or from `apps/web`:

```bash
pnpm dev
```

Default dev URL: `http://127.0.0.1:5173`

### Cross-Device Dev Notes

When sharing invites across devices, run with:

```bash
PUBLIC_ORIGIN=http://<lan-ip>:5173 API_ORIGIN=http://127.0.0.1:3000 pnpm --filter @fun-euchre/web dev
```

- `PUBLIC_ORIGIN` controls the host embedded into invite links.
- `API_ORIGIN` controls where the web dev server proxies `/lobbies/*`, `/actions`, and `/realtime/ws`.

## Runtime Architecture

### App Bootstrap

Entry point: `apps/web/src/main.tsx`

Startup flow:

1. create store, HTTP client, session client,
2. run `bootstrapAppSession(...)` for auto-reconnect,
3. route to `lobby`, `game`, or `help` page modules,
4. pass bootstrap feedback into page mounts.

### Router + Pages

- Router: `apps/web/src/app/router.ts`
- Lobby page: `apps/web/src/pages/LobbyPage.tsx`
- Game page: `apps/web/src/pages/GamePage.tsx`
- Help page: `apps/web/src/pages/HelpPage.tsx`

### Client State and Reducer

- Store wrapper: `apps/web/src/state/gameStore.ts`
- Reducer: `apps/web/src/state/reducer.ts`

Both HTTP `outbound` events and websocket events flow through the same reducer path.

Reducer behavior:

- deterministic duplicate suppression (`seenEventKeys`),
- stale projection rejection for lobby/game phase regression,
- bounded notice/rejection history.

### Transport Clients

- HTTP client: `apps/web/src/lib/httpClient.ts`
- Realtime client: `apps/web/src/realtime/client.ts`

Realtime lifecycle states:

- `idle`
- `connecting`
- `connected`
- `subscribed`
- `disconnected`
- `error`

### Session + Reconnect Metadata

- Session client: `apps/web/src/lib/session.ts`
- Bootstrap reconnect: `apps/web/src/app/bootstrap.ts`

Persistence includes:

- `lobbyId`, `playerId`, `sessionId`, `reconnectToken`, `displayName`,
- `savedAtMs` timestamp with staleness guard.

Default staleness window is 6 hours.

## UI Surface

Main gameplay/lobby components:

- `SeatGrid`
- `StartControls`
- `BiddingPanel`
- `CardHand`
- `TrickTable`
- `Scoreboard`

Theme and responsive behavior:

- `apps/web/src/styles/theme.css`

Accessibility hardening includes:

- visible `:focus-visible` rings,
- semantic labels/roles on key controls,
- touch-friendly control sizing,
- narrow/mobile breakpoint layout handling.

## Multi-Client Smoke Workflow

Prerequisite: server running (`pnpm --filter @fun-euchre/server dev`).

1. Open app in browser A; create lobby.
2. Open browsers B/C/D (separate profiles/incognito); join lobby via invite link.
3. From host (A), start game.
4. Submit bidding actions in seat turn order.
5. Attempt one illegal action and verify inline rejection message.
6. Close browser B; verify seat shows disconnected.
7. Reopen browser B and reconnect via saved session token; verify seat reconnects.

## Reconnect Troubleshooting

- App loads but does not auto-rejoin:
  - saved session may be stale (expired `savedAtMs`) and gets cleared on hydrate.
- Reconnect message says session invalid/expired:
  - reconnect window elapsed or server no longer accepts token.
- Lobby appears stale after reconnect:
  - check for latest `lobby.state`/`game.state` events in network logs.
- Websocket errors after join:
  - verify `sessionId` and `reconnectToken` are the latest values from create/join response.

## Test Commands

From repo root:

```bash
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/web typecheck
pnpm --filter @fun-euchre/web lint
```

Key suites:

- `apps/web/test/lobby-page.test.ts`
- `apps/web/test/game-page.test.ts`
- `apps/web/test/reconnect-ui.test.ts`
- `apps/web/test/contract-events.test.ts`
- `apps/web/test/accessibility-smoke.test.ts`
