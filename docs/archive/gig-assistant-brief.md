# Gig Assistant: project brief (handoff to Claude Code / Codex)

Decisions made in a planning conversation on 26 Sep 2026. Treat this as the source of truth for starting the repo. Turn it into AGENTS.md + docs/ as the first task.

## Kickoff prompt (paste into Claude Code with this file in the repo root)

> Read gig-assistant-brief.md. Set up the repository as described under "First task": create AGENTS.md (with CLAUDE.md as a symlink to it), the docs/ files and tasks/ files, the folder structure and root configs. Don't write application code yet. When done, update tasks/STATUS.md and show me the tree.

## What we're building

A personal/band "Gig Assistant" for a guitarist who plays in multiple bands (based in Pune, India). One backend, many clients: web app/PWA, Siri Shortcuts, and AI assistants via MCP (Claude, ChatGPT, others). Built in phases.

**Priorities:** near-zero recurring cost; one source of truth; assistants are clients with no logic of their own; browser/PWA-first (no native apps); simple enough for one person to maintain; stage features must never depend on internet.

## Phases

- **Phase 1 (now): gig management.** Gigs, clients, venues, fees, payments (partial), expenses, outstanding balances, schedule, reports, workspaces (personal + bands), Siri Shortcuts, MCP server, web admin app, calendar feed (.ics).
- **Phase 2:** song library (ChordPro charts, arrangements, immutable chart revisions), setlists (drag and drop, freeze/pin revisions), offline PWA with full repertoire in IndexedDB, stage/teleprompter mode, role-specific views, Bluetooth page-turner support.
- **Phase 3:** local band sync hub (travel router + Raspberry Pi 4, hub-authoritative state over wss://, leader turns the page and every screen follows by song section), MIDI via the Pi (Boss GT-1000, TONEX One+).
- **Later:** notifications beyond basics, WhatsApp client messages, media integration, multi-tenant sign-up for other bands.

**Out of Phase 1:** songs/setlists/stage, offline mode, sync, MIDI, invoices/GST documents, automatic client reminders, public sign-up, in-app AI assistant (explicitly rejected: AI access is via MCP only), raw-SQL tool for AI (rejected: keep fixed API operations).

## Stack (decided)

- **Cloudflare Workers:** API, business logic, MCP server, and serving the web app's static files. One Worker, one domain (e.g. `app.<domain>`): `/api/*`, `/auth/*`, `/mcp`, everything else = web app.
- **Cloudflare D1** (SQLite): all data, including auth tables. Chosen over Neon/Supabase/Firestore/Azure because it bills per rows read/written with no idle compute charges; frequent tiny requests stay free.
- **Better Auth** inside the Worker: Google sign-in, passkeys, email magic links (avoid password login: hashing can exceed the free plan's 10 ms CPU limit). Also acts as the OAuth provider for MCP connectors. Bands = organizations (verify the organization plugin in the spike).
- **Drizzle ORM:** schema + versioned migrations for D1 (and Better Auth tables).
- **Hono:** routing in the Worker.
- **Zod:** request validation; schemas shared between Worker and web app.
- **Web app:** Vite + Svelte (SPA, becomes the PWA in Phase 2).
- **Cloudflare R2:** backups and small app-critical files.
- **Google Drive (user has 5 TB):** large media later (videos, recordings, backing tracks). Start with a shared Drive folder + pasted links; no integration in Phase 1.
- **Email service** (free tier) for magic links; reuse for summaries.
- **TypeScript everywhere**, pnpm workspaces, Vitest (Workers test pool).
- **GitHub + GitHub Actions:** CI, deploys, scheduled backups.
- Recurring cost target: only the domain.

## Architecture rules (non-negotiable)

1. **Shared database, `workspace_id` on every tenant row.** Personal workspace per user + one per band. Users ↔ workspaces via memberships with roles (owner, member).
2. **All data access goes through one scoped layer**, `getDb(workspaceId)` / service functions taking a context `{db, user, workspace, source}`. This makes a later move to one-database-per-band a migration, not a rewrite.
3. **Authorization in one middleware** every route passes through: user → membership → role. Test that a user can't read another workspace's data.
4. **ULIDs for all IDs** (never auto-increment), so rows can move between databases later.
5. **Money as integer paise.** API returns `amount_paise` plus a display string (e.g. "₹10,000").
6. **Payments are transactions**, never a paid flag. Corrections are reversing entries, not edits. Balance = fee − sum(payments); payment status (unpaid/partial/paid/overpaid) is derived, never stored.
7. **Business logic lives in services**, not routes, not MCP tools. Routes and MCP tools are thin adapters over the same services.
8. **Idempotency key on every write** (header `Idempotency-Key`), stored with the response for 24 h.
9. **Two-step writes for money and cancellations from MCP:** preview returns a confirm token (valid ~10 min); commit applies it.
10. **No silent fuzzy matching on writes:** ambiguous client/gig names return candidates.
11. **Audit log** for every write: actor, source (web/siri/mcp/system), action, entity, before/after.
12. **Indexes** on every column used for filtering (`workspace_id`, dates, `client_id`, `gig_id`). Avoid full-table scans (D1 bills rows scanned).
13. **Soft delete** (`deleted_at`) for gigs, clients, venues.
14. **Never edit an applied migration**; add a new one.

## Data model (Phase 1, draft)

- Auth tables managed by Better Auth (users, sessions, accounts, verification; organizations/members/invitations if the plugin is used as workspaces). Workspace gets a `kind`: personal | band.
- **clients:** id, workspace_id, name, phone, email, organisation, notes, timestamps, deleted_at.
- **venues:** id, workspace_id, name, city, address, notes, timestamps, deleted_at.
- **gigs:** id, workspace_id, client_id, venue_id, title, event_type, start_at, end_at (UTC ISO; display in Asia/Kolkata), status (enquiry → confirmed → completed | cancelled), fee_paise, notes, created_by, timestamps, deleted_at.
- **payments:** id, workspace_id, gig_id, amount_paise (negative for reversals), paid_on, method (cash/upi/bank/cheque/other), reverses_payment_id, note, created_by, created_at.
- **expenses:** id, workspace_id, gig_id (nullable), category, amount_paise, spent_on, note, created_by, created_at.
- **api_tokens:** id, user_id, name, token_hash, scopes (JSON), last_used_at, revoked_at, created_at. For Siri Shortcuts: scoped (e.g. read + add gig + record payment, no delete/cancel), revocable.
- **idempotency_keys:** key, user_id, request_hash, response_json, created_at.
- **audit_log:** id, workspace_id, actor_user_id, source, action, entity_type, entity_id, before_json, after_json, created_at.
- **OPEN DECISION:** track each band member's share and payout in Phase 1, or only the band's total fee? Ask the user before finalising the schema.

## API operations (Phase 1)

REST under `/api`, same services exposed as MCP tools at `/mcp`:

- Gigs: create_gig, find_gigs, get_gig, update_gig, confirm_gig, complete_gig, cancel_gig
- Clients: create_client, find_clients, get_client_history
- Venues: create_venue, find_venues
- Money: record_payment, reverse_payment, record_expense
- Views: get_schedule, get_outstanding_payments, get_monthly_report, get_dashboard
- Calendar: private .ics feed URL per user (tokenised)
- Settings: workspaces, members, API tokens

Conventions: JSON; ISO dates; cursor pagination; error shape `{error: {code, message, details?}}`; responses LLM-friendly (include display strings and names, not just IDs).

## Clients (Phase 1)

- **Web app:** dashboard (upcoming gigs, outstanding, this month), gig list/detail with payment timeline, clients, forms for gig/payment/expense, reports (monthly, per client, per band, outstanding aging), settings.
- **Siri Shortcuts:** helpers `GA · Config` (API URL + token) and `GA · API Request` (all calls go through it); user-facing "Next gig", "Gigs this week", "Record payment", "Add gig", "Who owes me". Confirm step before writes. Optional later: Apple's on-device model ("Use Model" action) to parse free-form commands into an action + parameters. Keep a `shortcuts/` folder documenting each one.
- **AI assistants:** MCP server with OAuth via Better Auth. Custom connectors in Claude (a "Gig Assistant" project), ChatGPT (developer mode), Mistral Le Chat. Gemini consumer app doesn't support custom connectors yet.
- **Notifications (basic):** web push (iPhone requires home-screen install), email, optional Telegram bot (users connect via a one-time link; bots can't message by username).

## Security

HTTPS via Cloudflare; Better Auth sessions in HttpOnly, Secure, SameSite cookies; origin checks; single authorization middleware; Zod validation on every input; Drizzle parameterised queries; secrets as Worker secrets (never in repo; `.dev.vars` git-ignored); API tokens stored hashed; Cloudflare rate limiting on auth and API; audit log; keep dependencies (especially Better Auth) updated. Treat text from data (notes) as untrusted in MCP responses.

## Operations

Separate dev and prod D1 databases; migrations via Drizzle; nightly D1 export to R2 (plus a copy to Google Drive later); test a restore once; GitHub Actions CI (typecheck, lint, test) and deploy on merge.

## Repo layout (proposed)

```
gig-assistant/
  AGENTS.md              # instructions for all coding agents (source of truth)
  CLAUDE.md -> AGENTS.md # symlink
  README.md
  docs/
    architecture.md  phase-1.md  data-model.md  api.md
    conventions.md   security.md decisions.md  roadmap.md
    handoff.md       # how to resume work when switching agents
  tasks/
    STATUS.md        # current state, last task done, next task, gotchas
    backlog.md       # ordered tasks with IDs + acceptance criteria
  apps/
    worker/          # Hono API, auth, MCP, services, db (Drizzle), migrations
    web/             # Vite + Svelte app
  packages/
    shared/          # Zod schemas, shared types, money/date helpers
  shortcuts/         # Siri Shortcuts docs (never commit tokens)
  scripts/           # backup, seed
  .github/workflows/
```

Later phases add `apps/hub/` (Pi stage hub, Node + ws + MIDI).

## Agent workflow (so Claude Code and Codex are interchangeable)

- AGENTS.md is the single instruction file; CLAUDE.md is a symlink to it (Windows clones need git symlink support; otherwise CLAUDE.md can contain just `@AGENTS.md`).
- Every session: read AGENTS.md → tasks/STATUS.md → the current task in tasks/backlog.md.
- Work one task at a time; small commits (conventional commit messages).
- Before finishing: run checks (typecheck, lint, tests), update tasks/STATUS.md (what was done, what's next, anything half-finished, gotchas), record any new decision in docs/decisions.md.
- Don't add dependencies or change architecture rules without recording a decision.

## Phase 1 task order

- **T00 Spike (throwaway):** Better Auth on Workers + D1 (Google sign-in, organization plugin as workspaces) and a minimal MCP endpoint connected to Claude via OAuth. This is the main technical risk.
- **T01** Repo setup: pnpm workspaces, TypeScript, lint/format, Worker hello world serving the Vite app, dev + prod environments, CI.
- **T02** D1 + Drizzle setup, base schema, migrations (after the open decision on member shares).
- **T03** Auth + workspaces + authorization middleware + access tests.
- **T04** Services + REST: clients, venues, gigs.
- **T05** Services + REST: payments, reversals, expenses, derived balances; idempotency; audit log.
- **T06** Views: schedule, outstanding, monthly report, dashboard.
- **T07** Web app: dashboard, gigs, clients, forms.
- **T08** Reports page + .ics calendar feed.
- **T09** API tokens + Siri Shortcuts (+ docs in shortcuts/).
- **T10** MCP server (tools over services, two-step writes) + OAuth.
- **T11** Notifications (web push, email).
- **T12** Backups to R2 + restore test.

**Phase 1 is done when:** all real gigs and payments are managed through it for a month; balances and totals match reality; Siri and at least one AI assistant read and record safely; nightly backups run and a restore was tested.

## First task (repo setup, no app code)

1. Create AGENTS.md from the rules, stack, workflow and commands in this brief (keep it concise; link to docs/ for detail).
2. `ln -s AGENTS.md CLAUDE.md`.
3. Create docs/ files by splitting this brief; docs/decisions.md lists each decision with date and reason (D1 over Neon/Firestore/Azure; Better Auth over Firebase; shared DB + workspace_id; fixed APIs over raw SQL; MCP over in-app assistant; Drive for large media, R2 for small).
4. Create tasks/backlog.md (T00–T12 with acceptance criteria) and tasks/STATUS.md (next: T00; open decision: member shares).
5. Create the folder structure, root package.json with pnpm workspaces, tsconfig.base.json, .gitignore (include .dev.vars, node_modules, dist, .wrangler), .editorconfig, .nvmrc.
6. Delete or archive this brief once its content lives in AGENTS.md and docs/.
