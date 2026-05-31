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
