# Meridian Bot

Monorepo for a liquidity-pool dashboard and API built with pnpm workspaces.

## Stack

- Frontend: Vite + React
- API: Express 5
- Database: PostgreSQL + Drizzle ORM
- Validation/codegen: OpenAPI + Orval + Zod

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Copy environment values:

```bash
cp .env.example .env
```

3. Start the workspace:

```bash
pnpm dev
```

The frontend uses a Vite `/api` proxy to reach the local API server by default.
Set `API_ORIGIN` if you need to point the frontend dev server at a different
backend. Set `VITE_API_BASE_URL` only when you want the browser bundle to call
an explicit remote API endpoint.

## Useful Commands

- `pnpm dev` - run frontend and API packages in parallel
- `pnpm dev:api` - run only the API package
- `pnpm dev:web` - run only the frontend package
- `pnpm bot:dev` - run the trading bot in paper mode from source
- `pnpm bot:paper` - run the compiled bot in paper mode
- `pnpm bot:paper:trade` - run a bounded paper-trading session using `BOT_PAPER_MAX_CYCLES` or `--cycles`
- `pnpm bot:paper:trade` also honors `BOT_PAPER_DEBUG_FORCE_SIGNAL` and `BOT_PAPER_DEBUG_BYPASS_RISK` for test runs
- `pnpm bot:live` - run the compiled bot in live mode
- `pnpm bot:backtest` - run the built-in backtest against live snapshot samples or a file from `BOT_BACKTEST_SNAPSHOTS_FILE`
- `pnpm start` - start the API server in production mode and serve the built frontend
- `pnpm build` - typecheck and build all packages
- `pnpm test` - run the backend test suite
- `pnpm smoke` - run the production smoke check after building
- `pnpm typecheck` - run TypeScript checks across the workspace
- `pnpm --filter @workspace/api-spec run codegen` - regenerate API client and Zod types
- `pnpm --filter @workspace/db run push` - push schema changes to the database

## Notes

- The current API includes live endpoints for health, pools, prices, positions, and analytics.
- The frontend now has the phase 2 dashboard shell, live queries, and wallet
  controls. Phase 3 is test coverage, deployment wiring, and removing the last
  synthetic data paths.
- The API server now serves `artifacts/meridian/dist/public` when that build is
  present, so `pnpm start` works as a deploy entrypoint after `pnpm build`.
- `pnpm smoke` verifies the production API and static frontend path after a build.
- The bot package currently runs in paper, dry-run, or live mode. `paper-trade`
  is the bounded test-trading entrypoint. Live mode
  requires `BOT_RPC_URL` and either `BOT_SIGNER_SECRET_KEY` or
  `BOT_SIGNER_SECRET_KEY_FILE`. A remote secret endpoint can also be used via
  `BOT_SIGNER_SECRET_REMOTE_URL` and `BOT_SIGNER_SECRET_REMOTE_TOKEN` when the
  signer is backed by Vault or another secret service. Optional
  `BOT_ALERT_WEBHOOK_URL` enables external alerts for failures and
  circuit-breaker events. The bot also supports pool and token allow/deny lists,
  a pool-age gate, optional pool-metadata verification, a price-dislocation
  guardrail, `BOT_PAPER_MAX_CYCLES` for bounded paper sessions, and a local
  `BOT_PAPER_DEBUG_FORCE_SIGNAL` / `BOT_PAPER_DEBUG_BYPASS_RISK` pair for
  guaranteed test-trading sessions,
  JSONL storage fallback via `BOT_STORAGE_DIR` when no database URL is
  configured.
- Live execution supports Jupiter swaps plus Meteora DLMM add/remove liquidity
  flows, and it persists tracked LP positions in `bot_positions` when a database
  is available.
- The API now exposes `/api/bot/status` from the shared bot storage directory,
  so the dashboard can show the latest run, status, and recent alerts.
- The dashboard also includes a Paper Trading control that calls
  `/api/bot/paper-trade` for bounded test sessions and exposes the latest
  runtime counters plus the active data source.
- `BOT_BACKTEST_SNAPSHOTS_FILE` can point the backtester at a JSON or JSONL
  snapshot file for deterministic replay.
- Deployment manifests and runbook notes live under `deploy/`.
