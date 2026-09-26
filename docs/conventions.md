# Conventions

## Code

- TypeScript strict everywhere. pnpm workspaces. Node version in `.nvmrc`.
- Core code in `src/core/`, module code in `src/modules/<name>/` in each package.
- IDs: ULID strings. Never auto-increment.
- Money: integer paise (`*_paise`). Format with the shared helper only (`formatINR`). No floats for money.
- Time: store UTC ISO strings; display in `Asia/Kolkata` via shared helpers. Date-only fields (`paid_on`, `spent_on`) are `YYYY-MM-DD` in local (Kolkata) date.
- Validation: Zod schemas in `packages/shared`, imported by Worker and web app.
- Services are plain functions `(ctx, input) => result`. No HTTP or MCP types inside services.
- Routes/MCP tools are generated from operations; hand-written routes only for auth, static files and feeds.
- Errors: throw typed `AppError(code, message, details?)`; the adapter maps to HTTP status / MCP error.

## Naming

- Tables and columns: `snake_case`, plural table names.
- Operation ids: `<module>.<verb>_<noun>` (e.g. `gigs.record_payment`). MCP tool names: `<verb>_<noun>`, unique.
- Scopes: `<module>:read`, `<module>:write`, or finer (`gigs:record_payment`).

## Database

- Drizzle schema per module; one migration sequence in `apps/worker/migrations/`.
- Never edit an applied migration.
- Every query goes through the scoped context; every filtered column is indexed.

## Tests

- Vitest with the Workers pool, local D1.
- Every module: service tests + a test that one workspace can't read or write another's data.
- Money logic (balances, reversals, status) gets table-driven tests.

## Git

- Conventional commits with scope: `feat(gigs):`, `fix(core):`, `docs:`, `chore:`.
- Small commits, one task at a time. Update `tasks/STATUS.md` before ending a session.
