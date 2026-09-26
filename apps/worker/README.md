# apps/worker

The single Cloudflare Worker: Hono API (`/api/*`), Better Auth (`/auth/*`, T03), MCP server (`/mcp`, T10). The web app is served as static assets by the same Worker (built through `apps/web`).

```
src/index.ts         entry: createApp({ modules })
src/core/            app, module contract; later auth, authz, operation registry, idempotency, audit
src/modules/index.ts the one list of registered modules (core never imports it)
test/                vitest inside workerd (@cloudflare/vitest-pool-workers)
wrangler.jsonc       top level = dev (assistant-dev), env.production = prod (assistant)
```

`pnpm test`, `pnpm typecheck`, `pnpm types` (regenerate `worker-configuration.d.ts` after editing wrangler.jsonc). Run the app with `pnpm dev` from the repo root.
