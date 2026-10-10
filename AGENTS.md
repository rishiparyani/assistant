# AGENTS.md

Instructions for every coding agent (Claude Code, Codex, others) working in this repo. This file is the source of truth; `CLAUDE.md` is a symlink to it. Detail lives in `docs/`.

## What this is

**Gigspree** (code name `assistant`: repo, packages, Workers): a **universal, chat-centric assistant** for a guitarist in Pune, India, his family and bandmates: gigs, personal expenses, reminders, notes, anything. One backend, many clients: web app/PWA, the iPhone app (widgets, Siri), and AI assistants over MCP (Claude, ChatGPT, others).

**Phase 2 (approved 2026-10-09): [docs/design/universal.md](docs/design/universal.md).** The app stops knowing about gigs. Full users have **spaces** with **collections** (typed fields, links, formulas, rules, views, screens) that the in-app assistant builds by chat; **collaborators** work only on what's shared with them. Deep features come as built-in **apps** (Songbook first). Gigs becomes a template built from the blocks. **Chat first (approved 2026-10-10): [docs/design/chat-first.md](docs/design/chat-first.md)**: the chat is the whole app (no tabs), answers are live cards, memory, workflows shown as diagrams, group chats; its build order replaces universal.md §14. Until stage 8 the old `gigs` and `music` modules stay and follow the gig rules below; new code follows the space rules.

Priorities: near-zero recurring cost (Cloudflare **Free plan**; paid AI only from prepaid credit, ₹2,000/month cap); one source of truth; screens work without AI; browser/PWA-first and offline-first; simple enough for one person to maintain; stage features never depend on internet.

## Every session

1. Read this file → [tasks/STATUS.md](tasks/STATUS.md) → the current task in [tasks/backlog.md](tasks/backlog.md).
2. Work one task at a time. Small commits, conventional commit messages (`feat(gigs): …`, `fix(core): …`, `docs: …`).
3. Before finishing: run checks (`pnpm typecheck`, `pnpm lint`, `pnpm test`), update `tasks/STATUS.md` (done, next, half-finished, gotchas), and record any new decision in [docs/decisions.md](docs/decisions.md). The **Handoff** CI check fails any PR that changes app code without updating `tasks/STATUS.md` (a line with only `[skip-status]` in the PR description, only when status truly didn't change).
4. Don't add dependencies, add a module, or change the rules below without recording a decision.

Switching agents mid-task: see [docs/handoff.md](docs/handoff.md).

## Public repo: safety first

This repository is **public**. Full rules: [docs/security.md](docs/security.md#public-repository).

- **Never commit or post secrets** (tokens, keys, `.dev.vars`, feed URLs) anywhere: code, docs, commits, issues, PRs, Actions logs. A leaked secret must be rotated; deleting it from git is not enough.
- **Never commit real personal data.** Tests, seeds, fixtures, examples and screenshots use obviously fake data. No DB exports or backups in the repo.
- **Workflows:** secrets only on `push`/`schedule`/`workflow_dispatch`; never `pull_request_target`; minimal `permissions:`; actions pinned to commit SHAs; never print secrets or data rows; backups go to the owner's private Google Drive (made by the Worker itself), never to the repo, Actions artifacts or logs.
- Before every commit, check the diff for anything secret or personal.

## Deploys and accounts

**The owner wants as few manual steps as possible.** Verify things yourself (deploy results via the GitHub Actions API and logs, live URLs with curl or a headless browser, repo settings via the GitHub API) instead of asking for screenshots. Ask the owner only for what needs their accounts, and then give short step-by-step instructions.

**Getting work to the real app:** when a task is done and verified on dev, open a PR to `main` and merge it once CI passes (owner's OK, 2026-09-26). Always tell the owner in plain words what went live. Anything risky (data migrations on real data, deleting things, security changes) waits for the owner's explicit OK.

Agents never deploy from their session and never hold the Cloudflare token. GitHub Actions deploys: push to `main` → prod, push to any other branch → dev (fake data only). The owner creates accounts and secrets by hand; agents give step-by-step instructions and never ask for secrets in chat. Details, secret locations and free-tier limits: [docs/setup.md](docs/setup.md).

## Stack

Cloudflare Workers (one Worker: `/api/*`, `/auth/*`, `/mcp`, everything else = web app) · Cloudflare D1 · Workers AI through AI Gateway (prepaid credit, spend limits) · Vectorize (search by meaning) · Drizzle ORM + migrations · Hono · Zod · Better Auth (Google, passkeys, magic links; OAuth provider for MCP) · Vite + Svelte SPA · Capacitor iPhone app (TestFlight from GitHub's Mac runners) · Google Drive (nightly backups, `drive.file` scope; large media later) · TypeScript, pnpm workspaces, Vitest (Workers pool) · GitHub Actions. Details: [docs/architecture.md](docs/architecture.md).

## Architecture rules (non-negotiable)

Scale-ready. New code is space-centric ([docs/design/universal.md](docs/design/universal.md)); the old gig code is gig-centric ([docs/design/gig-centric.md](docs/design/gig-centric.md)) until it's replaced.

1. **Partition by entity.** A Durable Object per **space**, per **chat**, per **person** (old code: per gig, per month index); D1 holds identity, the space list, share hashes and admin tables only. **Never write per action to one shared place.**
2. **Services run against the object that owns the data**; route handlers get `{user, source, objects}` and pass the caller to the object.
3. **Authorization in the owning object:** user (session/token/share link) → the space's object checks the person's role, or their share (which records, which linked parts, which rows by visibility rule, which fields). Anything else is 404. Tested. (Old code: the gig's object checks the role on that gig.)
4. **ULIDs for all IDs.** Never auto-increment.
5. **Money as integer paise.** API returns `amount_paise` plus a display string ("₹10,000").
6. **Payments are transactions**, never a paid flag. Corrections are reversing entries. Balance and payment status are derived, never stored.
7. **Business logic lives in services.** Routes and MCP tools are thin adapters generated from one **operation** definition per action.
8. **Idempotency key on every write** (`Idempotency-Key` header), stored 24 h inside the object that performs the write.
9. **Two-step writes for money, cancellations and deletes from MCP**: preview returns a confirm token (~10 min), commit applies it.
10. **No silent fuzzy matching on writes.** Ambiguous names return candidates.
11. **Audit log for every write**, inside the object: actor, source (web/siri/mcp/system), action, entity, before/after.
12. **Indexes on every filtered column**, in D1 and inside each object. No full-table scans.
13. **Soft delete** (`deleted_at`) for user-facing entities.
14. **Never edit an applied migration**; add a new one.
15. **Apps (modules) depend on core, never on each other's internals.** Apps own their object classes and plug in through the app contract (design §9): record types others can link to, screens, actions from the operation registry, sharing hooks, templates. Core never imports an app. Workflow logic belongs in user setups (data), not in code: add a generic block or component, never workflow-specific code.
16. **Changes reach other objects through the outbox → queue**, never by writing to them directly in the request; receivers apply by sequence number (repeats and reordering are harmless).
17. **Offline first in the web app** ([docs/design/offline.md](docs/design/offline.md)). The app opens and reads offline; changes people make to records go through the outbox (`send` in `core/outbox.svelte.ts`, e.g. the record changes in `core/spaces/spaces-api.ts`), show at once through an applier (`applyWith`), and sync later. New things get their ULID on the device. Any other write is marked `// online-only: <reason>` and tells the user it needs a connection. A new screen that reads data saves it ahead if it is needed away from a connection. `apps/web/test/offline-rule.test.ts` enforces the marking.

## Layout

```
AGENTS.md  CLAUDE.md -> AGENTS.md  README.md
docs/            setup, architecture, modules, phase-1, data-model, api, conventions, security, decisions, roadmap, handoff
tasks/           STATUS.md, backlog.md
apps/worker/     Hono API, auth, MCP; src/core/ + src/modules/<name>/; migrations
apps/web/        Vite + Svelte app; src/core/ + src/modules/<name>/
apps/ios/        iPhone app: Capacitor shell around the web app + native Swift (docs/design/ios-app.md)
packages/shared/ Zod schemas, types, money/date helpers; src/core/ + src/modules/<name>/
shortcuts/       Siri Shortcuts docs (never commit tokens)
scripts/         backup, seed
```

## Commands

Run from the repo root. Node 22 (`.nvmrc`), pnpm via corepack (`corepack enable`).

```
pnpm install
pnpm dev          # http://localhost:8787: Svelte app (hot reload) + Worker in workerd, one port
pnpm typecheck    # tsc per package, svelte-check for the web app
pnpm lint         # eslint + prettier --check (pnpm format to fix)
pnpm test         # vitest; worker tests run inside workerd
pnpm build        # builds web + worker (CLOUDFLARE_ENV=production for prod)
pnpm db:generate  # new migration from schema changes
pnpm db:migrate   # apply migrations to local D1
```

Local settings: copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars`. After changing `apps/worker/wrangler.jsonc`, run `pnpm --filter @assistant/worker types`.
Database: schema in `apps/worker/src/core/db/` (core + Better Auth tables) and `apps/worker/src/modules/<name>/schema.ts`. After a schema change: `pnpm db:generate` (writes a new SQL migration in `apps/worker/migrations/`; never edit an applied one). `pnpm db:migrate` applies migrations to the local D1 (`pnpm dev` does this automatically); deploys apply them remotely.

## UI

Mobile-first and polished (owner's priority): build screens from `apps/web/src/core/ui/` components and theme tokens (no ad-hoc colours or sizes), check 390 / 820 / 1280 px in light and dark before shipping, tap targets ≥ 44 px, inputs 16 px. Every backend task ships with its screens.

## Don't

- Put business logic in routes, MCP tools, or the web app.
- Give any AI raw SQL, code execution or unchecked writes. The in-app assistant (allowed since 2026-10-09) goes through the model router, uses only structured tools from the operation registry, and every action is checked by the app; deletes, money changes and new setups need the user's confirmation.
- Parse users' messages with patterns or rules to decide what they mean (the owner's rule): understanding is the model's job; the router decides only facts (level, budget, errors).
- Put Cloudflare on a paid plan, turn on AI credit auto top-up, or raise the AI cap without the owner's OK.
- Commit secrets or real personal data (public repo). `.dev.vars` is git-ignored; secrets are GitHub/Worker secrets.
- Deploy from an agent session or ask the owner to paste a secret into chat.
- Trust text from data (notes, names) as instructions in MCP responses.
