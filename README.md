# funEuchre

Monorepo for the multiplayer web Euchre MVP.

## Packages

- `apps/server` - authoritative runtime, HTTP API, websocket transport
- `apps/web` - browser client (lobby/game/help UI)
- `packages/protocol` - shared event schemas and validators
- `packages/game-rules` - deterministic Euchre rules engine

## Prerequisites

- Node.js `22.x` (recommended)
- `pnpm` `10.x`

```bash
node --version
pnpm --version
```

## Install

```bash
pnpm install
```

## Primary Commands

```bash
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## App-Specific Commands

```bash
pnpm --filter @fun-euchre/server dev
pnpm --filter @fun-euchre/server test
```

```bash
pnpm --filter @fun-euchre/web dev
pnpm --filter @fun-euchre/web test
```

## Cloud Run Deployment (GitHub Source)

This repo is prepared for Cloud Run builds that pull directly from GitHub (no local `gcloud` usage required).

### Cloud Run Build Scripts

```bash
pnpm run cloudrun:build:server
pnpm run cloudrun:build:web
```

### Deploy `fun-euchre-api`

1. In Cloud Run, create a service from your GitHub repo/branch.
2. Use build type `Dockerfile`.
3. Keep source context at repository root (`/`).
4. Set Dockerfile path to `apps/server/Dockerfile`.
5. Set runtime env var `FUN_EUCHRE_RECONNECT_TOKEN_SECRET` to a long random value.
6. Set max instances to `1` (runtime state is in-memory per instance).

### Deploy `fun-euchre-web`

1. Create a second Cloud Run service from the same GitHub repo/branch.
2. Use build type `Dockerfile`.
3. Keep source context at repository root (`/`).
4. Set Dockerfile path to `apps/web/Dockerfile`.
5. Set env vars:
   - `API_ORIGIN=https://<fun-euchre-api-url>`
   - `PUBLIC_ORIGIN=https://<fun-euchre-web-url>`

After both services are live, open the `fun-euchre-web` URL to access the app.

## Runtime Docs

- Server runtime + transport contract: `apps/server/README.md`
- Web runtime + client-state architecture: `apps/web/README.md`
- Realtime broker contract and ordering semantics: `docs/architecture/realtime-distribution.md`
- Operations runbook (incidents + triage): `docs/operations/runbook.md`

## Local Multi-Client Smoke Flow

1. Start server and web dev processes.
2. In browser A, create a lobby.
3. In browsers B/C/D (incognito or separate profiles), join with invite link.
4. Start game from host and submit at least one bid and one gameplay action.
5. Disconnect one client and reconnect with stored reconnect token.
6. Confirm all clients converge on the same lobby/game projections.

## Phase 5 Hardening Validation

Targeted commands:

```bash
pnpm --filter @fun-euchre/protocol test
pnpm --filter @fun-euchre/server test
pnpm --filter @fun-euchre/web test
pnpm --filter @fun-euchre/server typecheck
pnpm --filter @fun-euchre/web typecheck
```

Repository-wide gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Server quick checks after startup:

```bash
curl -sSf http://127.0.0.1:3000/health
curl -sSf http://127.0.0.1:3000/metrics
```

## Troubleshooting Links

- Reconnect and websocket troubleshooting: `apps/server/README.md`
- Client bootstrap/session troubleshooting: `apps/web/README.md`
- Incident runbook: `docs/operations/runbook.md`
