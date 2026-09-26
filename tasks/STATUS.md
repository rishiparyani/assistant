# Status

_Updated: 2026-09-26_

## Last done

- Repo setup from the project brief (no application code): `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/`, `tasks/`, folder structure, root configs.
- Architecture made flexible: a small core plus feature modules, with Gigs as module one (see `docs/modules.md` and the decision in `docs/decisions.md`).
- Decisions recorded: per-member shares and payouts in Phase 1 (T02/T05 updated); no further modules planned yet.
- Added `docs/setup.md` (deploys via GitHub Actions, where secrets live, owner's manual steps, free-tier limits) and public-repo safety rules in `AGENTS.md` and `docs/security.md`.
- **T02 live on prod** via [rishiparyani/assistant#1](https://github.com/rishiparyani/assistant/pull/1) + smoke-test fix [rishiparyani/assistant#2](https://github.com/rishiparyani/assistant/pull/2) (prod D1 `assistant` created; `/api/health` → `migrations: 1`). Verified on dev 2026-09-26 ( D1 `assistant-dev` created by the workflow, `/api/health` → `migrations: 1`): Drizzle schema for core, Better Auth and gigs tables (`0000_init.sql`), CHECK constraints, indexes, D1 in wrangler (dev + prod) and the deploy workflow, `ulid`/money helpers. Tests: 34 shared, 23 worker (schema, constraints, index usage via EXPLAIN, Better Auth schema guard).
- **T01 done**: pnpm workspace with catalog, `packages/shared`, `apps/worker` (Hono, core with module registry, `/api/health`), `apps/web` (Svelte 5 SPA via the Cloudflare Vite plugin), ESLint + Prettier, CI (`ci.yml`) and deploy (`deploy.yml`) workflows. Root `pnpm typecheck`, `lint`, `test`, `build` all pass locally; the web app was checked in a headless browser.
- **T00 done** (2026-09-26): all ACs met; results in `docs/decisions.md`. Spike in `spikes/t00/` (see its README) with deploy workflow `.github/workflows/spike-t00.yml`. Verified here: typecheck, 3 vitest tests (workspace with `kind`, invite + accept second member, stranger denied, full MCP OAuth flow with JWT verification), and the same flow against `wrangler dev` with local D1.
- Original brief archived in `docs/archive/gig-assistant-brief.md`.

## Next

1. **T03** auth + workspaces + authorization middleware. Auth options already live in `apps/worker/src/core/auth/options.ts`.

## Open decisions

None. Resolved 2026-09-26:

- Login: Google sign-in now; passkeys and magic links added in T03.
- Member shares: tracked per member (roster, lineup with shares, payouts). See `docs/data-model.md`.
- Other modules: none planned; add as needs come up.

## Owner setup

Steps the owner does by hand (instructions in `docs/setup.md`). Update this list when the owner reports progress.

- [x] Cloudflare account created (workers.dev subdomain: `rishiparyani.workers.dev`)
- [x] GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` added (owner reported 2026-09-26; first deploy will verify)
- [x] Google OAuth client created; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` added as GitHub secrets (owner reported 2026-09-26)
- [ ] GitHub secret scanning, push protection, Dependabot alerts enabled; fork PR workflows require approval
- [x] `main` created (2026-09-26)
- [x] `main` set as default branch; ruleset `main` active (pull request required, no deletion, no force-push); verified via API 2026-09-26
- [x] GitHub Environment `production` limited to `main` (owner reported; not readable via the API from agent sessions)
- [x] Claude custom connector added (`Assistant`, pointing at the spike)

## In progress

Nothing. The spike stays deployed at https://assistant-spike.rishiparyani.workers.dev (Claude connector `Assistant` points at it) until T10 replaces it.

## Gotchas

- `CLAUDE.md` is a symlink; on Windows without symlink support replace it with a file containing `@AGENTS.md`.
- **The repo is public.** No secrets or real personal data anywhere; see `docs/security.md#public-repository`.
- `main` created 2026-09-26 at the T01 commit; prod deployed via manual `workflow_dispatch` (https://assistant.rishiparyani.workers.dev).
- Right after `wrangler deploy`, the edge can serve the previous version for a few seconds; smoke tests must retry against the new version's expected response.
- Pushing a new branch whose commit already exists on the default branch doesn't trigger path-filtered workflows (no changed files). Run the workflow manually (Actions → Deploy → Run workflow).
- Better Auth docs site (better-auth.com) is blocked from agent sessions; read the types in `node_modules/@better-auth/*/dist/*.d.mts` instead.
- `@better-auth/oauth-provider`: `/auth/oauth2/consent` returns `{ url }` (not `redirect_uri`). Access tokens are JWTs only when the client sends `resource`; the spike falls back to `/oauth2/userinfo` for opaque tokens.
- Better Auth tables keep camelCase columns; IDs are ULIDs. If a Better Auth upgrade adds columns, `test/auth-schema.test.ts` fails: update `auth-schema.ts`, run `pnpm db:generate`.
- The Vite dev server and `wrangler` share local D1 state in `apps/worker/.wrangler/state` (`persistState` in `apps/web/vite.config.ts`).
- Agent sessions can reach `*.rishiparyani.workers.dev` (custom network allowlist, 2026-09-26): verify live apps with curl or headless Chromium.
- **Workflow since `main` is protected:** work on a branch (deploys to dev); when a task is done and verified, open a PR to `main` and merge it after CI passes (owner OK'd, 2026-09-26), then tell the owner what went live.
- Agent sessions can't reach `api.cloudflare.com` (network policy), and shouldn't: deploys go through GitHub Actions only.
