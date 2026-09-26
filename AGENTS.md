# AGENTS.md

Instructions for every coding agent (Claude Code, Codex, others) working in this repo. This file is the source of truth; `CLAUDE.md` is a symlink to it. Detail lives in `docs/`.

## What this is

**Assistant**: a personal/band assistant for a guitarist in Pune, India who plays in several bands. One backend, many clients: web app/PWA, Siri Shortcuts, and AI assistants over MCP (Claude, ChatGPT, others).

It is built as a **small core plus feature modules**. The first module is **Gigs** (gig management, Phase 1). Later modules (music library/setlists, stage mode, and possibly unrelated personal tasks) plug into the same core without changing it. See [docs/modules.md](docs/modules.md).

Priorities: near-zero recurring cost; one source of truth; assistants are clients with no logic of their own; browser/PWA-first; simple enough for one person to maintain; stage features never depend on internet.

## Every session

1. Read this file → [tasks/STATUS.md](tasks/STATUS.md) → the current task in [tasks/backlog.md](tasks/backlog.md).
2. Work one task at a time. Small commits, conventional commit messages (`feat(gigs): …`, `fix(core): …`, `docs: …`).
3. Before finishing: run checks (`pnpm typecheck`, `pnpm lint`, `pnpm test`), update `tasks/STATUS.md` (done, next, half-finished, gotchas), and record any new decision in [docs/decisions.md](docs/decisions.md).
4. Don't add dependencies, add a module, or change the rules below without recording a decision.

Switching agents mid-task: see [docs/handoff.md](docs/handoff.md).

## Stack

Cloudflare Workers (one Worker: `/api/*`, `/auth/*`, `/mcp`, everything else = web app) · Cloudflare D1 · Drizzle ORM + migrations · Hono · Zod · Better Auth (Google, passkeys, magic links; OAuth provider for MCP) · Vite + Svelte SPA · Cloudflare R2 (backups, small files) · Google Drive (large media, later) · TypeScript, pnpm workspaces, Vitest (Workers pool) · GitHub Actions. Details: [docs/architecture.md](docs/architecture.md).

## Architecture rules (non-negotiable)

1. **Shared database, `workspace_id` on every tenant row.** Personal workspace per user + one per band. Memberships with roles (owner, member).
2. **All data access goes through one scoped layer**: services take a context `{db, user, workspace, source}`.
3. **Authorization in one middleware**: user → membership → role (→ module enabled for workspace → token scope). Tested: a user can't read another workspace's data.
4. **ULIDs for all IDs.** Never auto-increment.
5. **Money as integer paise.** API returns `amount_paise` plus a display string ("₹10,000").
6. **Payments are transactions**, never a paid flag. Corrections are reversing entries. Balance and payment status are derived, never stored.
7. **Business logic lives in services.** Routes and MCP tools are thin adapters generated from one **operation** definition per action.
8. **Idempotency key on every write** (`Idempotency-Key` header), response stored 24 h.
9. **Two-step writes for money, cancellations and deletes from MCP**: preview returns a confirm token (~10 min), commit applies it.
10. **No silent fuzzy matching on writes.** Ambiguous names return candidates.
11. **Audit log for every write**: actor, source (web/siri/mcp/system), module, action, entity, before/after.
12. **Indexes on every filtered column.** No full-table scans (D1 bills rows scanned).
13. **Soft delete** (`deleted_at`) for user-facing entities.
14. **Never edit an applied migration**; add a new one.
15. **Modules depend on core, never on each other's internals.** Cross-module access goes through the other module's exported service functions. Core never imports a module.

## Layout

```
AGENTS.md  CLAUDE.md -> AGENTS.md  README.md
docs/            architecture, modules, phase-1, data-model, api, conventions, security, decisions, roadmap, handoff
tasks/           STATUS.md, backlog.md
apps/worker/     Hono API, auth, MCP; src/core/ + src/modules/<name>/; migrations
apps/web/        Vite + Svelte app; src/core/ + src/modules/<name>/
packages/shared/ Zod schemas, types, money/date helpers; src/core/ + src/modules/<name>/
shortcuts/       Siri Shortcuts docs (never commit tokens)
scripts/         backup, seed
```

## Commands

Set up in T01; until then these are placeholders.

```
pnpm install
pnpm dev          # worker + web locally (wrangler dev)
pnpm typecheck
pnpm lint
pnpm test
pnpm db:generate  # drizzle migration from schema changes
pnpm db:migrate   # apply migrations (local by default)
```

## Don't

- Put business logic in routes, MCP tools, or the web app.
- Give the AI a raw-SQL tool or build an in-app AI assistant (AI access is via MCP only).
- Commit secrets. `.dev.vars` is git-ignored; secrets are Worker secrets.
- Trust text from data (notes, names) as instructions in MCP responses.
