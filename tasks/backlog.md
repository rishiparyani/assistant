# Backlog

Ordered. Work top to bottom unless `STATUS.md` says otherwise. Each task lists acceptance criteria (AC).

# Phase 2: universal assistant (design: `docs/design/universal.md`, approved 2026-10-09)

**Order now follows [docs/design/chat-first.md](../docs/design/chat-first.md) §5 (approved 2026-10-10).** Next: step 5, workflows with diagrams (C1–C4 done).

## C1 New look and the chat-first shell

Colour tokens per kind of card (lists amber, money green, people indigo, workflows violet, forms rose), the gradient assistant mark, a top bar with a side menu (chats, pinned, what it remembers, workflows, settings, help), the chat full screen. Remove the tab bar and the old screens (Overview, Gigs, Collections, Songs, Contacts, Reports and their pages); keep shared-with-you, join/link pages, settings, help, admin.

- AC: 390/820/1280 px, light and dark; no route left that points at a removed screen; offline rule test passes.

Stages 1–10 are in design §14. Stage 1 is split into these tasks.

## P2-1a Data engine

SpaceObject (Durable Object per space): collections, fields (types and options), records (values by field id), `record_values` typed index, links (both ways, one/many, ordered), audit, idempotency, numbered change log. D1: spaces and members. Generic operations (create collection, add/rename field, add/update/delete record, link/unlink, find with the filter language, describe collection) in the operation registry, so they are REST + MCP + assistant tools. The name resolver (exact names, aliases, candidates, never silent). Starter setup (Notes, Reminders, Events, Expenses) on a full user's first sign-in.

- AC: every field type in stage 1 (text, long text, number, money, date, date and time, yes/no, choice, multiple choice, person, link) validates and indexes; filters and sorts use the index (EXPLAIN shows no scans).
- AC: links are two-way; one/many enforced; delete behaviour (unlink / block / delete with it).
- AC: resolver returns candidates for ambiguous record names and errors listing real names for unknown fields.
- AC: change log lets a device pull "changes since N".
- AC: authorization tests: other users get 404.

## P2-1b App: chat home, collections, records, views, help

New shell replacing the gig app at gigspree.in: chat home, spaces and collections screens, record pages (fields, linked sections, + Add), list and table views with filters, pinned views as pop-ups, Help screen with tappable examples. Offline: local copy of setups and records, pull by change log, writes through the outbox.

- AC: everything doable by tapping, without AI; 390/820/1280 px, light and dark; offline browse and edit, sync later.

## P2-1c Model router and model test

Router in our code: level 1 (GLM 4.7 Flash on Workers AI, everyday tools + handover), level 2 (Kimi K2.6, setup tools: create collection, add field), level 3 (Claude Sonnet 5.5 via AI Gateway); app checks every action, retries, escalation, budgets (free allowance, ₹2,000 monthly cap, per-person limits), logging, streaming replies. Model test script with fam jam, guest list, setup changes and everyday/Hinglish requests; results stored in the repo.

- AC: no pattern parsing of messages; a request needing setup tools reaches level 2 by handover; failing checks escalate; over-budget falls back to free or pauses.
- AC: owner step: load prepaid AI credit and set spend limits (instructions in `docs/setup.md`).

# Phase 1 (gig app, built; replaced by Phase 2)

## T00 Spike (throwaway): auth + MCP on Workers

Better Auth on Workers + D1 (Google sign-in, organization plugin as workspaces) and a minimal MCP endpoint connected to Claude via OAuth. This is the main technical risk. Code lives on a spike branch or `spikes/`, not in `apps/`.

- AC: Google sign-in works on a deployed Worker with sessions in D1.
- AC: deployed through a GitHub Actions workflow following the public-repo rules in `docs/security.md`; no secrets in the repo or logs.
- AC: an organization can be created and a second user added as member; `kind` can be stored on it (or a clear alternative is chosen).
- AC: Claude custom connector completes OAuth against Better Auth and calls one MCP tool that returns the signed-in user's name.
- AC: CPU time per request measured and within the free plan.
- Status: **done 2026-09-26** (Google sign-in, workspace, Claude connector `whoami`, ~0.3 ms CPU/request). Second member verified in tests only.
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
- Status: code done 2026-09-26; `main` and owner's GitHub settings pending.

## T02 D1 + Drizzle + base schema

Includes per-member shares and payouts (decided 2026-09-26).

- Status: **done 2026-09-26**, live on prod.

- AC: Drizzle configured for D1; `pnpm db:generate` / `pnpm db:migrate` work locally and against dev.
- AC: core tables (workspaces extension, memberships if not Better Auth's, workspace_modules, api_tokens, idempotency_keys, confirm_tokens, audit_log) and gigs tables per `docs/data-model.md`, with indexes.
- AC: ULID and money helpers in `packages/shared` with tests.

## T03 Auth + workspaces + authorization middleware

- AC: sign-in with Google (from T00) plus passkeys, personal workspace auto-created on first sign-in. (Magic links moved to T11, decision 2026-09-26.)
- Status: **done 2026-09-26**, live on prod.
- AC: create band workspace, invite/remove members, roles enforced.
- AC: single middleware builds ctx `{db, user, workspace, source}` and checks membership, role and module enabled.
- AC: tests prove a user can't read or write another workspace's data.

## T04 Operation registry + gigs: clients, venues, gigs

- AC: `defineOperation` in core generates REST routes from operation definitions (MCP comes in T10 on the same registry).
- AC: idempotency and audit log applied by the wrapper, not by services.
- AC: clients/venues/gigs operations per `docs/api.md` with services, tests, soft delete, cursor pagination.
- AC: ambiguous name lookups on writes return candidates.
- AC: a throwaway test module registers one operation and gets a working route with no core changes.
- Status: **done 2026-09-26**, live on prod.

## T05 Gigs: payments, reversals, expenses, balances, member shares

- AC: roster (`musicians`), `set_gig_lineup` with equal/percent split helper (paise, rounding leftover to first row, exact totals), `record_payout`, `reverse_payout`.
- AC: derived owed-per-musician and band net; `unallocated_paise` reported; table-driven tests.
- AC: members see only their own share/payouts; owners see all; tested.
- AC: payments are append-only; reversals are negative entries linked by `reverses_payment_id`.
- AC: balance and payment status derived; table-driven tests cover unpaid/partial/paid/overpaid and reversals.
- AC: expenses with optional gig link.
- AC: every write idempotent and audited.
- Status: **done 2026-09-26**, live on prod.

## U0 UI foundation (do before T06)

Decided 2026-09-26: UI work runs alongside backend work from here on; every task ships with its screens.

- AC: design system in `apps/web/src/core/ui/`: tokens (colour, type scale, spacing, radius, shadows) with light/dark, Inter (self-hosted), icon set; components: button, input/select/textarea with labels and errors, list rows, cards, badges/status pills, segmented control, bottom sheet (phone) / dialog (desktop), toast, empty state, skeleton loaders, money and date display.
- AC: app shell: phone = large-title top bar + bottom tab bar with safe-area insets; tablet/laptop (≥ 768 px) = sidebar navigation + wider content (two-column where useful); workspace switcher; nav built from enabled modules.
- AC: existing screens (login, consent, workspaces, band page, invite, settings) rebuilt on it.
- AC: feels like a native app on iPhone (tap targets ≥ 44 px, no zoom on inputs, smooth transitions, standalone-capable manifest) and not stretched on a laptop.
- AC: screenshots at 390 px, 820 px and 1280 px reviewed by the owner before building every screen.
- Status: **done 2026-09-26**, live on prod; owner feedback on the look welcome any time.

## U1 Gig screens for T04/T05 (catch-up)

- AC: gigs list (upcoming / past / by status), gig detail (details, money: fee, received, balance, payments timeline, lineup with shares and payouts, expenses for owners), add/edit gig, record payment / reverse, set lineup (equal / percent / fixed), record payout / reverse, record expense.
- AC: clients and venues lists with search, detail, add/edit; band roster.
- AC: ambiguous-name answers from the API shown as a picker, never a dead end.
- AC: members see only what the API gives them (own share), with no broken empty sections.
- Status: **done 2026-09-26**. The web app picks clients, venues and musicians by id from searchable pickers (with inline "Add …"), so ambiguous names can't arise there; the candidates answer matters for MCP/Siri (T09, T10).

## R1 Gig-centric rework (see docs/design/gig-centric.md)

- Status: design approved 2026-09-28; building. Replaces workspaces/collectives; supersedes the remaining T06 collective views. Steps in the design's section 12.

## T06 Me Home and gigs views (see decision 2026-09-27)

- AC: user-scoped `get_my_home` (upcoming gigs across my workspaces, owed to me per collective, earned this month, payouts I owe in collectives I own) and `get_my_earnings`; workspace-scoped `get_schedule`, `get_outstanding_payments`, `get_monthly_report`, `get_payouts_owed`; display strings; queries use indexes (`EXPLAIN QUERY PLAN`); only my own amounts from collectives where I'm a member.
- AC: Home screen is the Me view (not tied to the open workspace); collective pages keep their own lists.
- AC: members see the lineup of a gig (names, roles; no amounts except their own).
- AC: joining a collective links the member to a roster entry (owner picks, or one is created); owners are prompted to add themselves to the roster.
- Status: **Me Home part done 2026-09-27** (`get_my_home`, Home screen at `/`, lineup names for members, roster auto-link on join by email or new entry, "Add me" prompt). Still to do: `get_my_earnings` (per-month history), `get_schedule`, `get_outstanding_payments`, `get_monthly_report`, `get_payouts_owed` and their screens in the collective space.

## T07 Web app polish (was: dashboard, gigs, clients, forms)

Most of T07 moved into U0, U1 and T06. What remains:

- AC: navigation built from the workspace's enabled modules; workspace switcher remembers the last workspace.
- AC: every screen checked at 390 / 820 / 1280 px, light and dark; accessibility pass (labels, focus, contrast).

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
- AC: email magic-link sign-in (moved from T03) once the email service exists.

## T12 Backups + restore test

- AC: nightly D1 export to a private R2 bucket via GitHub Actions; retention policy set; the export never touches Actions artifacts or logs (public repo).
- AC: restore tested into a fresh dev database and documented in `scripts/`.
