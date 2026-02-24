# @fun-euchre/server

Authoritative multiplayer Euchre server runtime.

This README documents the current runtime wiring, HTTP + realtime contracts, local verification flow, and reconnect troubleshooting.

## Runtime Wiring

`createAppServer()` now wires a default runtime orchestrator by default:

- `apps/server/src/runtime/orchestrator.ts`
- `apps/server/src/runtime/dispatchers.ts`
- `apps/server/src/realtime/socketServer.ts`
- `apps/server/src/realtime/wsServer.ts`

Default orchestration composes:

- in-memory lobby/game/session stores,
- reconnect policy,
- authoritative game manager,
- lobby/game command dispatchers,
- websocket transport bridge.

This means lobby and action endpoints are live without custom dispatcher injection.

## Local Run

From repo root:

```bash
pnpm install
pnpm --filter @fun-euchre/server dev
```

Or from `apps/server`:

```bash
pnpm dev
```

Default bind:

- host: `0.0.0.0`
- port: `3000` (override with `PORT`)

Health check:

```bash
curl -i http://127.0.0.1:3000/health
```

## HTTP Contract

Base URL: `http://127.0.0.1:3000`

### Endpoints

- `GET /health`
- `HEAD /health`
- `POST /lobbies/create`
- `POST /lobbies/join`
- `POST /lobbies/update-name`
- `POST /lobbies/start`
- `POST /actions`

### Command Request IDs

`requestId` resolution order:

1. request body `requestId` (if non-empty)
2. `x-request-id` header (if present)
3. generated UUID

### Success Envelope

All command endpoints return:

```json
{
  "requestId": "req-123",
  "outbound": [
    {
      "version": 1,
      "type": "lobby.state",
      "payload": {}
    }
  ]
}
```

`/lobbies/create` and `/lobbies/join` also return `identity`:

```json
{
  "requestId": "req-123",
  "identity": {
    "lobbyId": "lobby-1",
    "playerId": "player-1",
    "sessionId": "session-1",
    "reconnectToken": "token-1"
  },
  "outbound": []
}
```

### Error Envelope

```json
{
  "requestId": "req-123",
  "error": {
    "code": "INVALID_ACTION",
    "message": "Human-readable message.",
    "issues": ["Optional validation details"]
  }
}
```

Status mapping:

- `400` => `INVALID_ACTION`
- `403` => `UNAUTHORIZED`
- `409` => `INVALID_STATE` / `NOT_YOUR_TURN`

### Supported Client Events (`POST /actions`)

- `game.pass`
- `game.order_up`
- `game.call_trump`
- `game.play_card`

### Outbound Server Events

- `lobby.state`
- `game.state`
- `action.rejected`
- `system.notice`

## Realtime WebSocket Contract

Endpoint:

- `GET /realtime/ws?sessionId=<id>&reconnectToken=<token>`

Upgrade prerequisites:

- valid session id,
- reconnect token matches session,
- reconnect window has not forfeited.

Server control messages:

- `ws.ready`
- `ws.subscribed`
- `ws.error`

Client message:

```json
{
  "type": "subscribe",
  "requestId": "req-1",
  "payload": {
    "lobbyId": "lobby-1",
    "gameId": "game-1"
  }
}
```

Rules:

- `lobbyId` must match the session's lobby.
- optional `gameId` must match the session's bound game.
- outbound protocol events (`lobby.state`, `game.state`, etc.) are sent as top-level websocket JSON messages.

## Multi-Client Smoke Workflow

1. Start server and web app.
2. In browser A, create a lobby.
3. In browser B/C/D (separate profiles/incognito), join same lobby.
4. Start game from host.
5. Submit at least one bidding action (`pass`) and one gameplay action attempt.
6. Close browser B tab, confirm host sees B disconnected.
7. Reopen browser B and rejoin using reconnect token; confirm seat reconnects.

Useful curl snippets:

```bash
curl -s http://127.0.0.1:3000/health
```

```bash
curl -s -X POST http://127.0.0.1:3000/lobbies/create \
  -H 'content-type: application/json' \
  -d '{"requestId":"smoke-create","displayName":"Host"}'
```

## Reconnect Troubleshooting

- `UNAUTHORIZED` on `/lobbies/join` with reconnect token:
  - token does not exist, does not match session, or belongs to another lobby.
- `INVALID_STATE` on reconnect join:
  - reconnect window expired and seat forfeited.
- websocket `401 Unauthorized` during upgrade:
  - invalid `sessionId` or `reconnectToken` query params.
- websocket `403 Forbidden` during upgrade:
  - reconnect policy already marked session forfeit.
- repeated websocket disconnects:
  - check that each client uses its latest `sessionId` + `reconnectToken` pair.

## Test Commands

From repo root:

```bash
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/server typecheck
```

Contract/integration suites include:

- `apps/server/test/integration/runtime-wiring.test.ts`
- `apps/server/test/integration/gameplay-lifecycle.test.ts`
- `apps/server/test/integration/reconnect-lifecycle.test.ts`
- `apps/server/test/integration/client-contract.test.ts`
- `apps/server/test/realtime-transport.test.ts`
