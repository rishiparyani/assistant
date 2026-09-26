# T00 spike: Better Auth + D1 + MCP OAuth on Workers

**Throwaway.** Proves the risky parts before real code (T01+). Don't build on it; copy what's learned.

What it proves:

- Better Auth runs on Workers with D1 passed directly as `database` (no Kysely/Drizzle needed for auth).
- Google sign-in (`/auth/sign-in/social`, callback `/auth/callback/google`).
- Workspaces via the organization plugin, with a `kind` additional field; invite + accept a second member.
- The app as an OAuth server for MCP clients via `@better-auth/oauth-provider`: dynamic client registration, login page, consent page, PKCE, `resource` → JWT access token with the MCP URL as audience.
- A minimal stateless MCP endpoint (`POST /mcp`, JSON responses) with one `whoami` tool, rejecting bad tokens with a `WWW-Authenticate` header pointing at the protected-resource metadata.

## Layout

```
src/auth.ts      Better Auth options (shared by Worker, migration script and tests)
src/index.ts     Hono app: /auth/*, .well-known/*, /mcp, pages
src/mcp.ts       minimal MCP JSON-RPC handler
src/pages.ts     home (test UI), /login, /consent
scripts/gen-migration.ts  generates migrations/0001_better_auth.sql from auth options
test/flow.test.ts         in-process test of workspaces + full OAuth flow (node:sqlite)
```

## Commands

```
pnpm test                 # vitest: workspaces, second member, OAuth flow, MCP protocol
pnpm typecheck
pnpm gen:migration        # after changing auth options/plugins
cp .dev.vars.example .dev.vars   # then fill in; never commit
pnpm db:migrate:local && pnpm dev   # http://localhost:8787
```

On `localhost` only, email/password sign-up is enabled so the flow can be tested without Google (`curl -X POST /auth/sign-up/email`).

## Deploy

`.github/workflows/spike-t00.yml` runs on pushes touching `spikes/t00/**`: install, typecheck, test, create the D1 database if missing, apply migrations, deploy, set secrets (Google from GitHub secrets; `BETTER_AUTH_SECRET` generated once), smoke test.

URL: https://assistant-spike.rishiparyani.workers.dev

## Manual test (owner)

1. Open the URL, **Sign in with Google**, create a workspace (kind `band`).
2. Optional second member: invite another Google account (it must be a test user in the Google Auth Platform while the app is in Testing mode), sign in with it, accept.
3. Claude → Settings → Connectors → Add custom connector → `https://assistant-spike.rishiparyani.workers.dev/mcp`. Connect, sign in, allow. Ask Claude "use whoami".
4. CPU time: Cloudflare dashboard → Workers & Pages → assistant-spike → Metrics (CPU time per request) or Observability logs.

## Findings

See `docs/decisions.md` (T00 entry) and `tasks/STATUS.md`.
