# @fun-euchre/server Runtime Contract

This document defines the server-facing integration contract for Phase 4 client work.

It covers:
- HTTP endpoints and payload shapes
- outbound protocol events
- realtime room/channel model
- request/response error semantics
- local run commands
- end-to-end sample flows

## Current Runtime Notes

- `GET /health` and `HEAD /health` are fully wired in `createAppServer()`.
- Lobby and action routes are wired, validate protocol payloads, and normalize responses.
- Command execution for non-health routes depends on injected dispatchers/orchestration.
- The default server bootstrap currently uses fallback dispatchers, so non-health routes can return:
  - `INVALID_STATE` / `"Lobby command dispatcher is not configured."`
  - `INVALID_STATE` / `"Game command dispatcher is not configured."`

The contracts below are the intended stable client contract once orchestration is injected.

## Local Run

From repo root:

```bash
pnpm install
pnpm --filter @fun-euchre/server dev
```

From `apps/server`:

```bash
pnpm dev
```

Health check:

```bash
curl -i http://127.0.0.1:3000/health
```

## Protocol Version

- Current protocol version: `1`
- Source of truth:
  - `packages/protocol/src/index.ts`

Client-to-server events must satisfy protocol validation in `@fun-euchre/protocol`.

## HTTP API

Base URL (local): `http://127.0.0.1:3000`

### 1) Health

- `GET /health`
- `HEAD /health`

`GET` response:

```json
{
  "status": "ok",
  "service": "fun-euchre-server",
  "uptimeSeconds": 123
}
```

### 2) Lobby Create

- `POST /lobbies/create`

Request body:

```json
{
  "requestId": "req-create-1",
  "displayName": "Host"
}
```

### 3) Lobby Join

- `POST /lobbies/join`

Request body:

```json
{
  "requestId": "req-join-1",
  "lobbyId": "lobby-1",
  "displayName": "Player",
  "reconnectToken": "token-optional"
}
```

`reconnectToken` is optional and may be omitted or `null`.

### 4) Lobby Update Name

- `POST /lobbies/update-name`

Request body:

```json
{
  "requestId": "req-rename-1",
  "lobbyId": "lobby-1",
  "playerId": "player-2",
  "displayName": "Renamed"
}
```

### 5) Lobby Start

- `POST /lobbies/start`

Request body:

```json
{
  "requestId": "req-start-1",
  "lobbyId": "lobby-1",
  "actorPlayerId": "player-1"
}
```

### 6) Submit Game Action

- `POST /actions`

Request body is a full protocol `ClientToServerEvent` envelope:

```json
{
  "version": 1,
  "type": "game.play_card",
  "requestId": "req-play-1",
  "payload": {
    "gameId": "game-1",
    "actorSeat": "north",
    "cardId": "clubs:9"
  }
}
```

## Response Contract

### Success Envelope

All successful command endpoints return:

```json
{
  "requestId": "req-123",
  "outbound": [
    {
      "version": 1,
      "type": "system.notice",
      "payload": {
        "severity": "info",
        "message": "..."
      }
    }
  ]
}
```

`outbound` contains one or more `ServerToClientEvent` payloads that should be handled by the client exactly as realtime-delivered events.

### Error Envelope

All normalized command errors return:

```json
{
  "requestId": "req-123",
  "error": {
    "code": "INVALID_ACTION",
    "message": "Human-readable error message.",
    "issues": [
      "Optional protocol validation details."
    ]
  }
}
```

Status code mapping:
- `400` => `INVALID_ACTION`
- `403` => `UNAUTHORIZED`
- `409` => `INVALID_STATE`, `NOT_YOUR_TURN`

`requestId` resolution order:
1. request body `requestId` when present and non-empty
2. `x-request-id` request header when present
3. generated UUID on server

## Supported Event Types

### Client -> Server

- `lobby.create`
- `lobby.join`
- `lobby.update_name`
- `lobby.start`
- `game.play_card`

### Server -> Client

- `lobby.state`
- `game.state`
- `action.rejected`
- `system.notice`

## Event Payload Reference

### `lobby.state`

```json
{
  "version": 1,
  "type": "lobby.state",
  "payload": {
    "lobbyId": "lobby-1",
    "hostPlayerId": "player-1",
    "phase": "waiting",
    "seats": [
      {
        "seat": "north",
        "team": "teamA",
        "playerId": "player-1",
        "displayName": "Host",
        "connected": true
      }
    ]
  }
}
```

### `game.state`

```json
{
  "version": 1,
  "type": "game.state",
  "payload": {
    "gameId": "game-1",
    "handNumber": 1,
    "trickNumber": 0,
    "dealer": "north",
    "turn": "east",
    "trump": "hearts",
    "scores": {
      "teamA": 0,
      "teamB": 0
    }
  }
}
```

### `action.rejected`

```json
{
  "version": 1,
  "type": "action.rejected",
  "payload": {
    "requestId": "req-play-9",
    "code": "NOT_YOUR_TURN",
    "message": "Action actor does not match current trick turn."
  }
}
```

### `system.notice`

```json
{
  "version": 1,
  "type": "system.notice",
  "payload": {
    "severity": "warning",
    "message": "Player \"player-2\" failed to reconnect before timeout. teamA wins by forfeit."
  }
}
```

## Realtime Channel Contract

Current server runtime includes an in-memory room hub and socket abstraction:

- room key format:
  - `lobby:{lobbyId}`
  - `game:{gameId}`
- broadcast source is restricted to authoritative domain transitions
- connected session receives ordered event batches for each room broadcast

Code references:
- `apps/server/src/realtime/eventHub.ts`
- `apps/server/src/realtime/socketServer.ts`

Important:
- This is a transport abstraction, not yet a public WebSocket endpoint.
- Phase 4 client transport should map these room IDs and event envelopes onto the chosen wire transport.

## End-to-End Client Flows

### Flow A: Create Lobby

1. Client `POST /lobbies/create` with display name.
2. Server validates payload.
3. On success, client receives `outbound` events including `lobby.state`.
4. Client renders seats/host/phase from `lobby.state.payload`.

### Flow B: Join Lobby (x3 additional players)

1. Each player calls `POST /lobbies/join`.
2. Server validates `lobbyId`, `displayName`, and optional `reconnectToken`.
3. Each success returns `outbound` events including updated `lobby.state`.
4. Client re-renders full lobby snapshot from latest `lobby.state`.

### Flow C: Start Lobby

1. Host calls `POST /lobbies/start`.
2. If host/auth/state checks pass, response contains updated `lobby.state` with `phase: "in_game"`.
3. If checks fail, client receives normalized error with `UNAUTHORIZED` or `INVALID_STATE`.

### Flow D: Play Card

1. Active player calls `POST /actions` with `game.play_card` event envelope.
2. Server validates protocol payload and maps to domain action.
3. On success, response `outbound` includes `game.state`.
4. On invalid turn/rule violation, response is normalized error and/or `action.rejected` projection.

### Flow E: Reconnect / Forfeit

1. Client disconnects; server/session policy tracks reconnect grace window.
2. Reconnecting client can rejoin with `reconnectToken` (when orchestration exposes token issuance).
3. If reconnect occurs within window, same player seat/session mapping is restored and state continues.
4. If reconnect window expires, authoritative policy resolves forfeit:
   - emits `system.notice`
   - emits terminal `game.state` with completed outcome

## Observability Fields

Structured logs include stable correlation fields for integration/debugging:
- `lobbyId`
- `gameId`
- `playerId`
- `requestId`

Primary events:
- `server.lifecycle`
- `lobby.action`
- `game.transition`
- `action.rejected`
- `session.disconnected`
- `session.reconnected`
- `game.forfeit`
