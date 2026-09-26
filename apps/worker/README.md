# apps/worker

The single Cloudflare Worker: Hono API (`/api/*`), Better Auth (`/auth/*`), MCP server (`/mcp`), and static web app.

```
src/core/            auth, workspaces, authz middleware, operation registry, idempotency,
                     confirm tokens, audit log, API tokens, notifications
src/modules/index.ts the list of registered modules
src/modules/gigs/    schema.ts, services/, operations.ts, index.ts
migrations/          Drizzle migrations (one sequence for all modules; never edit applied ones)
```

Set up in T01/T02. See `docs/architecture.md` and `docs/modules.md`.
