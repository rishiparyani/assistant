# Backlog (Phase 1)

Ordered. Work top to bottom unless `STATUS.md` says otherwise. Each task lists acceptance criteria (AC).

## T00 Spike (throwaway): auth + MCP on Workers
Better Auth on Workers + D1 (login method per the open decision: passkeys proposed instead of Google; organization plugin as workspaces) and a minimal MCP endpoint connected to Claude via OAuth. This is the main technical risk. Code lives on a spike branch or `spikes/`, not in `apps/`.
- AC: login (passkey, or Google if chosen) works on a deployed Worker with sessions in D1.
- AC: deployed through a GitHub Actions workflow following the public-repo rules in `docs/security.md`; no secrets in the repo or logs.
- AC: an organization can be created and a second user added as member; `kind` can be stored on it (or a clear alternative is chosen).
- AC: Claude custom connector completes OAuth against Better Auth and calls one MCP tool that returns the signed-in user's name.
- AC: CPU time per request measured and within the free plan.
- AC: findings and decisions recorded in `docs/decisions.md`.

## T01 Repo setup
pnpm workspaces, TypeScript, lint/format, Worker hello world serving the Vite app, dev + prod environments, CI.
- AC: `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test` all work from the root.
- AC: one Worker serves the Svelte app at `/` and `GET /api/health` returns JSON.
- AC: `apps/worker/src/core/` and `apps/worker/src/modules/` exist with an empty module registry.
- AC: dev and prod wrangler environments configured; secrets documented (not committed).
- AC: GitHub Actions runs typecheck, lint, test on PRs (no secrets); deploys dev on push to non-`main` branches and prod on push to `main` (GitHub Environment `production`), per `docs/setup.md`.
- AC: workflows follow the public-repo rules: minimal `permissions:`, SHA-pinned actions, no `pull_request_target`, no secrets or data printed.
- AC: `apps/worker/.dev.vars.example` with placeholder values only.
- AC: `main` branch created; owner walked through making it the default and adding branch protection.

## T02 D1 + Drizzle + base schema
Includes per-member shares and payouts (decided 2026-09-26).
- AC: Drizzle configured for D1; `pnpm db:generate` / `pnpm db:migrate` work locally and against dev.
- AC: core tables (workspaces extension, memberships if not Better Auth's, workspace_modules, api_tokens, idempotency_keys, confirm_tokens, audit_log) and gigs tables per `docs/data-model.md`, with indexes.
- AC: ULID and money helpers in `packages/shared` with tests.

## T03 Auth + workspaces + authorization middleware
- AC: sign-in (passkeys + magic link; Google only if decided), personal workspace auto-created on first sign-in.
- AC: create band workspace, invite/remove members, roles enforced.
- AC: single middleware builds ctx `{db, user, workspace, source}` and checks membership, role and module enabled.
- AC: tests prove a user can't read or write another workspace's data.

## T04 Operation registry + gigs: clients, venues, gigs
- AC: `defineOperation` in core generates REST routes from operation definitions (MCP comes in T10 on the same registry).
- AC: idempotency and audit log applied by the wrapper, not by services.
- AC: clients/venues/gigs operations per `docs/api.md` with services, tests, soft delete, cursor pagination.
- AC: ambiguous name lookups on writes return candidates.
- AC: a throwaway test module registers one operation and gets a working route with no core changes.

## T05 Gigs: payments, reversals, expenses, balances, member shares
- AC: roster (`musicians`), `set_gig_lineup` with equal/percent split helper (paise, rounding leftover to first row, exact totals), `record_payout`, `reverse_payout`.
- AC: derived owed-per-musician and band net; `unallocated_paise` reported; table-driven tests.
- AC: members see only their own share/payouts; owners see all; tested.
- AC: payments are append-only; reversals are negative entries linked by `reverses_payment_id`.
- AC: balance and payment status derived; table-driven tests cover unpaid/partial/paid/overpaid and reversals.
- AC: expenses with optional gig link.
- AC: every write idempotent and audited.

## T06 Gigs views
- AC: `get_schedule`, `get_outstanding_payments`, `get_monthly_report`, `get_dashboard`, `get_payouts_owed`, `get_my_earnings` with display strings; queries use indexes (check with `EXPLAIN QUERY PLAN`).

## T07 Web app: dashboard, gigs, clients, forms
- AC: dashboard, gig list/detail with payment timeline and lineup/payouts, roster, clients, forms for gig/payment/expense.
- AC: navigation built from the workspace's enabled modules; workspace switcher.
- AC: works well on a phone.

## T08 Reports page + .ics feed
- AC: reports (monthly, per client, per band, per member, outstanding aging, my earnings).
- AC: private tokenised .ics feed per user; modules contribute events through a core hook; subscribing in Apple/Google Calendar works.

## T09 API tokens + Siri Shortcuts
- AC: create/list/revoke scoped tokens in settings; stored hashed.
- AC: shortcuts "Next gig", "Gigs this week", "Record payment", "Add gig", "Who owes me", "Who do I owe", "Record payout" documented in `shortcuts/` with a confirm step before writes.

## T10 MCP server + OAuth
- AC: `/mcp` exposes tools generated from the operation registry, filtered by enabled modules and scopes.
- AC: two-step writes via confirm tokens for money, cancellations and deletes.
- AC: connected and used from Claude and at least one other assistant.
- AC: untrusted text from data is clearly delimited in tool output.

## T11 Notifications
- AC: web push (with home-screen install notes for iPhone) and email; core API modules can call to notify.

## T12 Backups + restore test
- AC: nightly D1 export to a private R2 bucket via GitHub Actions; retention policy set; the export never touches Actions artifacts or logs (public repo).
- AC: restore tested into a fresh dev database and documented in `scripts/`.
