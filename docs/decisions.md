# Decisions

Newest at the bottom. Format: date, decision, reason. Don't edit old entries; add a new one that supersedes.

## 2026-09-26: Cloudflare D1 for all data

Chosen over Neon, Supabase, Firestore and Azure. D1 bills per rows read/written with no idle compute charge, so frequent tiny requests (Siri, MCP) stay free. Consequence: index every filtered column; avoid full-table scans.

## 2026-09-26: Better Auth over Firebase Auth

Runs inside the Worker, stores its tables in D1 (one source of truth), and can act as the OAuth provider for MCP connectors. No password login because hashing can exceed the free plan's 10 ms CPU limit. Organization plugin as workspaces, to be verified in T00.

## 2026-09-26: Shared database with `workspace_id`

One database, `workspace_id` on every tenant row, one scoped data layer, ULIDs. A later move to one database per band becomes a data migration, not a rewrite.

## 2026-09-26: Fixed API operations, no raw SQL for AI

AI assistants get the same fixed operations as every other client. Safer (validation, authorization, audit) and keeps logic in one place.

## 2026-09-26: MCP instead of an in-app AI assistant

AI access is via MCP from the user's existing assistants (Claude, ChatGPT, Le Chat). No model costs, no chat UI to build; the app stays the source of truth.

## 2026-09-26: Google Drive for large media, R2 for small files

The user has 5 TB of Drive. Large media (videos, recordings, backing tracks) lives there as pasted links in Phase 1, integration later. R2 holds backups and small app-critical files.

## 2026-09-26: Core + modules, Gigs as the first module

The focus is gig management, but the assistant should be able to help with other tasks later. So the backend is a small core (auth, workspaces, authorization, operation registry, idempotency, confirm tokens, audit, API tokens, notifications) with feature modules on top. Gigs is module one; Phase 2 music/setlists is module two.
Reason: adding a kind of task should mean adding a module, not changing core or clients. Each action is defined once as an operation and exposed as REST (web, Siri) and MCP automatically.
Guardrails against over-engineering: no plugin loading at runtime (modules are compiled in and listed in one file); one database and migration sequence; shared concepts (contacts, reminders, attachments) are promoted to core only when a second module needs them.
Repo named `assistant` rather than `gig-assistant` for the same reason; the product can still be called "Gig Assistant" while gigs is its only module.

## 2026-09-26: Track each band member's share and payout in Phase 1

Decided by the user. Gigs get a lineup (`gig_lineup`: musician + `share_paise`) and band-to-musician payouts (`payouts`, append-only with reversals like client payments). Musicians are a roster per band (`musicians`), optionally linked to a user account, so deps and players who never sign in still work. Amounts owed and band net are derived. Shares need not add up to the fee (kitty allowed, reported as unallocated). Members see only their own share by default; owners see all.
Reason: the point of the app is knowing who owes whom; in a band that includes what the band owes its players.

## 2026-09-26: No further modules planned yet

The user will decide what else the assistant helps with as needs come up. The core + modules structure stays so that's cheap; nothing is built speculatively for unknown modules. Ideas stay in [roadmap.md](roadmap.md).

## 2026-09-26: Deploy only through GitHub Actions

Push to `main` deploys prod; push to other branches deploys dev. Agent sessions never deploy and never hold the Cloudflare token; it lives only in GitHub Actions secrets.
Reason: the agent environment can't reach the Cloudflare API anyway; keeping the token out of agent sessions is safer; every deploy is logged and can be rolled back; deploys keep working without an agent. See [setup.md](setup.md).

## 2026-09-26: Public repository

The repo is public (unlimited free Actions minutes). Consequences: no secrets or real personal data in the repo, issues, PRs or Actions logs/artifacts; hardened workflows; secret scanning and push protection enabled. Rules in [security.md](security.md#public-repository). Can be made private later; the free Actions allowance (2,000 min/month) still fits.

## 2026-09-26: Google sign-in first, passkeys and magic links later

Decided by the owner. T00 uses Google sign-in (as in the original brief). Passkeys and email magic links are added in T03; Google stays. Google OAuth app starts in Testing mode (test users only); publish it before inviting band members (basic scopes need no Google verification).
Reason: familiar one-tap login for the owner and bandmates; other methods cover people without Google and account recovery.

## 2026-09-26: Deploy workflow generates BETTER_AUTH_SECRET

Instead of the owner creating it by hand, the deploy workflow sets it on each Worker the first time (random, never printed or stored in GitHub). One fewer manual step, and each environment gets its own value automatically.

## 2026-09-26: T00 approach (findings pending the deployed test)

- MCP OAuth uses `@better-auth/oauth-provider` (Better Auth 1.7; the older `mcp` plugin no longer ships). It needs the `jwt` plugin; access tokens are JWTs with the MCP URL as audience, verified in-process against Better Auth's JWKS (no self-fetch).
- D1 binding passed straight to Better Auth as `database`; schema SQL generated from the auth options with `getMigrations().compileMigrations()` and applied with `wrangler d1 migrations`.
- The spike's MCP server is a ~80-line stateless JSON-RPC handler, not the MCP SDK. Revisit for T10 (SDK vs hand-rolled over the operation registry).
- Dependencies added for the spike only: `better-auth`, `@better-auth/oauth-provider`, `hono`, `wrangler`, `vitest`, `typescript`.
  Deployed results (2026-09-26): Google sign-in works on the Worker with sessions in D1; the owner created a `band` workspace; the Claude custom connector completed OAuth (dynamic registration, login, consent) and `whoami` returned the owner's name, email and workspace. Second member tested in-process only (vitest). CPU time: 41 requests used 11 ms of CPU in total (~0.3 ms average; no request can have exceeded 11 ms), including sign-in, JWT key creation and the full OAuth flow. Well within the free plan's 10 ms per request.
  Conclusion: the stack in the brief works; no change of plan needed.

## 2026-09-26: T01 tooling

- **TypeScript 6.0** (not 7): typescript-eslint and svelte-check don't support TS 7 yet. **Vitest 4.1**: required by `@cloudflare/vitest-pool-workers`. Shared versions live in the pnpm `catalog` in `pnpm-workspace.yaml`.
- **`@cloudflare/vite-plugin`**: `apps/web`'s Vite config runs the Worker (`apps/worker/wrangler.jsonc`) in workerd, so `pnpm dev` is one server on port 8787 (matches the Google redirect URI) with hot reload, and `vite build` produces the Worker + static assets that `wrangler deploy` ships. Assets use SPA fallback; `/api/*`, `/auth/*`, `/mcp`, `/.well-known/*` always hit the Worker.
- Wrangler environments: top level = dev (`assistant-dev`), `env.production` = prod (`assistant`), chosen at build time with `CLOUDFLARE_ENV`.
- `compatibility_date` must not be newer than the workerd bundled with the test pool (currently 2026-08-22), or tests fail to start.
- Lint: ESLint 10 flat config (typescript-eslint, eslint-plugin-svelte) + Prettier (printWidth 110).

## 2026-09-26: T02 database

- **One migration history for everything**, generated by drizzle-kit from Drizzle schemas and applied with `wrangler d1 migrations apply` (locally by `pnpm dev`, remotely by the deploy workflow). Better Auth's tables are mirrored in Drizzle (`auth-schema.ts`) with Better Auth's exact names and types; `test/auth-schema.test.ts` asks Better Auth itself whether anything is missing, and a self-check proves the test catches a dropped column.
- Better Auth keeps talking to D1 directly (as in the spike), not through the Drizzle adapter. Our code uses Drizzle (`createDb`).
- Better Auth IDs are ULIDs (`advanced.database.generateId`).
- Workspaces stay Better Auth's `organization` / `member` tables (not renamed) to avoid mapping bugs; our `workspace_id` columns reference `organization.id`.
- Business invariants that are cheap to enforce in SQL are CHECK constraints (reversals, positive amounts, status lists, date formats) on top of service validation.
- Helpers in `packages/shared`: `ulid()`, `formatINR()` (Indian grouping, `₹1,00,000`), `parseINR()`, `money()`; hand-written (no dependency), table-tested.
- `/api/health` reports the applied migration count; deploy smoke tests require ≥ 1.

## 2026-09-26: T03 auth and workspaces

- **Sign-in:** Google + passkeys (added from Settings after a first Google sign-in). **Email magic links are deferred to T11**, when an email service exists; until then there is no email-based login or recovery (a second passkey or Google covers it).
- **Invitations without email:** an owner invites an email address and gets a link (copy / share on WhatsApp). Only a user signed in with that exact email can see or accept it; links expire after 7 days; re-inviting replaces the old link. Bandmates need Google (the Google app must be **published**, or they must be added as test users) or a passkey.
- **One path for workspace changes:** Better Auth's `/auth/organization/*`, `/auth/admin/*` and OAuth client-admin endpoints are blocked at the router. Workspaces, members and invitations are written by `core/workspaces/service.ts` in one D1 batch with their audit entry. Better Auth still owns sign-in, sessions, passkeys and the OAuth flow for MCP.
- Every new user gets a personal workspace (Better Auth `user.create.after` hook) with all modules enabled; band workspaces also get every module.
- **Authorization:** `requireUser` (session) → `requireWorkspace({ role, module })`. Non-members get 404 (a workspace's existence isn't revealed); members lacking the role get 403; a disabled module gives 403. Owners can't remove the last owner; personal workspaces can't have members.
- T03 routes are plain Hono routes over services. T04 moves them onto the operation registry, which adds idempotency keys.
- Web app: small path router (no framework router), Better Auth browser client for Google/passkeys, email+password sign-in only on localhost for testing.

## 2026-09-26: T04 operation registry

- Operations are plain objects (`defineOperation`) registered by the core; modules list theirs in `defineModule({ operations })`. HTTP routes are generated (`/api/w/:workspaceId/...` or `/api/...`); MCP tools will be generated from the same list in T10.
- **Audit by the wrapper:** handlers write only through `ctx.commit(statements, change)`, which appends the audit entry and runs one D1 batch. Services never touch `audit_log` directly (the personal-workspace sign-up hook is the one system-level exception).
- **Idempotency:** the key is reserved before the handler runs (status 0 = in progress); a concurrent duplicate gets 409, a finished one gets the stored response replayed, a failed handler releases the key. Keys are per user, kept 24 h (cleanup job in T12).
- T03's workspace routes moved onto the registry (behaviour kept; deletes now return JSON).
- Name resolution never guesses: exact case-insensitive match on one record, otherwise candidates (409 `ambiguous`) or 404.
- Dates are formatted by hand (not `Intl`), because runtimes format differently ("12 Dec, 2026" vs "12 Dec 2026").
- Added `delete_gig` / `update_*` / `delete_*` operations beyond the brief's list, for correcting mistakes; deletes are soft and flagged `confirm` for MCP.

## 2026-09-26: T05 money rules

- **Who can do what:** members can record client payments and expenses (they often collect cash) and correct their own entries; owners manage the roster, lineups and payouts, and can correct anything. Members see a gig's fee side (fee, received, balance, status) and only their own lineup row; expenses, other shares, unallocated and net are owner-only.
- A musician becomes "me" for a member by linking the roster entry to their account (`user_id`, must be a workspace member).
- Corrections are reversing entries (payments and payouts). A reversal can't itself be reversed, and each entry can be reversed once (enforced in the service and by a unique index). Expenses aren't money owed, so a mistaken one is deleted (audited).
- Lineups are set as a whole. Anyone with payout history stays in the lineup (so the history stays visible), even if their payouts net to zero. Payouts require the musician to be in the lineup.
- Split rounding: leftover paise go to the first person; percentages over 100% are rejected; under 100% leaves the rest unallocated.
- Lineup order = order added (new rows get created_at + i ms), no schema change needed.
- A plain number for an amount means rupees; `*_paise` is the exact form.

## 2026-09-26: UI in parallel, mobile-first and polished

Decided by the owner: the UI must feel like a very good mobile app on a phone (main use) and not be shabby on an iPad or laptop. From now on every task ships with its screens. Order: U0 (design system + app shell + existing screens rebuilt), U1 (screens for what T04/T05 built), then T06 with the dashboard. Phone: large titles, bottom tab bar, sheets. Tablet/laptop (≥ 768 px): sidebar, wider two-column layouts. Dependencies added for this: `@lucide/svelte` (icons), `@fontsource-variable/inter` (self-hosted font, works offline later).

## 2026-09-27: "Collective" in the product, "Me" Home across collectives

Owner's vision: a collective works together in its own space; the owner's Home shows only what concerns them, across every collective.

- **Naming:** shared workspaces are called **collectives** everywhere a person reads (web app, MCP tool descriptions, Siri). Code, database and API keep `kind = "band"` so no live data is migrated; treat "band" in code as "collective" in copy.
- **Home = Me** (user-scoped, not tied to one workspace): my upcoming gigs from all my workspaces, what each collective still owes me (my shares minus payouts to me), what I earned this month, and, for collectives I own, payouts I still owe others. Built from musician rows linked to my account (`musicians.user_id`); it never exposes other people's amounts. Replaces the per-workspace dashboard planned for T06.
- **Collective space:** every member can manage gigs, payments, clients and venues; members see who plays each gig (names and roles, no amounts) and their own share; owners see all money. Lineup and payouts stay owner-only.
- **Linking:** when someone joins a collective they get linked to a roster entry (the owner's pick, or a new one), so their shares reach their Home. The owner should be on their own roster too.
- **Personal workspace** stays for solo/dep gigs; they appear on Home as well.

## 2026-09-27: Module hooks and user-scoped module reads

For the Me Home and roster linking, the module contract gains (1) read-only `scope: "user"` operations, which must limit themselves to the caller's workspaces with the module enabled, and (2) `hooks.memberJoined`, whose statements are committed in the same batch as the core membership write and audited under the module. Core still never imports a module. "Earned" counts only confirmed/completed gigs that have started.

## 2026-09-27: Collective settings for lineups and payouts

Owner's request: make lineup visibility and who can set lineups / record payouts configurable per collective, including "everyone". Stored as Gigs settings in `workspace_modules.settings_json` (no migration), changed by owners on the Collective page, audited. Defaults: members see who plays; only owners set lineups and record payouts. Anyone allowed to set lineups or record payouts also sees everyone's shares (you can't split or pay without them); expenses and net stay owners-only; roster edits and account links stay owners-only. Supersedes "lineup and payouts stay owner-only" in the earlier 2026-09-27 entry.

## 2026-09-28: Gig-centric, scale-ready design (approved)

Discussed at length with the owner, who approved it ("I'm trusting you with the design; if something goes wrong we can change it"). Workspaces go away; a gig (booking, with one or more events) is the unit of sharing, money and consistency; per-gig roles (manager/player) and visibility (players see only their share by default); "collective" becomes a tag with people-only autofill; address book as fill-in templates; duplicate warnings (only for people you've played with) instead of merging. For high volume, and because the owner wants to learn scale: Durable Objects with SQLite (one per gig, one per person, month index, a few pending shards), D1 for identity and tags only, a transactional outbox per gig delivered through one Cloudflare Queue with a dead letter queue (no hybrid path), flush and rebuild tools, monitoring and email alerts to a dedicated address. Prod starts empty (test data only); the owner confirms right before old data is dropped. Load test deferred. Details: `docs/design/gig-centric.md`; concepts: `docs/learn/scale.md`.

## 2026-09-28: Money on gig-centric gigs (R1 step 3)

Small choices made while building step 3, within the approved design: the gig's full money comes back with every gig response (one call for the gig screen), filtered by role and the gig's three visibility settings. Money writes (payments, payouts, expenses) don't bump the gig's `version`, so recording a payment never makes someone else's edit fail; lineup changes do. Someone who has been paid can't be removed from a gig until their payouts are reversed (money is never orphaned). When a gig hides the lineup from players, they see only themselves and the managers in its people list too. Each person's summary gains one row per gig (`my_gigs`: my share and paid; the gig's fee, received, expenses and shares only for managers) for Home and reports in step 4.

## 2026-09-28: Tags, autofill, pending people, duplicates (R1 step 5)

Choices within the approved design: the tag registry in D1 is shared by everyone, one tag per kind and normalised name (lowercase, single spaces), so grouping works across managers; tags can't be renamed yet (a rename would have to touch every gig's snapshot; add it with a background job if it's ever needed). Up to 10 custom tags per gig. Autofill and duplicate warnings use two new rows in each person's summaries: whether they could see the gig's lineup, and the account ids of the people they could see on it. People added by an email with no account go into D1 `pending_people`; a new module hook `userCreated` attaches them on sign-up, and loading Home retries anything left (sign-up never fails because of it). Duplicate warnings show only the other manager's name, the date and the venue, never the gig's title or client.

## 2026-09-28: Smooth app: cache on the device, then live updates

Owner's request ("I want a smooth app experience… something like Firebase"). Step one: reads use a stale-while-revalidate cache (`apps/web/src/core/query.svelte.ts`): a screen shows its last known data at once, from memory or from `localStorage` (per signed-in user, at most 60 entries), and refreshes in the background; writes put their result straight in. The signed-in user is kept on the device too, so the app opens without waiting for the server (a 401 on the background check signs out). Pull to refresh at the top of a page, and returning to the app, refresh what's on screen. Sign-out clears everything saved. Trade-off: the last-seen gigs and amounts stay on the phone until sign-out (it's the owner's own device; nothing else is stored). Step two, next: live updates over WebSockets from the person and gig Durable Objects (hibernating connections), which refresh the affected screens within about a second. Full offline editing stays later (stage mode).

## 2026-09-28: Gig page tabs, refunds on cancellation

Owner's feedback after using the app. The gig page gets three tabs (Details, Money, People) instead of one long page; each money list lives inside its own card (client payments; shares and payouts with "payments made"; expenses and net). Cancelling can refund part or all of an advance in the same step (`refund`/`refund_paise` on `set_gig_status`); refunds are payments of kind `refund` (negative, not reversible, unlike a correction). A cancelled gig's income is what was kept (paid minus refunded): its money view shows `kept`, and its net, summaries and reports use that. Reports include cancelled gigs when money moved. The lineup sheet can add people to the gig directly (email or name), since only people on the gig can be on a lineup.

## 2026-09-28: Workspaces retired (R1 step 7)

Owner's OK ("yes i'm okay with deleting the data"). Removed the workspace code (core workspaces, the old gigs module operations and services, collective settings, invitations, members, the old web pages and switcher) and dropped the old D1 tables in migration `0004_retire_workspaces` (children first, `defer_foreign_keys`). Better Auth's organization plugin is off; `session.activeOrganizationId` stays as an unused column (dropping a column means rebuilding the table, not worth the risk). The operation registry is now user-only: every write passes its Idempotency-Key to the object that owns the data, so the D1 `idempotency_keys`, `audit_log` and `confirm_tokens` tables went too; `api_tokens` and confirm tokens come back with T09/T10 designed for gigs. AGENTS.md rules 1–3, 8, 11, 12 and a new rule 16 describe the gig-centric model. The load test is dropped from the plan (owner, 2026-09-28).

## 2026-09-28: Alerts by Telegram, checked by the Worker's own timer

Owner: no alert email ("I don't want to get them on my email"); Telegram is fine ("if it crowds me with alerts I'm changing it"). A Worker cron (`*/15 * * * *`, one per Worker, within the free plan's limit) runs health checks: modules contribute them (`admin.checks`; gigs: updates stuck over 5 minutes, deliveries that failed every retry), core adds errors (over 2% of at least 20 calls in 15 minutes) and slowness (slowest 5% over 1.5 s) when the analytics token exists. State per check lives in D1 `alert_state`, written only on change; a failing check sends one message, a fixed one sends "fixed", one still failing is repeated at most once a day. Only production sends (switch in the admin panel). The bot token is a secret; the chat id is found from the owner's first message to the bot (`getUpdates`) and kept in `app_settings`. Dead-lettered summaries are consumed from the DLQ into D1 `dead_letters` for the alert and the admin retry tool. There's no external "app down" check yet (the Worker can't see itself down); Cloudflare's status page covers the platform.

## Open

None.
