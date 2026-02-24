# funEuchre

Multiplayer web Euchre MVP (monorepo) with:
- `apps/server` for the authoritative game server
- `apps/web` for the browser client
- `packages/protocol` for shared event contracts
- `packages/game-rules` for deterministic Euchre domain rules

## Server Contract

For Phase 4 client integration details (HTTP endpoints, event envelopes, realtime room model, and sample flows), see:

- `apps/server/README.md`

## Prerequisites

- Node.js `22.x` (recommended to match CI)
- `pnpm` `10.x`

Check your tools:

```bash
node --version
pnpm --version
```

## Initial Setup

From the repository root:

```bash
pnpm install
```

## Core Commands

Run from repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Local Development

Start both apps in parallel:

```bash
pnpm dev
```

Or run each app explicitly in separate terminals:

```bash
pnpm --filter @fun-euchre/server dev
```

```bash
pnpm --filter @fun-euchre/web dev
```

## Quick Verification

Server health endpoint:

```bash
curl -i http://127.0.0.1:3000/health
```

Expected: HTTP `200` and a JSON payload with `"status":"ok"`.

Web shell:
- Open `http://127.0.0.1:5173` in your browser.
- Confirm the shell renders and route tabs (`Lobby`, `Game`, `Help`) are visible.

Rules package docs:
- See `packages/game-rules/README.md` for public API, invariants, and reducer usage examples.
