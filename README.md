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

## Useful Commands

- `pnpm dev` - run frontend and API packages in parallel
- `pnpm dev:api` - run only the API package
- `pnpm dev:web` - run only the frontend package
- `pnpm build` - typecheck and build all packages
- `pnpm typecheck` - run TypeScript checks across the workspace
- `pnpm --filter @workspace/api-spec run codegen` - regenerate API client and Zod types
- `pnpm --filter @workspace/db run push` - push schema changes to the database

## Notes

- The current API includes live endpoints for health, pools, prices, positions, and analytics.
- The frontend still needs the real dashboard UI in phase 2.
