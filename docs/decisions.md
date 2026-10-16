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

## 2026-09-28: Backups to the owner's Google Drive

Owner: "Can we do google drive? I have 5tb in it" (instead of R2, which needs a card on file). The Worker itself makes the backup (nightly on its 15-minute timer, about 02:30 IST) and uploads it; nothing goes through GitHub. One gzip JSON file per night into "Assistant backups (<environment>)": D1 tables in use (sign-in secrets such as tokens and passwords blanked; sessions, verification, JWKS and OAuth tokens left out) plus each module's own data (gigs: every gig object's tables, found through the month registries). The newest 60 are kept. Access is the `drive.file` scope (only files the app made) through the existing Google sign-in client; the refresh token is encrypted with a key derived from BETTER_AUTH_SECRET and kept in `app_settings`. Restore (owners only, `?confirm=RESTORE`) inserts missing rows and restores gigs into empty objects only, never overwriting. A failed or overdue (26 h) backup raises the "Backup" alert. AGENTS.md's public-repo and stack lines now say Drive instead of R2.

## 2026-09-28: Address book in each person's own object

Design §2 lists an address book (clients, venues, people) used to fill in gigs. It lives in the person object (`contacts`, `contact_gigs`; person schema v7), not D1, so writes stay per person (rule 1). It fills itself from gigs the person **manages**: the gig's summary to its managers carries the client, venues and people, and the person object links them when it applies the summary (so it goes through the outbox → queue, rule 16; players' address books don't learn from gigs). Learning only fills blanks and never overwrites what the person typed; a contact the person removed isn't brought back by later gigs (adding it by hand does). Matching: people by account, then email, then name; clients and venues by name (case- and space-insensitive). Edits by the person are idempotent and audited inside the object. Gigs keep their own copy of details, so the address book never changes past gigs. Contacts are in the nightly backup (links are rebuilt from gigs). Gigs made before this learn on their next change, or at once with the admin tool "Rebuild summaries". Web: a "Contacts" tab and suggestions while typing a client, venue or person in the new-gig form (`core/ui/SuggestField`).

## 2026-09-28: Private calendar feed (T08)

One secret link per person (`/api/calendar/cal_<random>.ics`) that Apple and Google Calendar poll; Apple opens it with a webcal:// button. The link is looked up by SHA-256 hash in D1 `access_tokens` (the same table will hold the T09 API tokens) and also kept sealed, so the settings page can show it again (the owner wants few steps; a link that can't be shown again would mean re-adding it everywhere). Reset makes a new link and revokes the old; turning off revokes. Modules contribute events through a core hook (`calendar`); gigs reads the person's own object (events 90 days back onwards, cancelled ones kept and marked so calendars drop them, enquiries tentative). No money in the feed, since calendar services copy it. "Last used" is written at most once a day per link. Services get `ctx.sealer` (seal/unseal) instead of the secret itself. Reports (the rest of T08) already exist from R1 step 4.

## 2026-09-28: API tokens and Siri Shortcuts (T09)

Tokens (`ast_…`) live in D1 `access_tokens` next to calendar links: SHA-256 hash only (shown once; a retried create answers 409 rather than a second secret), up to 10 per person, scope read or read+write, revoked (never deleted), "last used" at most once a day. `requireCaller` accepts a session or a token, and only operation routes use it; operations marked `sessionOnly` (token and calendar management) and every non-operation route (admin, live updates) stay session-only, so a leaked token can't mint more tokens or reach admin. Token calls are audited as source `siri`. For Shortcuts, two thin reads: `get_brief` returns a sentence to speak (next gig, week, owed to me, to collect, to pay), built from Home and my gigs, and `pick` returns label → id dictionaries for "Choose from List". Every write shortcut shows an alert (Cancel) before calling. Recipes in `shortcuts/README.md`; nothing to install beyond the Shortcuts app.

## 2026-09-28: MCP server on the operation registry (T10)

`/mcp` replaces the T00 spike: stateless JSON-RPC over POST, tools generated from every operation that isn't `sessionOnly`, with JSON Schemas from the same Zod inputs (`z.toJSONSchema`, input side). OAuth is Better Auth's provider (as in the spike): JWT access tokens for the `/mcp` audience verified in-process. Two-step writes (rule 9) without server state: the preview's `confirm_token` is sealed (AES-GCM, key from BETTER_AUTH_SECRET) over {person, tool, hash of the exact arguments, expiry 10 min}; the confirming call must match, and its idempotency key is derived from the token so retries are harmless. Other writes use an optional `request_id` as the idempotency key. Data in results is fenced (`<data>` plus a note) and the server instructions say text from data is never instructions. Settings has an "AI assistants" card with the address and steps for Claude and ChatGPT. Connecting is the owner's step (their accounts).

## 2026-09-28: Notifications by Web Push, no email (T11)

The owner doesn't want email, so notifications are in-app ("New for you" on Home) and Web Push to devices the person turns on (Settings → Notifications; on iPhone, from the Home Screen app, iOS 16.4+). Core owns a per-person `InboxObject` (a new Durable Object class, wrangler migration v2) and `notify()`, which modules call; nothing in core knows about gigs. Gigs notifies from the person object when it applies a summary, by comparing old and new rows: added to a gig, confirmed, event time or venue changed (future events), cancelled, paid more. It skips changes the person made themselves (summaries now carry `changed_by`, the last audit actor). This runs in the queue consumer, never in the request, and is best effort. Push uses VAPID and encrypted payloads (RFC 8291) with WebCrypto only, no new dependency; the Worker makes its VAPID key pair on first use and keeps it sealed in `app_settings`, so the owner has nothing to set up. Endpoints are limited to known push services (the Worker sends requests there). The service worker (`/sw.js`) only shows notifications and opens the linked page; it caches nothing. Magic-link email sign-in (was in T11) is dropped with email.

## 2026-09-28: Review fixes (address book, calendar, Siri)

From Codex's reviews of #25–#27:

- **Address book:**
  - search uses an indexed word table (`contact_words`; every search word must be the start of a contact's word, phone numbers by digits) instead of `LIKE` scans (rule 12);
  - a renamed contact keeps its old name as an alias (`contact_aliases`), so gigs still using the old name link to it rather than recreating it;
  - contacts learned from gigs are audited with source `system`;
  - a picked person's phone goes into the gig.
- **Calendar:**
  - "turn off" stores its Idempotency-Key in `user_audit.request_key` (migration `0007`), so a late repeat can't revoke a newer link;
  - audits record the previous and new link ids;
  - the settings copy now says calendar apps keep old gigs and the old subscription should be removed (a revoked link returns 404; calendar apps don't delete what they have).
  - Kept: calendar links and tokens stay in D1 `access_tokens`, not the person object. Looking up a link needs a global index by hash, and the writes are rare (on/off/reset, and "last used" at most daily), so this isn't a per-action shared write.
- **Siri:**
  - the brief leaves out cancelled gigs in the query, so they don't use up the limit;
  - it counts gigs, not events;
  - pick lists distinct gigs from my gig rows.

## 2026-09-29: Handoff enforced by CI

Owner: "How do we make sure that you remember to keep the handoff updated without me reminding you?" Agents keep no memory between sessions, and the written rule alone slipped once (STATUS still said #27 was waiting after it merged). A separate workflow, `handoff.yml` (pull_request only, no secrets, read-only, pinned checkout; the PR description is passed as an env value, never inlined), fails a PR that changes `apps/`, `packages/`, `scripts/` or `shortcuts/` without changing `tasks/STATUS.md`. A line containing only `[skip-status]` in the description passes with a visible warning; mentions inside text, including the PR template's explanation, don't count (Codex review). It runs on description edits too, and it's a separate workflow so edits don't re-run the full test suite. A PR template holds the handoff checklist. It works for any agent (Claude, Codex, others) because it lives in GitHub, not in an agent. Limit: it proves STATUS changed, not that it's right.

## 2026-09-29: The app moves to gigspree.in

The owner bought `gigspree.in`. Prod is `https://gigspree.in` (`www.gigspree.in` moves to it), dev is `https://dev.gigspree.in`; `BASE_URL` follows, so sign-in, passkeys, OAuth for assistants, calendar and Drive links all use the domain. Worker **custom domains** (`routes` with `custom_domain` in `wrangler.jsonc`) create the DNS records and certificates on deploy, so the owner only adds the domain to Cloudflare (free plan, nameservers at the registrar) and adds the new Google redirect URIs. The old `*.workers.dev` addresses stay on (`workers_dev: true`) so existing calendar subscriptions and shortcuts keep working; pages there, and `www`, are sent to the domain by the web app (`apps/web/src/core/domain.ts`), since page requests are served as static files without the Worker. Everyone signs in again once and re-adds passkeys (they're bound to a domain). The deploy smoke test waits up to ~6 minutes for a new certificate. The app keeps its name "Assistant" until the owner decides otherwise.

On hold (same day): the owner asked to keep shipping to the workers.dev addresses until gigspree.in is fully set up, so the code and config part of the move (`wrangler.jsonc` routes and `BASE_URL`, `deploy.yml` `APP_URL`, `apps/web/src/core/domain.ts`, the Shortcuts URLs) was taken back out; restore it from commit `152b922` when the owner has done the DNS cleanup and Google redirect URIs (docs/setup.md → Domain gigspree.in). Cloudflare reports the zone active (2026-09-29).

## 2026-09-29: Calendar view for gigs

Owner: a calendar view as a UI perk, with the list staying the default. The Gigs page has a List / Calendar switch; the choice is kept in the browser (`localStorage`, per device), because it's a display preference, not data. The calendar is a month grid in India time with weeks starting on Sunday (owner: "make it like iPhone calendar"). It uses the existing `GET /api/me/gigs` with `from`/`to` for the month (pages of 100 until done), so no backend change. As on the iPhone: red month name and today, a day is always picked (today, or the 1st of another month) with its gigs listed below, a grey dot on days with gigs; wide screens look like the iPad month view (gig titles with status-coloured dots). "Add a gig on <day>" for future days; swipe sideways to change month. The picked day is kept while moving around the app, not across a reload.

## 2026-09-29: Lists and notes on gigs

Owner: "add collaborative features like we discussed before. Like live notes and reorderable setlist. Maybe don't call it a setlist and call it a list so it's more generic." Built from the design doc §11, in each gig's own object (migration 6: `lists`, `list_items`, `notes`; soft delete; indexed by list and position, and by time).

- **Lists**, not setlists: any ordered list, for the whole gig or one event, optionally with tick boxes (who ticked is shown). Reorder by dragging the handle (pointer events, so touch and mouse), arrow keys on the handle, or Up/Down in the item sheet. Positions are numbers with room between them, so a move writes one row; a list is renumbered only when a gap runs out. A new list can start from pasted lines ("Song - G - 4 min" splits into text and detail).
- **Notes** are posts, not one shared document: each has an author, so two people typing at once never overwrite each other (a shared document would need merge logic). Authors edit their own; authors and managers remove.
- **Who:** everyone on the gig sees both. Players may change them unless a manager turns off the new setting `players_edit_lists` (default on, as the design table said). Author names show on notes and ticks even to players who can't see the lineup: they're working together on the gig.
- **Live:** no new machinery. Each write goes through the gig's outbox like any change, so everyone's open screen refreshes within seconds. Because refreshes are now frequent, sheets fill their fields once per opening (`untrack`), so a refresh never wipes what someone is typing (this fixed the gig editor, event and payment sheets too).
- **API field** `shared_notes` (the gig already had a `notes` text field). The writes don't bump the gig's `version`, so list edits never block gig edits.
- **Assistants:** the ten operations are MCP tools like everything else; removals need confirmation. Only session-only operations stay off MCP (tokens, calendar link, push devices), plus the admin panel.
- Not yet: offline on stage (the PWA keeping lists of upcoming gigs), linking items to a future song library.

## 2026-09-29: Guest lists, shared with the venue

Owner: "for each gig we can have a guest list and every person can add their guests. We can assign a total limit or a per person limit … create a shareable link … and share it with the venue. If you think other features would be good to have please feel free to add."

- **Who:** everyone on the gig adds their own guests (name, plus-ones, note); players see only their own guests and the totals; managers see everyone's (grouped by whose guest), add for anyone, and set limits. Heads = guest + plus-ones.
- **Limits:** total and per person, in heads; checked in the gig's object, so they hold when two people add at once. Managers are bound by them too (they can raise them).
- **Closing:** an optional closing time (one tap: "when the gig starts"); after it, and once the gig is played or cancelled, only managers can change the list.
- **Venue link:** a secret link opened without signing in (`/guests/gl_<gig id>_<secret>`). The token carries the gig id, so the gig's own object checks it (hash only, plus the token sealed so managers can copy it again); no D1 lookup. The venue sees names, plus-ones, notes and whose guest; no money, phones or other gig details; `noindex`, no referrer. Door check-in (tick arrivals) is on by default and can be switched off; a new link makes the old one stop working. The page searches, filters "not arrived yet", refreshes itself every 20 s, and prints cleanly (tick boxes on paper).
- **Shorthand** (owner, same day): "Name +2" typed or pasted sets plus-ones; pasting several lines adds them all.
- **Extras added:** copy the list as text (WhatsApp/email), arrived counts for managers, print view.
- **Assistants:** can add, change and remove guests and set limits (removal needs confirmation); making, resetting or turning off the venue link is app-only, like other secret links (calendar, tokens).
- **Core:** a new generic "shared link" hook for modules (`sharedLinks` with a token prefix; core routes `GET /api/shared/:token`, `POST /api/shared/:token/:action` with an Idempotency-Key). Audit source `link` for changes made through one.
- Also: gig screens fill in newer parts (lists, notes, guest list) when showing a copy saved before an update, so an old cached gig can't crash a tab.

## 2026-09-29: Together page, and gig types in Settings

Owner: "the ui is a little chaotic. Can we separate the collaborative features from the gig details?" and "The gig type just make them public or private. The user can add/edit gig types in their settings."

- **Together page:** the gig page is back to Details/Events · Money · People. A "Together" card above the tabs has one row each for Guest list, Lists and Notes, with where things stand ("4 of 6 · venue link on", list names, "3 notes · latest from Anita, 2 h ago"). Each opens `/gigs/:id/guests|lists|notes`, a page of its own with a switch between the three and a back link to the gig. Same gig data and cache as the gig page.
- **Gig types:** read as "the default types are Public and Private; each person edits their own list". Stored in the person's own object (migration 9: `gig_types`, and a `_meta` marker so an emptied list stays empty). Settings → Gig types: add, rename, move up, remove, reset to Public and Private; each change saves at once. The gig editor offers my types, plus the gig's own type if it's no longer on my list. Gigs keep the type's name, so editing the list never changes gigs. Operations `get_gig_types`, `set_gig_types` (REST and AI tools). The old fixed list (Wedding, Sangeet, …) is gone; gigs that have those keep them.
- Settings takes module sections through a snippet from `App.svelte`, so core Settings still imports no module code.

## 2026-09-29: Offline first, like Firebase (docs/design/offline.md)

Owner: "Let's do what we already can. Like the offline sync … to make it like firebase." (On-device AI and transcription: later.) PWA, no new dependencies, server stays the source of truth. Two stages, shipped separately.

- **Stage 1 (reading offline):** the service worker now also keeps the app's own files on the device. It's built by a small Vite plugin that lists the build's files and names the cache by their hash. Pages come from the network if it answers within 3.5 s, else from the saved copy; hashed files come from the saved copy; API calls are never touched. The read cache (localStorage, per user) grows to 200 entries and halves itself if the device says it's full. Saved ahead in the background when online (sign-in, opening the app, reconnecting; at most every 10 minutes):
  - Home, the upcoming list, this and next month's calendar, the address book, my gig types;
  - every gig from 2 days ago to 60 days ahead (up to 40), with their guests, lists and notes.
    Screens with nothing saved say "Not saved on this device yet" instead of loading forever; an "Offline" bar shows while disconnected; live updates stop retrying offline and reconnect when back.
- localStorage over IndexedDB for now: it's synchronous, so screens still open instantly with no extra loading step, and ~40 gigs fit easily. Revisit if the data outgrows it.
- **Stage 2 (changing offline):** notes, lists and items (tick, move, add, remove), guests and arrivals, and recording payments, payouts and expenses work offline.
  - **Outbox:** each goes through a per-user outbox kept on the device (`core/outbox.svelte.ts`), sent in order with its own Idempotency-Key, so a resend can't apply twice.
  - **Shown at once, Firebase style:** screens show the server's copy with the waiting changes laid over it (appliers in `modules/gigs/offline-changes.ts`). The server's answer replaces the copy; a refused change drops off the screen.
  - **Ids made on the phone:** new notes, lists, items and guests get their ULID on the device. The server accepts an optional `id`, and a taken id returns 409. So something added offline can be changed again before it syncs.
  - **Money** isn't laid over the totals: the Money tab lists "Waiting to sync" entries, and totals change only when the server confirms.
  - **Online:** a change waits up to 10 s for the server. A refusal then shows as a toast, as before; a refusal after reconnecting goes to "Couldn't sync" with the reason and a Dismiss.
  - **Markers:** "waiting to sync" marks and the Syncing bar appear only offline or after 1.5 s (no flicker).
  - **Sign-out:** asks first if changes haven't synced.
  - **Save ahead again** 5 s after a live update or a sync, so new gigs are saved too.
  - **Still online-only** (they depend on the gig's version or server rules): gig details, events, lineup, people, status, reversals, removing expenses, guest limits and the venue link, making gigs.

## Open

None.

## 2026-09-29: Offline first is a standing rule, checked by a test

Owner: "Close the gap" (another agent must know the app is offline first). Added rule 17 to `AGENTS.md`: at-gig changes go through the outbox with an applier; every other write is marked `online-only` with a reason. `apps/web/test/offline-rule.test.ts` checks it, so the web app gets `vitest` (already in the catalog, no new package) and a `test` script. A guide for adding writes is in `docs/design/offline.md`.

## 2026-09-29: iPhone app with Capacitor, delivered through TestFlight

Owner bought the Apple Developer Program ("You start") after comparing Capacitor, React Native + Expo and SwiftUI in chat. Chosen: **Capacitor** (the web app in a native shell, native Swift for Siri, widgets, push, speech and on-device AI), because it reuses every screen, keeps one UI to maintain, and nothing Apple offers is out of reach. Details: `docs/design/ios-app.md`.

- New dependencies: `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` (8.5.2, in the catalog), and `@types/node`/`typescript` for type-checking the new `apps/ios` package. No new server dependencies.
- The app **shows the live site** (`server.url`) rather than bundled files: same origin, so cookies, passkeys, WebSockets and the service worker (with `WKAppBoundDomains`) work unchanged, and screen changes need no new build.
- **Sign-in in the app is by passkey** (Google blocks its sign-in in app web views). The Worker serves `/.well-known/apple-app-site-association` when `APPLE_TEAM_ID` is set. Google inside the app waits for the owner's OK (security change).
- **Delivery:** GitHub's Mac runners (free, public repo). PRs get simulator screenshots with fake data; `main` archives, signs with the App Store Connect API key and uploads to TestFlight, internal testing only.

## 2026-09-30: The app is called Gigspree

Owner: "let's call it gig spree from now onwards." Everything people see says **Gigspree** (one word, like the domain `gigspree.in`): web app title and Home Screen name, the iPhone app, the sign-in and connect pages, passkey name, MCP server title and instructions, calendar feed name, alerts and notifications, the venue guest page. New "G" icon (web and iPhone). Unchanged on purpose: the repo, packages, Worker names and bundle ID (`in.gigspree.assistant`, can't change), and the Google Drive backup folder name ("Assistant backups"), so nightly backups and their clean-up stay in one folder.

## 2026-09-30: The Gigspree logo

Owner's hand-drawn "gs" (script g and s), in the "leaning, tight" layout they picked (g tilted 12° right, s tilted 16° left, smaller and tucked in), in the app's colours: indigo g and amber s. Where it goes:

- **Transparent** (in the app and the browser tab): `public/logo-light.png` (indigo #4f46e5 g, amber #f59e0b s) and `public/logo-dark.png` (light indigo #a5b4fc, amber #fbbf24), picked by the `--logo` theme token; `icon.svg` holds both and switches with the colour scheme.
- **Solid** (Home Screen and iPhone app icons, which can't be transparent): the indigo gradient with a white g and amber s (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, iOS `AppIcon-512@2x.png`), plus an iOS dark-mode icon (`AppIcon-dark.png`, transparent).
  The manifest now lists only the solid PNGs. The service worker's version also hashes the public files, so new icons reach phones that saved the old ones.

## 2026-09-30: Music module: my songs, chord charts, stage mode, setlists

Owner: "Do these" (the music library after the two quick fixes). New module `music` (`docs/design/music.md`), no new dependencies.

- **Songs are personal for now**: one `LibraryObject` per person (`library:<user id>`), so no shared write place and nothing to authorise per gig. Band songbooks come later.
- **Charts are ChordPro text**, parsed and transposed in `packages/shared` (pure functions, tested); pasted "chords above the lyrics" converts with one tap. Transpose is a per-device view setting, not stored on the server.
- **Setlists are gig lists**: list items get an optional `song_id` (booking object migration 8), so setlists keep the lists' ordering, live updates and offline changes. The gigs module stores only the id; it never reads the music module.
- **Navigation**: Songs becomes a main tab; on phones Settings moves to the avatar so the tab bar keeps five places.
- **Offline**: the whole library is saved ahead for reading; song writes are online-only for now.

## 2026-09-30: A calmer gig page

Owner found the gig page cluttered. The page now leads with one summary card (when, where, client, money, one next step), shows Guests/Lists/Notes as tiles, folds each event's lineup to one line, and moves rare or destructive actions (cancel, delete, status changes, removing an event) into a More menu or the event editor. New shared piece: `ActionSheet` (core/ui) for "More" menus on any page.

## 2026-09-30: Cancelled gigs can be reopened

Owner: "we should be able to uncancel". `reopen` returns a cancelled gig to its earlier status (stored on the gig as `cancelled_from`). A refund recorded on cancelling is kept, since refunds are money that moved and can't be reversed; the manager records a new payment if needed. Audited like every status change.

## 2026-10-01: gigspree.in goes live

The owner finished the domain set-up (DNS clean, deploy token can manage `gigspree.in`, Google origins and redirect URIs). The move from 2026-09-29 is restored as decided then, and the iPhone app's server is now `https://gigspree.in` (dev builds `https://dev.gigspree.in`).

## 2026-10-02: Rehearsals belong to their gig; a rehearsal of its own is optional

Owner: rehearsals are almost always for a gig, so a rehearsal is an event of the gig (`kind` show/rehearsal) and reaches everyone on it through the existing summaries (Home, lists, calendar feed, notifications, offline). A rehearsal not for any gig is a gig of kind `rehearsal` (no client or fee). People answer Going / Can't per rehearsal (stored in the gig's object, no version bump). Rehearsals have no lineup or shares, don't move a gig's date in reports and aren't in duplicate warnings. Chosen over a separate rehearsal object linked to a gig, which would need cross-object writes to show on the gig. Details: docs/design/rehearsals.md.

## 2026-10-02: The gig page shows only what a gig has; one Add button adds the rest

Owner: empty sections (no notes, no guests) were still on screen. Sections and tiles now appear only once they have something; a single Add (+) button in the gig's header lists everything that can be added (filtered by role and gig kind). Empty states stay on the pages behind the tiles (Guests, Lists, Notes), where they explain what each is for.

## 2026-10-03: Gig history in plain words, for managers

Owner wants "who changed what". Every write is already in the gig's own audit log (rule 11), so no new storage: the gig object turns its log into sentences with before → after (`modules/gigs/history.ts`), using the names of people, events, lists and guests even after they're removed. Managers only, because it includes money; `get_gig_history` pages with `before`. A history for players without money, and for per-person data (address book, songs), can come later.

## 2026-10-03: Date options (holds) on enquiries

Owner: clients ask to soft-block two or three dates. A date option is a show flagged `hold` on an enquiry; everyone on the gig sees it as a hold (Home, list, calendar, feed), and confirming asks which date(s) the client picked, keeping those and releasing the rest. No lineup on holds, so options never add up as money. Chosen over a separate "hold" object: holds are the gig's own possible dates and need nothing new beyond a flag. Details: docs/design/holds.md.

## 2026-10-03: Guests arrive in parts (arrival count per guest)

Owner: a "Rahul +2" group doesn't always arrive together. Each guest keeps how many of the group are in (`arrived_count`, 0 to 1 + plus-ones) instead of a yes/no; `arrived` stays as "the whole group is in" for older clients and the door link. Groups get a − / + counter at the gig and on the venue's door page; singles keep the tick. Arrival time stays the first arrival.

## 2026-10-03: Breaks in lists, not setlists

The owner asked for breaks in setlists (10 or 15 minutes, sometimes two), and for it to stay generic because lists aren't only setlists. A list item now has a kind: `item` or `break`. A break is a divider with a name ("Break" by default; "Interval", "Set 2", "Cables" all work) and an optional length in minutes. Breaks are never numbered or ticked, and the list's count says "12 items · 2 breaks". Stage mode shows a break between the songs it sits between. Reason: one divider covers intervals in a setlist, pauses in a run of show and headings in a packing list, so no list type is needed. Booking migration 13 (`list_items.kind`, `minutes`). Works offline like other item changes.

## 2026-10-03: Page tabs are tabs, not a pill switch

The owner found it hard to tell which tab the content below belonged to. The pill switch (`Segmented`) looks like a filter and scrolls away. Sections that own the content under them (a gig's Details · Money · People; Guest list · Lists · Notes) now use `Tabs`: an underline on the open tab, and a bar that stays pinned under the top bar while you scroll. `Segmented` stays for choices and filters inside a page. Reason: it matches the iOS and Android tab patterns people already know, and the open tab is always on screen.

## 2026-10-09: Gigspree becomes a universal, chat-centric assistant

Approved design: `docs/design/universal.md`. The owner wants one assistant for everything (gigs, expenses, reminders, family notes), with workflows built by chat, not coded. The app becomes building blocks: spaces, collections with typed fields, links, formulas and rollups, checks, status flows, automations, permissions and per-row visibility, views, a screen builder from components, and sharing (cards, views, forms, join links). Full users (the owner first) get spaces and the assistant; collaborators get only what's shared with them, free and without AI. Deep features are built-in apps in code (Songbook first, from the music module). Gigs becomes a template built from the blocks; the gig code is replaced in place (nobody uses the app yet, so no data moves). Supersedes the 2026-09-28 "collective is a tag, no workspaces" decision for new code, and the rule against an in-app assistant.

Storage: a Durable Object per space (SQLite: values by field id plus a typed index table; links both ways; change log), per chat and per person; Vectorize for search by meaning. Chosen over a wide-column store (Cassandra) because rules need transactions across a record, its links and totals, and reports need ad-hoc queries.

AI: Cloudflare only, on the **Free plan** (it can never bill); paid AI only from prepaid AI Gateway credit with spend limits and auto top-up off; owner's cap ₹2,000 a month. A model router in our code with three levels: everyday GLM 4.7 Flash (free allowance), setups Kimi K2.6, backup Claude Sonnet 5.5; on supported iPhones, Apple's on-device model first. No pattern-based parsing of messages (owner); the line between everyday and setup is the tools each level has, plus a handover tool. A model test (fam jam sign-ups, the gig guest list, everyday Hinglish) picks the models. English and Hinglish. Connectors (MCP-based, read-only by default). iPhone widgets, App Intents and on-device AI after core and sharing. Offline-first for every collection.

## 2026-10-10: The assistant's router, as built (P2-1c, first part)

Following design §10. Choices made while building it:

- **The router runs in the Worker request**, not inside the chat object: it needs the operation registry (the assistant's tools are the same operations as REST and MCP) and the person's context. The chat object (`ChatObject`, one per person, `chat:<user id>`) only keeps messages, confirm cards and the "setup in progress" flag; the budget object (`BudgetObject`, `budget:global`) keeps the cap. Both are new SQLite Durable Object classes (wrangler migration `v5`).
- **Levels by tools, not by reading messages:** level 1 gets only everyday tools plus `hand_over`; setups need level 2 (`create_collection`, `add_field`, views…, plus `hand_back`). Two failed tool checks move up a level. Without prepaid credit level 2 is off and the assistant says how to do it by tapping.
- **Confirm cards** for anything with `confirm` or `confirmWhen` (money, deletes) and every setup tool; a card runs exactly the arguments it showed, once (its own idempotency key), within 30 minutes.
- **Billing routes:** free = the auto-created `default` gateway (Standard billing); paid = `AI_PAID_GATEWAY` (Unified billing), empty until the owner loads credit (docs/setup.md). The cap (`AI_MONTHLY_CAP_INR`, ₹2,000) and per-person limit are enforced by reserving each paid call's maximum cost first, refusing past cap − 10%; stale reservations count as spent. Free-route neurons are counted per day.
- **Level 3 (Claude Sonnet 5.5) stays off for now:** it will be called through AI Gateway with the official Anthropic SDK once credit exists; adding that dependency gets its own decision then.
- **Tests and local dev never call Workers AI:** `remoteBindings: false` in the test pool and the Vite plugin, and a scripted test model (`fake-model.ts`, `AI_FAKE=1`) that answers fixed test sentences. The app itself never reads messages with patterns (owner's rule).
- **Not yet:** streaming replies (answers arrive whole, with a typing indicator), the model test against real models (needs the paid route for levels 2–3; the free level can be tried on dev), Hinglish and handover quality measurement.

## 2026-10-10: Revoke CI's own development certificates before each TestFlight build

Each GitHub Mac runner is fresh, so automatic signing makes a new Apple Development certificate every build, and Apple stops at its limit (uploads failed until the owner revoked 10). Chosen fix: with the App Store Connect key the job already has (`scripts/apple-dev-certs.mjs`), note the Development certificates before archiving and, after the upload, revoke only certificates that are new and named "Created via API", so each build removes the one it made and nothing another tool made earlier (updated 2026-10-10 after a Codex review). No new secrets, Distribution certificates and anyone's Xcode certificates are untouched, and a failure only skips the cleanup. Rejected: storing a signing certificate as a secret (more secrets and owner steps); archiving unsigned (would lose the passkey entitlement).

## 2026-10-10: Sharing cards (stage 2a), as built

Following design §11. Choices made while building it:

- **The share lives in the space's object** (migration index 3: `shares`, `share_people`), which checks every open and edit; anything not shared is 404. The join link carries its space id (`shr_<space id>_<secret>`), so a join goes straight to that object; only the link's hash is stored, so the link is shown once and "New link" replaces it (people who joined stay). D1 gets one small table, `shared_with` (person → share → space, written on join and leave), for the "Shared with me" list.
- **Why D1 for `shared_with`:** it is the same kind of index as `space_members` (who is in what), which AGENTS rule 1 keeps in D1 with the space list and share hashes. It is written only on join, leave and removal, never per action, so it isn't a per-action hot spot; reads are one indexed lookup per person.
- **A repeated create or reset gives the same link:** with an idempotency key, the link's secret is derived from the key and the person (HMAC with a key from `BETTER_AUTH_SECRET`), so a retry hashes to what the space stored, and nothing is reset. Without a key it's random.
- **Money stays private:** money fields start hidden, also in each linked part the owner includes; MCP asks to confirm collaborators' writes that touch money. Cards no longer shared leave the device on the next save-ahead, and a card the server says isn't shared is dropped from the device.
- **The token is after `#`** in the link (`/join#…`), so it never reaches server logs; sign-in keeps the `#` through the redirect.
- **What collaborators see:** the card's fields minus hidden ones, and sections for the parts included (a link field of the record, or a collection linking to it). Link fields themselves are never shown (they would name records outside the share). Money fields start hidden in the share sheet.
- **Edit access** changes shared fields and adds records to sections that link to the card (a guest, a song); never link fields or hidden fields.
- **Making or resetting a link is app-only** (not MCP or the in-app assistant): a link is a key to the owner's data. Revoking and removing people are MCP tools with confirmation.
- **Online only for now:** collaborators' edits go straight to the owner's space (marked `online-only`); shared cards are saved ahead so they open offline. Comments, views and forms, row rules and personal answers come in 2b/2c.

## 2026-10-10: Sharing views and forms, and link-only access (stage 2b)

- A share is now a card, a **view** (a saved view's records, live; edits only reach records the view shows) or a **form** (people add records to a collection and see only the ones they made). Same table, same hash-only link, same checks in the space's object (migration 4: `kind`, `target_id`, `public`).
- **Link-only** (`public`) is for views and forms only, never cards: views are read-only that way, forms take answers. Link-only pages live at `/s#…` and send the token in the request body. Each link-only form takes at most 500 answers a day (`share_counts`), so a leaked link can't flood a space; turning the share off stops it at once.
- Answers through a link-only form have no person attached (the audit says "web" with no user); signed-in form answers are by that person and they can see (and, with edit access, fix) only their own.

## 2026-10-10: Personal answers are their own table

Design §11 "personal answers: fields each person fills in for themselves on shared rows, private to them and the owner". A field marked `personal` keeps no value on the record; each person's answer is a row in `answers (record_id, field_id, user_id)` in the space's object. Reason: one record, many answers (the fam jam's "Going?"), and the record's own values, index and change log stay as they are. Each person sees their own answer as the field's value; the space's people also see everyone's; collaborators never see others'. Answering doesn't need edit access (it changes nothing shared). Not yet: filtering, sorting and totals on answers (they come with formulas and rollups, stage 5); switching an existing field to or from personal once it has values (make a new field).

## 2026-10-10: Motion

The owner found the app bland. Motion lives in the shared UI pieces and theme tokens, not per screen: tokens `--ease`, `--ease-spring`, `--dur-fast`/`--dur`/`--dur-slow`, `--stagger` and global keyframes `rise-in`, `fade-in`, `pop-in` in `theme.css`; Svelte's own `svelte/transition` and `svelte/animate` for things that leave (toasts) or arrive in a live list (chat). No animation library. Rules: short (≤ 0.45 s), entrances only (nothing blocks a tap), `backwards` fill so nothing keeps a transform afterwards, never a transform on a page wrapper (it would move position: fixed bars), and `prefers-reduced-motion` turns it all off.

## 2026-10-10: Chat first

The owner found the app still felt like the old gig app. Approved (after a clickable mockup): the chat is the whole app, with live cards, memory, workflows shown as a diagram and in plain words (drawn from the saved definition so the text can't drift from what runs), setup proposals as cards, people pulled in through cards, and group chats. Design: `docs/design/chat-first.md`; it replaces the chat's layout and screens in universal.md §10 (the rest of §10, router, tools, confirmation and budgets, still holds) and §14 (build order). Everything keeps a path that works without the assistant (lists in the menu, + in the message box, records as full-screen cards). Also decided: the old screens are removed at once in step 1, not kept behind links ("I want to see the app as is from scratch"); collaborators have no assistant unless the owner switches it on per person; in group chats only people with assistant access can ask it, and the owner's own questions come from the owner's allowance. The look follows the mockup: a colour per kind of card instead of the single indigo.

## 2026-10-10: Several chats and memory live with the person's main chat

Each chat is its own chat object (`chat:<user>:<chat id>`, rule 1: an object per chat). The person's first chat (`main`, `chat:<user>`) also keeps the list of their chats and what the assistant remembers, so a send reads one extra object, never a shared one. Memory is facts and preferences the person asked to keep (or corrections they made); the model decides when to call `remember`, nothing parses messages for it. Remembered text goes into the instructions marked as the person's data, never as instructions. Up to 200 chats and 200 memories per person. A chat names itself from its first message and tells the list through its outbox (an alarm updates the main chat; a failure there can't affect the send). Deleting a chat is soft (it leaves the list; its messages stay); deleting a chat, remembering and forgetting are idempotent by key and audited; `forget_memory` needs confirmation from outside assistants (rule 9).

## 2026-10-10: Live updates for everything, one live object per person

The owner wants collaborated and pinned cards to update the moment someone changes them. `/api/live` now goes to a core **LiveObject** per person (`live:<user>`, Durable Object, wrangler migration v6) instead of the gigs module's person object. A space's every write (the one `write()` helper) leaves its outbox note in the same transaction; an alarm ~0.5 s later pings the live object of every member and everyone in one of its shares, then clears the note (retries with back-off if a ping fails). Pings carry no data (`{type: "space_changed", space_id, seq}`), so the app refetches what it's allowed to see; repeats are harmless. The gigs person object pings the same live object for `gig_changed`. No queue: a ping changes nothing in the receiver.

## 2026-10-10: People I know, and sharing with them without a link

To bring people in from the chat, the owner needs to name them. "People I know" are everyone in one of my spaces or in something I shared (each space object lists its own; the service merges them across my spaces, so no shared list is written). Sharing with them makes a normal share whose link nobody holds and adds them to it directly (the same `share_people` rows and D1 `shared_with` index a join makes), so everything else (what they see, live pings, leaving, removing) works unchanged. Names resolve exactly or by a unique first name; anything else returns candidates or the list of people I know, never a guess. Strangers still join by a link from the app, which the assistant never hands out. Sharing from the chat hides money fields unless the owner says otherwise, and always asks for a tap (MCP: confirm token).

## 2026-10-10: Questions are shares

"Ask Rahul and Priya if they're free" is a question card. A question lives in the asker's space (its own `questions` and `question_answers` tables) and reaches people through a share of a new kind, `question`, with the people asked added directly (they must be people the asker knows). Reusing shares means "Shared with you", leaving, removing, live pings and the 404-for-everyone-else check work unchanged; a question share reaches no records. Each person has one answer (one of the choices, matched without case, or a short text) and can change it until the asker closes the question. Only the asker sees everyone's answers. Asking needs a tap (it reaches other people); answering is online-only. The + menu can ask too, so this works without the assistant.

## 2026-10-10: Who may use the assistant

The owner decided collaborators have no assistant unless the owner switches it on per person (it costs the owner). Owners (`ADMIN_EMAILS`) and admins always have it; anyone else needs a row in D1 `assistant_access`, which owners and admins set for people they know (Settings). Until any owner or admin exists, everyone keeps it, so a missing secret can't lock the owner out. Only asking (send, confirm) is gated; lists, sharing, questions and outside assistants over MCP (the person's own AI, no cost to the owner) work for everyone.

## 2026-10-10: Workflows run in the space, after the write

Workflows (universal.md "Automation", chat-first step 5) are saved definitions in the space's own object, never code: when (a record added, a record or one field changed, a date near), check (the views' filter language), wait, then (tell people, set a field, add a record). A record write only queues a job, in the same transaction; the space's alarm (the same one that sends live pings) runs due jobs afterwards, re-checks the record, and does every step in one transaction, so a failing step changes nothing and is noted in the history. Steps that write records are ordinary writes and can start other workflows, but chains stop at three steps. Telling someone goes to their inbox object after the run is saved (best effort). What people read, the plain words and the diagram, is made from the saved definition. Anything an assistant makes is saved off until the person turns it on. Reminders work through a built-in workflow on the starter Reminders list (made once per personal space).

## 2026-10-10: Rules are checked inside the write

Checks, uniqueness and status flows (universal.md §2) are saved rules on a collection, never code, and the space object checks them in the same transaction as every record write (people, collaborators, forms, workflows alike), after values and links are saved, so a broken rule leaves nothing behind. Uniqueness answers 409 with the record that holds the place, so the app can offer to replace it (the pick board, step 6). A rule that existing records already break is refused when it's added, so a saved rule always holds. Status flows constrain changes only; new records may start at any value.

## 2026-10-15: Chat makes, screens can fix (owner: "we don't have a UI fallback, right? So if the user can't get the desired setup then what?")

Amends "Chat makes, screens use" (2026-10-11). The owner's reason for chat-first stands: no toolbox in the main screens, so people aren't overwhelmed. But when the assistant won't build what's asked, rephrasing can't be the only way out. Two side doors, neither on the home or a tab:

- **The setup card is editable before Confirm.** The assistant proposes; "Change…" on the card opens a form over its arguments (a list's name, each field's name, kind, choices, link, formula, required; add or drop a field); Confirm runs the changed version, checked exactly like the model's own arguments, and the card shows what ran. Only setup cards (`make_setup`, `create_collection`, `add_field`, `update_field`, `save_view`, `update_view`); money and deletes never take changed arguments.
- **A plain setup screen per list, hidden under its ⋯ menu** ("Fields and cards"): fields, rules, cards and views as ordinary forms, through the same operations the assistant uses. Someone who never opens the menu never sees it.

Not doing: a builder tab, a visible "Edit" on every screen, by-hand workflows (the chat shows them as diagrams and that stays the way).

## 2026-10-11: Chat makes, screens use

Owner's decision, replacing "Assistant first" (which kept by-hand builders as a fallback). Everything is made and changed in the chat: lists, fields, records, workflows, rules, setups, songs. Screens are for using what exists: opening, ticking done, picking, playing (stage mode, transpose), sharing, deleting. The by-hand builders are gone: the workflow form, starting a list by hand, Edit by hand (add a record, rules), record edit forms and "Add to …" on record pages, the chat's + menu, and Songbook's Add and Edit sheets. There are no add or edit screens by default; a person who wants one asks the chat to make it (a quick add is saved and pinned like a view; built next). Offline, what's typed in the chat waits and runs when the connection is back (built next). Collaborators still fill in forms someone shared with them; those are made in the chat too.
Reason: the owner wants a chat-first app, not a traditional app with a chat beside it.

## 2026-10-11: Apps offer their actions to the assistant themselves

An app's operation says whether the in-app assistant may use it (`assistant: {level, hint, card}`): from which level, one line for the assistant's instructions, and the card its result shows in the chat (a generic "app" card: title, a line of facts, Open to the app's own screen). Core never lists an app's tools or knows its cards. The web app's composition root (`App.svelte`) mounts app screens; core screens never import an app. Songbook is the first: its library, chart and stage-mode screens are back under Apps in the menu, saved ahead for offline and stage use.
Reason: universal.md §9 (the app contract) and rule 15; the chat shows songs as cards without core knowing what a song is.

## 2026-10-11: Through a share, a person field can only be you

A collaborator writing through a share (a form, an editable view or card) may set a person field only to themselves ("me"), to nobody, or to a name without an account; naming someone else's account is refused (403). Owners and members set anyone the space knows.
Reason: today's guest lists don't let a player add guests in another player's name, and the same holds for sign-ups and tasks; limits per person (at most 3 guests each) would mean nothing otherwise.

## 2026-10-11: Gigs is checked against the blocks, gaps fixed in the engine

Step 8 rebuilds the gig app as a setup and checks it with a test per behaviour (`gigs-setup.test.ts`). Where a behaviour can't be built, a generic block is added, never gig code: so far rollups that filter the linked records (count only the shows) and person fields that take a known person's account id. The old gig code stays until every behaviour the owner uses passes, and is removed only with the owner's OK.
Reason: universal.md §7; one engine for everything, and nothing the owner relies on is lost.

## 2026-10-10: Backups include every space, chat and group object

The nightly backup also holds each space, chat and group object as a dump of all its tables (except idempotency records, the outbox, the schema row and Cloudflare's internal tables), found through D1 (spaces, group members, users) and each person's main chat (their other chats). Restore only fills empty objects.
Reason: since Phase 2 the owner's data lives in these objects; a backup without them would restore nothing that matters.

## 2026-10-10: Group chats: one object per group, @assistant as the asker

Each group chat is its own Durable Object (rule 1: per chat) with its members and messages; D1 keeps only who is in which group, for the list. Writing @assistant (a fixed word, like a command) asks the assistant; only people with assistant access may send it. It runs as the asker, with their own data and from their allowance, in a chat of theirs for that group, and sees only the asker's own words: other members' messages and the group's name never reach a model that can read and change the asker's data (they could steer it). Its reply is posted to the group for everyone; if it fails, the group gets only "I couldn't answer that just now". Confirm cards and live cards stay in the asker's chat. People are added only from those the owner already knows (their shares).
Reason: the design's group chats (band, family) without giving anyone access to data or AI spend that isn't theirs.

## 2026-10-10: Assistant first

Owner's decision. Nobody starts with preset lists any more: the first time someone says "remind me…", "note that…" or "spent ₹450…", the everyday assistant starts that list on the spot (`start_list`: notes, reminders with their alarm, events or expenses; no confirm card, since the shapes are fixed and known) and shows it as a card; anything else is a setup card on the smart model. Chat is how lists, fields, rules and workflows are made and changed; cards still edit what's there. The by-hand builders (Add, Rules, the workflow form, starting a list) stay, behind small **Edit by hand** / **By hand** links, for offline and no-AI days. Existing people keep their lists.
Reason: the owner wants the app to build what's needed from the conversation instead of ready-made templates and forms, and the free model can start the everyday lists without a paid call.

## 2026-10-10: Collaborators link only to what they can see

Through a share, a collaborator may set a link field (a sign-up picks its song), but only to a record they can already see through one of their shares in the same space, by id; a form lists those records to pick from. A person field takes "me" for whoever writes, and keeps an account id only for someone in the space or its shares; workflows can tell "{Field}", the person in a person field, if the space knows them.
Reason: the fam jam needs sign-ups that point at songs and a "you're in" message to each person, without letting anyone reach records or people the space hasn't shared with them.

## 2026-10-10: A setup is one card and one write

Setups by chat (chat-first step 6) are proposed as one card (`make_setup`) listing every list, link, calculated field, rule and view in words made from the definition, and made in one space-object transaction on **Make it**: all of it or nothing. Links inside the setup may point at each other, so links are added after the plain fields and calculated fields after the links. The single-piece tools (`create_collection`, `add_field`, `add_rule`, …) stay for small changes.
Reason: a half-made setup (Songs made, Sign-ups failed on a bad rule) is worse than none, and one card is what the person can read and approve.

## 2026-10-10: Calculated fields are stored values

Formulas and rollups (universal.md §2) are number, money or date fields with a `formula` or `rollup` option, not new field types, so displaying, indexing, filtering, sorting and totals need nothing new. Their values are calculated inside the write that changes them (the record, then the records linked to or from it, one step out) and stored, so reads stay plain index lookups. The formula language is braces, numbers and + − * / with brackets, parsed and evaluated by our own small code (no eval). Formulas can't use other formulas, which keeps the order of calculation simple and rules out loops.

## 2026-10-11: Home first; cards from components and arrangements; React Native with Expo

Owner's decisions, made in chat with the design model after three mockups ("Gigspree Home Prototype", "Gigspree Modern Home", "Gigspree Concept Home"; the last is the one to build). Design: `docs/design/home-first.md`, which is the brief for the building agent.

- **Home first.** The app opens on swipeable pages of pinned cards; the chat is a bar and a pull-down, one gesture away, and knows which card it was opened from. Page 1 ("Now") is arranged by the assistant; the others by hand or by chat. Replaces chat-first.md's "opens on the chat".
- **A card is components + one named arrangement + a size.** The model picks from a fixed set; the app draws. Reason (owner chose this over free layout): every card looks like it belongs, a cheap model can compose cards because the answer is short and checkable, and layouts don't drift between models or themes. New arrangements are added by us when the log shows requests nothing fits.
- **Collaborators have a home** of what is shared with them and use the cards fully; the assistant is per person, off by default, on the owner's allowance (admin panel).
- **Processes:** workflows whose steps belong to roles and wait for a person's answer (nudge, loop back); the client can be a role by link without an account.
- **Hybrid search, one index per person:** FTS5 in the person's object plus Vectorize filtered by person, filled from the outbox with the person's visibility applied; the index is a disposable copy. D1 is not used for search. Replaces the app library page.
- **Inbox** (captured things with no list yet), **This week** (proposals, never actions), **What changed + Undo** after every chat write, **first run as a conversation about your week**, **visible memory**, **cards that offer to leave when done**.
- **Phone apps in React Native with Expo**, one codebase for iPhone, Android and the website; the Svelte web app is replaced once the Expo web target matches it; the Capacitor shell is retired when the Expo app reaches TestFlight; Swift parts (App Intents, widgets, Share extension, on-device model) carry over. Reason: the look and feel must be the phone's own (the owner found the web app "feels like an HTML app"), Android comes from the same code, and the screens are now a small set of blocks (cards, sheets, chat, stage mode), so a second UI codebase is no longer the cost it was on 2026-09-29. The Apple developer account is needed either way (TestFlight, passkeys, widgets, Siri).
- **Look:** cool neutrals, indigo accent, a colour per collection, Plus Jakarta Sans, 22 px cards, glass bars, spring motion; the owner rejected a serif/warm direction ("a little modern look", "both light and dark"). The logo (script gs) is the assistant's mark.
- **Name:** Gigspree stays for now (domain bought); it changes before the public listing. Bundle ID stays.
- New dependencies to come with the first Expo PR (Expo SDK, React Native, Reanimated, Gesture Handler, expo-router; recorded there with versions).

## 2026-10-11: The phone app is an Expo project in the workspace (`apps/mobile`)

First slice of home-first.md §7 step 1. New dependencies (mobile only unless noted): `expo` 57.0.27, `react-native` 0.86.3, `react` 19.2.3, `expo-router` 57.0.25, `react-native-reanimated` 4.5.1 with `react-native-worklets` 0.10.1, `react-native-gesture-handler` 2.32, `react-native-screens` 4.26, `react-native-safe-area-context` 5.7, `react-native-web` 0.21 and `react-dom` 19.2.3 (the web target), `expo-secure-store`, `expo-sqlite` (its key-value store holds the device copy and the outbox), `expo-haptics`, `expo-web-browser`, `expo-linking`, `expo-constants`, `expo-network`, `expo-splash-screen`, `expo-font`, `expo-system-ui`, `expo-status-bar`; `@better-auth/expo` 1.7.7 on both the app and the Worker (Better Auth bumped to 1.7.7 across the repo for it). Versions come from Expo's SDK 57 table (`bundledNativeModules.json`), not from `expo install`, which can't reach Expo's API from the agents' network.

- The app is a normal workspace package (`@assistant/mobile`): `pnpm typecheck` and `pnpm lint` cover it; CI also bundles its web target. No `node-linker` change: Metro is pointed at the repo root and symlinks instead.
- The bundle id stays `in.gigspree.assistant`, so TestFlight continues the same app when the Expo build replaces the Capacitor one.
- The server side of sign-in from the app (Better Auth's `expo()` plugin, `gigspree://` as a trusted origin) is a new way in and waits for the owner's explicit OK before it merges; Google inside the app stays off (`EXPO_PUBLIC_GOOGLE_IN_APP`) until the same OK.

**Added 2026-10-12:** `babel-preset-expo` (57.0.14) as the app's own dev dependency. Expo expects it declared in the app; with pnpm's strict layout the Xcode bundle phase could not resolve it from `babel.config.js` and the TestFlight/simulator build failed (`Cannot find module 'babel-preset-expo'`), while `expo export` from the command line happened to work.

## 2026-10-11: Owner's standing OKs (so the daily loop doesn't wait on him)

The owner isn't an active developer: he sends a message about once a day and looks at the app when he can; the agent builds, verifies and delivers. To keep that loop moving he gave these OKs in chat (2026-10-11):

- **Sign-in from the app**: Better Auth's `expo()` plugin, `gigspree://` as a trusted origin, and Google sign-in inside the app through the system sheet are approved (merged in #95; Google in the app may be switched on). Sign-in methods **for the owner himself** are approved in general; anything that opens data to **other people** (new share kinds, link-only writes, tokens for others) still waits for his explicit OK.
- **The venue door link** (a link-only view where the venue edits only Arrived, no sign-in) is approved.
- **Old gig data and code**: the owner never used the gig app for real work ("basic testing, very few records; I don't care if they move forward"). The old `gigs` and `music` module code and their objects' data may be deleted when the Expo app covers gigs from the blocks; no migration of that data is needed. The space data (lists, chats, groups) made since is kept.
- **Delivery**: a short "what's new, what to try" note reaches the owner after each merge (in the app or as a message); the agent keeps the simulator screenshots and a nightly prod check as part of HF2.
- Still the owner's call when reached: the Google Play developer account (Android), the new name before the public listing, and whether the repository goes private (see the note under "Private repository" when decided).

## 2026-10-12: CI signs the simulator app in through a localhost-only route

**Decision:** the simulator screenshots sign in by opening `gigspree://test?email=…&password=…&path=…` (`apps/mobile/app/test.tsx`), which uses the email/password sign-in that exists only on the local test server; the route checks that the app was built for `http://localhost` and otherwise only redirects home. The seed script prints the test person's email and password.

**Why:** the Capacitor shell took a `-testCookie` launch argument read in Swift; the Expo app has no Swift of its own yet, and a deep link is what the simulator can open without typing. Baking a cookie into the JS bundle would mean seeding before every build and one build per signed-in state. Nothing on a real server accepts the route, so it opens no new way in.

**Also:** the iOS pipeline builds `apps/mobile` with `expo prebuild` on the runner (the native project is generated, never committed); the Capacitor shell is no longer built and goes with the old gig code. A nightly `prod-check` workflow curls the real app so a dead deploy shows up before the owner opens the app.

## 2026-10-12: A card's size and order live on its saved view

**Decision:** the phone's home stores how big a pinned card is as `card_size` on the saved view (s / m / l; null means the app picks from the arrangement), inside the view's existing settings blob in the space object; the order is the view's `position`. Both change through the app's outbox like any record change, so they work offline and follow the person to every device.

**Why:** today every pinned view is a card (home-first.md §7 step 2); until cards are their own records, the view is the one place that already belongs to the owning object and is shared by the web app, the MCP tools and the phone. No new table, no migration, and the assistant can set a size too ("make the expenses card tall").

## 2026-10-12: A link alone never edits existing data (confirmed)

**Decision (owner, 2026-10-12, after seeing other products do the same):** anyone holding only a link can read a shared view or add through a form (append-only, recorded with who submitted when, limited); changing existing records needs a signed-in person who was shared with by name, with a role. The venue door link stays the one exception, and sets the shape of any future one: one field (Arrived), one list, one revocable link, rate-limited.

**Why:** a link holder is anonymous. A writable public link invites spam and vandalism with nobody to hold responsible, leaves no usable audit trail, and can't be revoked for one person without cutting everyone off. Named sharing gives the audit log, per-person revoke and the row rules (architecture rule 3).

## 2026-10-12: What changed and Undo come from the audit log

**Decision:** "What changed" is read from the audit log every write already keeps (`_audit` in the space object), not from a new table: records added, changed or deleted, said in plain words from each entry's before/after. Undo is a normal write that applies the inverse (a change gets its earlier stored values back; an added record is removed) and leaves its own audit entry naming the entry it undid, so it shows in the log, can't run twice, and is itself a change. A delete can't be undone, because a delete drops the record's values; keeping them is a later decision if it's wanted.

**Why:** one source of truth (the audit log is already required by architecture rule 11), nothing new to keep in sync, and undo goes through the same path as any write (idempotency, change log, workflows, live updates).

**Also:** audit entries get a ULID (`change_id`, rule 4) and that is the id history and Undo use; the integer row id stays internal. `undo_change` is a confirm operation for assistants and MCP, like the deletes and money changes it can reverse. `undoable` is only true when Undo can do something: the record still exists, the entry isn't undone, and a change has at least one field that can be put back.

## 2026-10-12: Every write needs a signed-in person (supersedes the venue door link)

**Decision (owner, 2026-10-12):** a link alone can only read. Anything that changes data, including filling a form, needs a signed-in person who was shared with by name and holds a role. The venue door link (a link that could set one field without signing in, approved as an exception on 2026-10-11) is dropped; "the venue marks arrivals" becomes "share the guest list with the venue's person as an editor on Arrived". Link forms (adding records through a link without an account) go the same way: a form asks the person to sign in first.

**Why:** signing in with Google or a passkey takes seconds, and in return every change carries a name, shows in What changed, can be undone and can be revoked for one person. Nothing here is gig-specific: the blocks (a shared view, a row rule, one editable field) stay generic; only the way in changes.

**Follows (done the same day):** `POST /api/link/submit` and the object's `submitPublicForm` are removed; a form can't be shared by link any more (`public: true` is refused for forms, 400) and a form shared by link earlier no longer opens; link-only views stay read-only. The website's `/s#token` page shows views only. The guest-list test keeps its sign-in form.

## 2026-10-12: Processes are workflows with people in them (ask and repeat blocks)

**Decision:** a process (home-first.md §2 point 9) is not a new engine: it is a workflow with two more generic steps. **Ask** names who to ask (the same forms as "tell": me, people by name, the person in a field, the people in a linked list's person field), puts the question to them as a normal question share, **waits** (for everyone or for the first answer), **nudges** those who haven't answered every so long (capped, and on demand from the process card), **keeps the answer on the record** in a field the person chose, then the run goes on from the next step. **Repeat** goes back to an earlier step while the record matches a condition, at most N times. The run's state is one row per wait inside the space object; a resumed run is an ordinary job, so chain-depth limits and the audit log hold. "Waiting on" is read from those rows (`GET /api/waiting`), for the owner and for the people asked (across the spaces shared with them).

**Why:** roles, waiting, nudges and loops are all the design asked for, and each is a block the engine can run for any setup (a client confirming a date, the band answering availability, a venue confirming a load-in time) with no workflow-specific code (architecture rule 15). Reusing question shares means the answer arrives wherever the person already answers questions, with the same access checks.

**Also:** the client-by-link step is dropped, following "every write needs a signed-in person": a client is asked by name after joining a share, like anyone else. A choice field can keep one answer only, so with several people and "wait for everyone" the answers go in a text field as "Rahul: Yes · Priya: No". A wait ends only with an answer, a turn-off or a delete; a time limit that moves on by itself is a later block if wanted.

## 2026-10-12: One search index per person, filled by the spaces (new object class)

**Decision:** search (home-first.md §4) gets its own Durable Object class, **SearchObject**, one per person (`search:<user id>`, binding `SEARCH`, wrangler migration v8), holding an SQLite FTS5 index (trigram tokenizer: part of a word, any case) over the records the person can see. Each space fills the indexes of its members from its own change log in its alarm, right after a write (the same path as the live pings: object to object, from the outbox, never in the request), and can rebuild an index from scratch. The index is a disposable copy: a query's hits are re-checked with the owning space before anything is shown, and D1 is not involved.

**Why:** one index per person is the only shape where "everything I can see and nothing else" holds by construction (architecture rule 3 and home-first.md §6); keeping it in its own object keeps the live object (sockets) and the inbox (notifications) simple, and lets the index be dropped and rebuilt without touching anything that matters. FTS5 inside the object costs nothing extra on the Free plan.

**Also:** v1 indexes records for members only; collaborators search what's shared with them on the device (the home's search sheet). The web app keeps its per-collection title search; the phone and the assistant use the new one.

**Search by meaning lives in the same object, not in Vectorize (for now).** Each document's embedding (Workers AI's free text model, through the default gateway) is kept in the person's index as a float32 blob and compared there by cosine; words and meaning merge with reciprocal rank fusion. Why: a person's index holds a few thousand records at most, where a brute-force compare costs nothing; the Vectorize binding has no local dev or test support (remote only), would be one more account resource to create and watch, and its person filter would mean one vector per person per record anyway. The fill path (the space's alarm) is unchanged, so Vectorize can replace the blob compare later without touching anything else. With the scripted model (tests, local dev) a character-trigram stand-in gives a usable vector, so the meaning path runs everywhere.

## 2026-10-12: Setups travel between people as cards, structure only

**Decision:** "share my setup" (home-first.md §5.4) is one operation, `share_setup`: the sender's space describes its own setup in the `make_setup` shape (names, not ids; no records; filters on links dropped; linked lists included, within the setup limits), the definition is checked by the `make_setup` schema, and each recipient gets a card in their own chat that runs `make_setup` in their own space when they tap Make it. The card lasts a week (a confirm card lasts 30 minutes), so actions carry their own `expires_at`. Only people with the assistant can receive one (they couldn't make it otherwise), and only people the sender knows (by name, candidates when ambiguous).

**Why:** the copy goes through the one path every setup takes (same schema, limits, confirmation, idempotency key and audit), so a received setup never carries code or data and nothing is made before the tap. Posting into the recipient's chat reuses the confirm card the person already knows from the assistant and This week.

**Also:** the memory card and page on the phone read and forget through the existing `/api/memories`; no new storage.

## 2026-10-12: The new home ships on the website at /app before the switch

**Decision:** the Expo app's web target is built with the website and served by the Worker under `/app` (its own files, its index for every route under it), while the Svelte site stays at `/`. On a laptop the home is one dashboard of four columns; on a phone it stays swipeable pages. The switch (the new home at `/`, the Svelte app retired) comes when the new home covers what the site does.

**Why:** home-first.md §7 step 7 says "until it matches today's site, then the switch"; shipping the web target alongside lets the owner and the band use the new home on a laptop or Windows now, and keeps every old screen reachable meanwhile. One build (`pnpm build`) and one deploy keep it to a single Worker on the Free plan.

**Also:** the website's service worker never answers for `/app`, so a new deploy of the new home reaches browsers on the next open.

## 2026-10-12: Native pieces come in through local config plugins

**Decision:** the Expo app's Swift parts (App Intents now; widgets and the Share extension next) live in `apps/mobile/native/ios/` and are added to the generated Xcode project by local config plugins in `apps/mobile/plugins/` (Expo's own `config-plugins`, no new dependency), run by `expo prebuild` on the Mac runner. An intent hands the app a path through its own defaults; the app opens it when it comes to the front.

**Why:** the Xcode project is generated and never committed (decision 2026-10-11, HF2), so native sources can't be edited in it; a plugin re-applies them on every build. Handing over a path (not running the action from Swift) keeps sign-in, checks and confirm cards in one place, as the Capacitor intents did.

## 2026-10-12: Backups are sealed with an owner-held key

**Decision:** when the `BACKUP_KEY` secret is set, the nightly backup is encrypted (AES-256-GCM, key from PBKDF2 of the passphrase with a fresh salt per file) before it goes to the owner's Drive; restore opens it with the Worker's key or a key typed in. Without the secret, backups stay gzipped JSON. The key is the owner's: it lives in GitHub secrets and their password manager, never in the repo or the database, and nobody can recover a backup without it.

**Why:** the backup holds everything (every space, chat and gig); Drive is private but a file copied out of it should give nothing away. A passphrase-derived key means the same string works wherever the file is read (the admin panel today, a script later), with no key file to lose.

## 2026-10-12: A model scorecard decides what the assistant can be trusted with (owner's OK)

**Decision:** a fixed set of real requests (`apps/worker/scorecard/cases.ts`: everyday English and Hinglish, money and deletes that must wait for a tap, handovers, setups and home cards) runs through the whole app on fake data, with only the model calls going to Workers AI (remote AI binding in `vitest.scorecard.config.ts`). Each case is graded by what the app ended up with (records, cards waiting, the reply), and the run reports right/wrong, time, tokens, neurons and rupees per level and language. It's started by hand from the **Scorecard** workflow (`workflow_dispatch`, the deploy token, no new secret) and the table goes in `docs/scorecard/`. The everyday level runs now on the free allowance (about 1,000 neurons a run); setups run once the owner has AI credit (the workflow's `paid_gateway` input). Re-run when models, prompts or prices change, and before choosing the models for a new level.

**Why:** the owner asked how far the cheap models go and what a message really costs (for pricing at ₹99–299 a month); guesses aren't good enough for either. Grading the outcome rather than the model's text measures what a person would see, and keeps working when tools or prompts change.

## 2026-10-12: Cards become their own package, with a catalogue the assistant reads (owner's OK)

**Decision:** the card format, its parts and recipes, and the code that draws them move into **`packages/cards`** in this repo (not a separate repo or a published library): the `card.v1` schema and arrangements (from `packages/shared`), the React Native components (from `apps/mobile/src/components`), a one-line-per-part **catalogue** generated from the same definitions for the assistant, and a **gallery** screen showing every part at every size, light and dark (the simulator screenshots it). The assistant keeps describing cards as data that the app checks and draws; it never writes HTML or code for a card. Rarely used parts' details are looked up on demand, so the assistant's context stays small as the set grows.

**Why:** built-in parts open instantly and offline, work in widgets and on every screen size, keep one look, cost the model a few hundred tokens instead of thousands, and can't run code (the "no code execution" rule). One package keeps the definitions, the drawing and the assistant's catalogue from drifting apart, and adding a part touches one place.

## 2026-10-12: Connectors start with Google Calendar (owner's OK)

**Decision:** the first outside connector (universal.md §10 "Connectors") is **Google Calendar**: each person connects their own Google account once (OAuth with the calendar scope, the token kept encrypted in that person's own object, revocable from the app), the assistant can read upcoming events and propose new ones, and a card can show calendar events. Reading is allowed; adding or changing an event is always a card to tap. Connector tools are offered to the model only when a request needs them; what comes back is data, never instructions. Gmail is next.

**Why:** everyone already signs in with Google, and gigs and rehearsals belong on the calendar people already use. The owner approved the new access in chat (2026-10-12); it stays per person and opt-in.

**Addendum (2026-10-12, owner's feedback):** cards come in five sizes, smallest first: `xs` (Tiny: half width, half height), `s`, `bar` (Strip: full width, half height), `m`, `l`. Half-height sizes show one figure (a total, days left, done out of all) so a number never sits alone in a big box; the grid stacks two of them in one cell's height.

## 2026-10-12: Cards have controls (owner's ask: "very interactive" cards)

**Decision:** a list card's rows can carry up to four **controls**, each bound to one field of the list and writing it when used: **tick** and **switch** (yes/no), **chips** (a choice), **stepper**, **stars** and **slider** (a number), and **button** (sets one field to one value, e.g. "Paid"). They're part of the saved view (`card: {arrangement, controls}`), set by `save_view` / `update_view` (so by the assistant in the chat, "chat makes, screens use") and checked by the space's object: the control must fit its field's type, a button's value must be a value the field takes, calculated, linked, person and personal fields can't be changed from a card. Drawn by `packages/cards` (`native/controls.tsx`, React Native's own parts, no new dependency), at least 44 points to tap; a change shows at once and goes through the outbox (offline first), like a tick.

**Why:** the owner wants cards to be rich and interactive, not just ticks. Binding every control to a field keeps them "using" what exists (no logic in a card), keeps one source of truth, and lets the server check every one; the assistant composes them from a short list instead of drawing UI.

## 2026-10-13: The everyday model answers without thinking first; requests stay steady for caching (owner: "do what you do")

**Decision:** the everyday model (GLM 4.7 Flash) is called with its built-in thinking **off** (`thinking: false` in the models table, sent as `chat_template_kwargs.enable_thinking: false`); other models keep their defaults. To make up for it, the instructions name the next seven days with their dates, tool results show stored times in India time (`+05:30`, not UTC), and the instructions say to tick a matching reminder before adding anything and that a note is a record, not a memory. Every model call also carries `x-session-affinity` (one id per person and chat) and the clock line sits at the end of the instructions, so models that cache what they've read (Kimi on Workers AI) can reuse it; the call log counts cached tokens. Sending only some tools per request is **not** done for now: the app would be guessing which tools a message needs.

**Why:** the scorecard: thinking off cut the middle reply from ~12–13 s to ~4–8 s with the same or a better score (17–19/20 vs 17–18/20); GLM showed no caching (0% reused), and with thinking off, reading the instructions is no longer the slow part (what's left is mostly waiting on the free servers, up to a minute at busy moments). Keeping every tool keeps the assistant flexible.

**Addendum (2026-10-13, owner: "compare all the models"):**

- **Candidates:** everyday-model candidates are added to the models table switched off (`ready: false`): DeepSeek V4 Flash, GLM 5.3 Flash and Qwen 3.8, all on Workers AI. The scorecard tries one with its `model` input.
- **Which wins:** a candidate replaces today's model only if it scores at least as well on the harder 54-case run, ideally right 3/3 on repeats, and is faster or cheaper.
- **Outside providers:** models outside Cloudflare (Claude Haiku 5.5, GPT, Gemini, via AI Gateway) need the owner's account with that provider. Each is a separate decision before it's wired in.

## 2026-10-13: Cards get rich rows (owner: "this is the kind of richness and detail I'm talking about")

**Decision:** a list card's rows can have a **layout**, chosen in the chat like everything else and kept on the saved view (`card.row`). Each part names a field of the list:

| Part         | Field it takes                                 | What it shows                                                                                                            |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `date`       | date or date-time                              | A calendar tile (OCT / 17); today's is coloured, past ones are faded                                                     |
| `details`    | up to 3, any type                              | A line under the title ("Sat · 6 pm · ● Vibe Tribe"); a choice shows with its colour dot                                 |
| `pills`      | up to 2: money, number, choice, text or yes/no | Highlighted pills ("₹5,000")                                                                                             |
| `callout`    | text or long text, plus an optional label      | A highlighted box when it has something ("To do: …")                                                                     |
| `action`     | text                                           | A button on the right: `directions` (an address, opens maps), `call` (a phone number) or `open` (a link)                 |
| `highlights` | up to 4 of filters + colour (+ a word)         | Rows that match get a coloured edge, a soft tint and the word as a pill; first match wins (2026-10-15 "Toward Excel", 4) |

- **Checks:** the space's object checks each part against its field and stores field ids, like controls.
- **List cards only:** a row layout makes the card a list card. Controls still work on rich rows.
- **Shared setups:** they carry the layout by field names.
- **Drawn by:** `packages/cards` (`native/rows.tsx`), with no new dependency.

**Why:** the owner's old Gigs screen showed how much richer a list reads with date tiles, pills and highlighted notes. As general parts bound to fields, the same look works for any list (classes, bills, trips), stays one source of truth, and the assistant only names fields (no code, no HTML).

**Next, in order:**

1. A hero card for the next item, with a countdown.
2. A grouped agenda: month headers with counts, and filter chips.
3. A calendar card: a month grid with dots; tap a day to see its items.

## 2026-10-13: Guide people, no presets (owner: "A blank canvas will overwhelm a user… no presets… interactive help")

**Decision:** nothing in the app is pre-made for a person. Instead they're guided in five ways, built in this order:

1. **A first-run tour:** a short walk over the real home, each step lighting up the part it talks about (the chat bar, the cards, the pages, search, help) with the rest dimmed.
   - It ends with "Tell me about your week" when the home is empty, so the first lists come from the person's own words.
   - It's shown once per person on each device, skippable at every step, and Help → "Take the tour again" brings it back.
2. **One-time hints:** a small tip the first time something becomes possible ("Want a card with this month's total?").
   - They're worked out from the person's lists' field types, never from what they typed. Each can be dismissed for good.
3. **"What can I do here?" on a card:** a few things that card could do, from its fields ("highlight the fee", "add a Paid button"). Each one opens the chat with the request filled in.
4. **Ideas, not presets:** the card gallery doubles as an ideas page; "make me something like this" asks the assistant to build it from the person's own data.
5. **Help in the chat:** "How do I…?" is answered in words. A later step points at the real button on the home.

**Why:**

- A blank home overwhelms, and presets make everyone's app look the same and fill it with things they don't use.
- Guidance that reacts to what the person has keeps "chat makes, screens use", and keeps every list theirs.
- Hints come from facts (field types, counts), so no one's messages are pattern-parsed.

## 2026-10-13: Flows on a schedule, over many records, with branches (owner: "Okay then do all the 3")

**Decision:** workflows get three new parts. All of them are data run by the space's engine, never code, and all show in the flow's words and diagram:

1. **Schedules:** `when: {event: "schedule", every: day | week | month, days, day_of_month, at}`, India time (31 means the last day of the month).
   - The space's own Durable Object alarm runs them, not a server cron. Each scheduled flow keeps exactly one job: when it runs, the next one is booked (a run missed while asleep runs once, late).
   - A scheduled flow has no record, so steps that need one (set, ask, go back, a `{Field}` person) go inside "for each".
2. **Many records:**
   - **Summary** counts or adds up a list's matching records, optionally broken down by a field. Later steps read it as `{Name.total}`, `{Name.count}` and `{Name.by}`.
   - **For each** runs notify / set / add on every matching record, at most 100 a run.
3. **Branches:** an **if** step runs one set of steps or another. Its conditions are the record's fields, or a summary made earlier ("Week.total is more than 5000").

**Why:**

- These were the three gaps between "rules and simple flows" and the processes the owner described (a weekly spending note, chasing every unpaid invoice, a different path for big amounts).
- Keeping them as generic blocks keeps workflow logic in people's setups (rule 15).
- Per-space alarms keep the "partition by entity" rule: nothing runs from one shared place, and a quiet space costs nothing.

## 2026-10-13: Questions, not SQL (owner: "Okay build it and complete it")

**Decision:** the assistant asks questions about the data with a structured question, not SQL: `{from, where, group_by, measures, sort, limit}` by names.

- **What it can ask:**
  - Filters are the same ones `find_records` uses.
  - `group_by` takes a field, a date by day, week, month or year (`Date:month`), or one link away (`Client.Name`, or `Payouts.Amount` for a list that links here).
  - Measures are count, sum, avg, min, max and count_distinct. Each column can have its own filter (this year next to last year). A `calc` column does arithmetic on earlier columns (`{Earned} - {Paid out}`) in the formula language.
- **How it runs:** the space's engine checks every name, as the person asking, and errors list the real names so the model can retry. It reads the rows through the same find as everything else and works the arithmetic out exactly (money in paise).
- **Limits:** at most 20,000 records are read (more fails with "narrow the question"), and at most 200 rows come back.
- **What people see:** the answer is a live card in the chat. On the phone, "Pin to home" keeps it as a saved view whose card (`table` or `bars`) asks the same question each time it shows. The question is kept by names and checked when saved.

**Why not SQL, even restricted:**

- The storage is generic (records, values, links), so SQL over it is hard for a small model to get right.
- Access rules (shares, personal answers) would have to be rewritten into every query.
- A safe SQL subset needs a parser and a blocklist, which is easy to get wrong.
- Money and time zones would leak into the model's hands.

A structured question keeps the model doing what it does well (naming things) and the engine doing the sums.

**Later:**

- Questions across spaces.
- Questions for people with a share only (today it needs a role in the space).
- Keeping a pinned question by field ids, so it survives renames.

## 2026-10-13: A warmer home (owner, on the mock-up: "Yes this is way better")

**Decision:** the phone app's home takes the look of the approved mock-up.

- A warm off-white page with white cards and softer shadows.
- Plain bold card titles with a tag in the list's colour. This replaces the tinted band and letter badge.
- A greeting with today's date on Now.
- A "Next up" hero card: the soonest dated record across the home's cards, within two weeks and not ticked. It shows a countdown, a date tile, the details and amounts, and the row's button (directions, call, open).
- A dark chat bar with a send button, and round Help and Search buttons.

The colours are tokens in `packages/cards/src/native/theme.ts`: `ink`, `hero`, `good`, `warn`, `tileInk`.

**Matching the mock-up** (owner: "I like your mockups much better"):

- **Typeface:** Manrope, through the new dependency `@expo-google-fonts/manrope`. It's loaded at start in `_layout.tsx`, and the app waits for it for at most 1.5 s, then falls back to the system font. Every `Text` and `TextInput` comes from `packages/cards/src/native/text.tsx`, which maps the weight to its face.
- **Tick boxes:** rounded squares that fill with the accent (`tick.tsx`).
- **List rows:** no lines between them, and 15 pt row text.

**Why:** the owner found the mock-up "way better". One big card for what's next makes the home useful at a glance.

**Next:** the chat answer card from the mock-up (a big total, a coloured category bar, a list), then the grouped gigs agenda (month headers, filter chips).

## 2026-10-13: Motion (owner, on the motion demo: "I like your animations idea", "no changes to the motion demo")

- Motion says what happened: a tick pops and fills; a row that no longer belongs to a card slides away after a short beat; a changed count pops; cards rise in one after another; answer bars grow; pinning dips the card toward the home with a tap.
- Built with Reanimated (already a dependency) and expo-haptics. Short (under 0.7 s) and springy, never in the way of the next tap. Reduce Motion turns it off.

## 2026-10-13: The whole list (owner: "Fine, do it")

- Cards show a few rows; the whole list has its own screen (`/list`), not a chat answer. It is a screen for using what exists ("Chat makes, screens use"): chips switch between "All" and the list's saved views, records can be ticked, tapping one asks the chat about it, and adding goes through the chat bar at the bottom. New chips (views) are made in the chat.
- Grouped by month when the list has a date, otherwise one plain run; pages of 50.
- Ways in: the card's title ("Notes ›"), "Open list ›" under a list card in the chat, Search, and an "All lists" page at the end of the home.

## 2026-10-13: Chats with people (owner, on the mock-up: "the screens look good, you can go ahead")

- **Chats with people come into the new app**: groups and chats for two, from a Chats screen (the round button on the home's greeting, with how many chats have something unread). The assistant's own chat is listed first and marked "Only you see this one". Mock-up: the "Gigspree home refresh" artifact, second row.
- **Anyone using the app can start a chat, free.** Text costs almost nothing; only the assistant costs money. A chat is only with people you already know here: people you share with, who share with you, or who are in a group with you (`GET /api/chat-people`), so nobody gets messages from strangers.
- **A chat for two is a group object marked `direct`**, one per pair of people (D1 `direct_chats`, keyed by the two ids sorted), so starting it again from either side opens the same chat. It can't take more people or be left. Its name, for each reader, is the other person.
- **Unread counts**: each member's `read_at` in the group object; opening a chat marks it read. A read marker changes nothing anyone else sees, so it isn't audited or keyed (repeating it is harmless).
- **Messages work offline**: they go through the phone's outbox like any other change, show at once as "Sending…", and go when there's a connection. The phone keeps the chat list and each chat for opening offline. Live updates on the phone use the same live object as the website (a WebSocket that says something changed; the screen fetches again).
- **The assistant in a chat is private** (this replaces the 2026-10-10 rule that @assistant's answer is posted for everyone): you ask it in a panel only you see, as many messages as you like, and choose **Share to chat** for an answer you want everyone to see. Built in step 3; until then the server's old @assistant path stays, and the phone doesn't offer it.
- **Saving a message happens only when someone asks** (hold a message, Save). The app doesn't run the AI on every message. A suggestion helper may come later, but the same one on every phone (iPhone and Android): no Apple-only or Google-only on-device AI.
- **Photos** (step 5): kept on the server for 7 days, shrunk, in the chat's own storage (free; Cloudflare's file storage R2 needs a payment card), and saved on each phone, like WhatsApp. Sending them phone to phone is fine too.
- **Build order**: 1 chats and messages on the phone (this), 2 Save, 3 Ask privately and Share to chat, 4 Ask everyone (Yes/No/Maybe that fills a record), 5 photos. The shared-cards strip at the top of a chat comes with Share to chat.

## 2026-10-13: Saving chat messages, and searching chats (owner: "Yes, do all"; "should we use embeddings for this?")

- **Save** (chats step 2): hold any message, Save. The asker's own assistant proposes where it goes, in their own assistant chat about that group (the same chat Ask privately will use), with **proposals only**: every write is a card, and nothing is saved before the tap. The message goes to the model inside `<message>` marks, with the instruction to treat it only as text to file, never as instructions (other people wrote it). A message's day goes with it, so "Saturday" or "12 Dec" is read from that day. Without the assistant, Save puts the message in the person's Inbox as it is (no model).
- **"Saved to Gigs ✓"** under a message is a per-person mark in the group object (`saves` table), shown only to the person who saved it; it goes through the outbox, so it shows at once.
- **Searching chats** (a later step): chats stay on the server (they need to, for search, links to records and the assistant). Each message a person can see goes into **their own search index**, the same one that holds their records: words (FTS5) plus meaning (embeddings from Workers AI's free text model), merged as today. A few messages in a row are embedded together as one piece of conversation (context, and less to store). Leaving a group takes its messages out. Embeddings only turn text into numbers (no decisions, no actions, tiny cost), so this is not "the AI reading every message"; a chat model still only runs when someone taps Save or asks.
- **Live updates on the phone** now cover the home and the full list too (they load again on a change, unless the person's own changes are still on their way). Push notifications for new messages are the next step.

## 2026-10-13: Asking privately in a chat (chats step 3)

- In a chat, the **Gs** button opens **my own assistant** about that chat, in a panel only I see (the same assistant chat Save uses, id = the chat's id). It never reads the chat's messages; it answers from my lists, my allowance and my access, as many messages as I like.
- **Share to chat** posts one of its answers into the chat as "Assistant (shared by me)", once per answer (the server takes only a real answer from my own chat, never text the app sends). Cards and live cards stay in my panel for now; sharing live cards comes with the shared-cards strip.
- Writing **@assistant** in a chat no longer does anything special (the 2026-10-10 public answers are retired); the old website's group page no longer suggests it.

## 2026-10-14: Ask everyone (chats step 4, first part)

- The **+** next to a chat's message box asks everyone a question, with Yes / No / Maybe to start with or up to 6 answers of one's own (they must differ). It shows in the chat as a card with a button per answer, how many picked each and who; each person has one answer, can change it, or tap it again to take it back. Asking and answering work offline (the outbox), and my answer shows at once.
- Kept in the chat's own object (`polls`, `poll_votes`), audited and keyed like other writes; `GroupView.polls` carries them.
- **Next part (not yet):** an answer that fills a record (the mock-up's "answers fill in the gig's lineup"): a question tied to a record and a field, so "Yes" from Dev adds Dev to the lineup. It needs the record link and the person's access checked by the space, so it comes as its own step.

## 2026-10-14: Undo that can't damage data (owner: "Yes, do all of it… we need to be very careful that people's data is not damaged or corrupted")

This replaces the 2026-10-12 rule that a delete can't be undone.

- **Deletes are soft, and now fully undoable.** A deleted record keeps its values (they always stayed on the row); the delete's audit entry now also keeps its links both ways, so Undo brings the record back with its links, its search entry, its date reminders and the totals that count it. A delete's cascade (records it took with it) is kept as `followups` of kind `cascade` and comes back with it. A link that points elsewhere since, or a record on the other end that is gone, is left as it is. The list's rules are checked as for a new record (another may have taken its place), and the linked records' rules too.
- **Undo never quietly overwrites a later change.** Undoing a change (or an add) that someone changed afterwards stops with who and which fields ("Asha changed Amount after this"); the person decides, then it runs with `force_through` = the newest later change they were shown (a change made after that stops it again). Everything an undo would overwrite, in what it undoes together (`with`), is said at once. `HistoryItem.changed_since` says it before anyone taps.
- **What a change led to is kept with it.** A job a record write queues carries the write's change id (`workflow_jobs.cause_id`, and `workflow_waits.cause_id` for a process that asks); what that run changes and who it tells is kept in `followups` (kinds `change`, `told`), so chains follow on. `HistoryItem.followups` lists the changes (undo them too with `with`, or keep them); `told` lists who was told, and they get a notification that it was undone (messages already sent can't be taken back).
- **Undone is a table** (`undone`: change id → the undo's id, filled from older undo entries by the migration), not a text search through the log.
- **A workflow's own changes say "a workflow"**, not the person who made it.
- **Old gig code:** removing a show or a person, or releasing a date option, keeps the lineup (shares) and answers it removes in the audit entry (they were dropped with no copy).
- **Not yet:** a link change's earlier links aren't kept in the history (links can't be undone one by one); money moved by a workflow will go through reversing entries like payments when chat workflows can move money.

## 2026-10-14: Recently deleted (owner: "30 days is fine, go ahead")

- **A deleted record waits in Recently deleted for 30 days** (`TRASH_DAYS`), then it's **erased for good**: its values and title, its personal answers, its comments, the run history that mentions it, and the history's copies of what it said are wiped (`records.purged_at`). The history keeps who did what and when. Erasing is done by the space's own alarm (it wakes at the oldest deleted record's 30th day), so no cron or shared table is touched.
- **Restore** is the same as undoing its delete (links, what the delete took with it, the list's rules checked). **Delete forever** erases it at once, and needs confirmation from assistants and MCP (`delete_forever`, a confirm operation).
- **Only people who can change the space** (owner, editors) see its Recently deleted; people a list is only shared with don't.
- A record a delete took with it shows with that record ("with 1 linked record") and comes back, or goes, with it.
- **Why 30 days, not for ever:** people expect "delete" to end in gone, and India's data protection law gives a right to erasure; 30 days is what iPhone Photos and Gmail do. The nightly backups on the owner's Google Drive still hold an earlier copy for as long as those files are kept.
- **Not yet:** removed fields, lists, views and workflows have no Recently deleted (they're soft-deleted and kept); the old website has no trash screen.

## 2026-10-14: A home for each chat (owner: "go ahead, do your thing", on the approved mock-up)

- **Admins.** A chat's role `owner` is an admin; a chat can have several. Admins add people, make others admins (or members again), start the chat's home and arrange it. A chat always keeps one admin (the last one can't step down or leave). A chat for two has no admins: either person can do it all.
- **The chat's home is a shared space that belongs to the chat** (`space.group_id`, `grp.space_id`). An admin starts it once ("Start this chat's home"). The chat claims the space id first, so two admins at once make one home. Its members follow the chat's: the chat sends its whole member list, numbered, from its alarm (retried; a repeat or a late list changes nothing). Admins are the space's owners, everyone else an editor, and people who leave lose it. The space list in D1 (`space_members`) follows. Nothing is written to the space in the chat's request.
- **Only admins change how it's set up**: lists, fields, cards on its home, rules, workflows and shares (`canArrange`). Everyone ticks, adds and changes records. Personal spaces are unchanged.
- **Made by chat:** the private assistant in a chat sees the chat home's lists next to the person's own, and is told to use the chat's for things for the chat (`space` on its tools). It asks when it isn't clear which.
- **Phone:** a Chat | Home switch in every chat; Home shows the space's pinned cards (ticks through the outbox, live reload). The "···" button opens People: who's an admin, and Make admin / Make member for admins.
- **Next steps:** questions that lead to actions (workflows with Auto / Ask-you approvals), then schedules. Not yet: See all and the Recently deleted screen for a chat's lists, and keeping a chat's home on the phone for offline.

## 2026-10-14: We don't read people's data (owner: "I think not reading the user's data is the best thing to do")

- **The rule:** the app team never reads what people keep or write. No admin screen, tool, log, report, monitoring or support process shows or keeps anyone's lists, records, chats, assistant conversations or memories. We see counts and structure only. This is written into AGENTS.md "Don't" and docs/security.md, and checked by `admin.test.ts`.
- **Why a rule and not a lock:** data is encrypted at rest by Cloudflare, but not end to end, because search, the assistant and workflows run on the server and must read it. Whoever controls the Cloudflare account or the code could read it, so the promise rests on rules, review and tests.
- **No conversation sharing, not even opt-in with a reward:** a prompt carries the records it read, including other people's entries in shared lists and chat homes. Nobody can consent for them, and higher limits in exchange for sharing wouldn't be freely given consent. Monitoring will be counts and structure (which tools, fields, errors, timing, cost), never words.
- **Testing** uses the owner's and test accounts, and the scorecard with made-up data. A real failure becomes a scorecard case written with fake data.
- **AI Gateway logging is off** on every call (`collectLog: false`), so Cloudflare's dashboard doesn't keep prompts.
- **The owner's name isn't in the app**: it says "the app team".
- **Privacy page rewritten** for the assistant app: who can see what, the AI model, not end to end, Recently deleted and recovery copies (Cloudflare up to 30 days, the newest 60 nightly backups).

## 2026-10-14: How we see the assistant is doing (owner: "should we have any metrics for the model usage and stuff?")

- **Counts and structure only**, under "We don't read people's data". Each request to the assistant leaves one row in the budget object's `turns`: level, model calls it took, tool names and how often, refusals as `tool:code` (`add_record:validation_failed`), how it ended (answered, card, no_answer, handover_blocked, stopped), time taken and the prompt version. No words from the person, the model or the records.
- **Signals** (`signals`): a card confirmed or cancelled (with its tool name), and 👍 / 👎 under the newest answer. Only the rating is sent. A retried request counts once (its key). A tool name the model made up is stored as "unknown", since it could carry any text.
- **No undo count:** writes don't record whether the assistant made them, so a count of all undos says little, and counting each one would write to one shared object on every undo (architecture rule 1).
- **Kept 90 days**, like the call log; the admin panel's "Assistant quality (7 days)" adds them up: answered share, median and slowest-10% time, cards confirmed, 👍 / 👎, most refused tools, per model (calls, failures, time, tokens) and per prompt version.
- **`PROMPT_VERSION`** in `assistant/service.ts` is bumped with every real prompt change, so a change shows as better or worse in the panel.

## 2026-10-14: Chat about this (owner: "I like your suggestions… chat about this gig… Do it")

- **Any record can get its own chat**, not just gigs: hold a row in a list → "Chat with people about this". A sheet shows the people I can chat with, those on the record ticked (its person fields, and people it's already shared with), and its fields with money switched off. "Start chat" makes a group chat named after the record and opens it on its Home.
- **The record is pinned to the chat through a share, never a copy** (one source of truth). The share remembers its chat (`shares.group_id`); the chat keeps its pinned records (`cards`) and tells each share its numbered member list from its alarm, like the chat's home (`syncShareToChat`, two checkpoints: the share and D1's `shared_with`). People who join the chat see it; people who leave lose it.
- **Who:** an admin pins (either person in a chat for two); an admin or the record's owner takes it off, which turns its share off (`closeChatShare`, from the alarm). A share the owner turns off drops off the chat. At most 20 pinned per chat.
- **Opening:** everyone in the chat opens a pinned record through the chat (`GET /groups/:id/cards/:share_id`): the chat checks membership, the record's own space checks the share. A pinned record is drawn large (up to eight rows), dates in words.
- **In the app only** (session operations), like the rest of chats. Next: questions in the chat that act on the record ("questions that lead to actions").

## 2026-10-15: Faster answers from Cerebras (owner: "we can include this as a faster model… make a note in the app that this will cost a little more")

- **What:** GPT-OSS 120B at Cerebras answers everyday requests in a second or two, as the first choice at the everyday level for people who have faster answers; GLM 4.7 Flash stays the fallback (a refusal, no credit, the cap). Never at the smart level. Called straight (`api.cerebras.ai`, the owner's key as the Worker secret `CEREBRAS_API_KEY`), OpenAI-shaped, `reasoning_effort: low`; a 30-second limit.
- **Who, for now:** owners and admins (`fasterAnswers` in `assistant/access.ts`), while the account runs on the $5 trial (Limited Credits: Cerebras charges nothing beyond it, and there's no top-up). A per-person switch, and the "costs a little more" note in the app, come when the owner moves it to paid credit for everyone.
- **Its own money, its own caps:** Cerebras's cost is logged to see (`calls.cost_paise`) but never reserved against the ₹2,000 Cloudflare cap, and it uses no free neurons. The app allows `AI_FAST_CALLS_PER_DAY` (60) a day for everyone together and `AI_FAST_CALLS_PER_MINUTE` (4) a minute (the trial allows five), so the credit lasts the month and a burst is never refused by Cerebras itself. A slot is taken before each call, counted and taken in one step inside the budget object (`takeFastSlot`, table `fast_slots`), so requests at the same moment can't all pass the same count. The admin panel shows today's count.
- **Scorecard:** `model: gpt-oss-120b` on the Scorecard workflow tries it (the key is passed; the app's caps are off there, so any suite × repeat finishes), spacing cases out by the calls each made to stay under five a minute.
- **Privacy:** the privacy page says the faster model runs at Cerebras (US) and isn't trained on people's data; nothing is logged there by us.

## 2026-10-15: Toward Excel: the engine gets the expression power people expect (owner: "as flexible as Excel")

The owner asked for a review of the universal / chat-first / home-first design against "the chatbot should be able to do pretty much anything, as flexible as Excel". The review's verdict: the design is a typed database with links, rollups, rules, automations, a query tool and cards, which covers most of what people use Excel for, but it lacks Excel's expression power. The owner said "do all the features". Six slices, each its own PR, in this order:

1. **Formulas (this PR).** The formula language grows from arithmetic to: comparisons, `and`/`or`/`not`, `if`, `blank`/`ifblank`, `round`/`floor`/`ceil`/`abs`, `min`/`max`/`sum`/`avg`, text (`len`, `upper`, `lower`, `trim`, `join`, `text`, `contains`), dates (`today`, `year`, `month`, `day`, `weekday`, `date`), one field of the record a single link points at (`{Client.Rate}`), and formulas of other formulas and rollups of the same list (a loop is refused). A formula field can be text or yes/no as well as a number, money or a date. The type of a formula is worked out from its parts when it's saved (`inferType`), not by trying sample values, so both sides of an `if` must agree and nothing adds text to money. A formula with `today()` is worked out again for every record of its list at midnight in India (the space's alarm; `daily_formulas` meta). Rollups gain `avg`. Still one shared module (`packages/shared/src/core/formula.ts`) for the server and the offline overlay; the overlay leaves link paths to the sync (it has no linked record at hand).
2. **Bulk changes by expression**: `update_records` takes a formula per field ("Fee = {Fee} * 1.1" for a filtered set), preview and confirm as for any money change.
3. **Import and export**: paste or upload a CSV, the assistant maps columns to fields as a setup (confirmed first, a preview of the first rows); any view exports as CSV.
4. **Highlight rules** on views and cards: a filter and a colour token, data only.
5. **An editable grid arrangement** (tab across cells), writes through the outbox.
6. **The fallback when the assistant won't build it** ("Chat makes, screens can fix", amending "Chat makes, screens use"): the setup card the assistant proposes is editable before Confirm (rename or retype a field, add or remove a choice, tick a link); and a plain setup screen per list (fields, rules, cards and views as forms), hidden under the list's ⋯ menu, never a tab or a home button. Both write through the operations the assistant uses. The owner's reason for chat-first stands: no toolbox in the main screens; the fallback is a side door for when the chat sticks.

Not doing: raw spreadsheet cells, user-written code, AI-written pages. They would break offline merging, row-level authorization and the paise rule, and are Excel's main source of errors.

## 2026-10-15: The comparison's second round: the setups model (owner: "Test all five, Cloudflare is in")

- **Everyday result** (`docs/scorecard/2026-10-15-comparison.md`): Haiku 5.5 57/60 and 98/102 with every Hinglish and date case right; GPT-5.4 mini 57/60 and 94/102; nano 50/60 and 94/102; Gemini 3.1 Flash-Lite on the free tier 45/60 and 64/102, rate-limited. The owner picks; the recommendation on the table is Haiku for everyday.
- **Setups candidates** to run the same way (`suite=setups`, three runs of the three setups cases, `setup_model=` on the Scorecard workflow, `AI_SETUP_MODEL` in the app's settings, scorecard only): Claude Sonnet 5.5, GPT-5.4, Gemini 3.1 Pro, Gemini 3.6 Flash (makers' keys), and Kimi K2.6 (the Cloudflare credit route: Workers Paid plus AI credit, `paid_gateway=paid`, which the owner is setting up). Entries in `models.ts` with `ready: false`; prices as found 2026-10-15, to confirm on the first run.
- **Two things learned on the way:** OpenAI's chat completions refuse function tools with any `reasoning_effort` but `none` on GPT-5.4 (the OpenAI body sends `none`; the Responses API would allow thinking, not tried); Gemini's free tier needs pacing (the runner spaces Gemini cases out like Cerebras's) and can't serve real people (training).
- **A card on the home is a setup:** every model made the spending card in the chat instead of handing over, because the prompt's list of setups didn't mention home cards. The prompt and the `hand_over` tool now say so (prompt version 2026-10-15). The case stays.
- **Logs on a maker's refusal** carry its error code, type and the parameter named, never the message (it could echo the prompt).
- **First two setups results** (`docs/scorecard/2026-10-15-setups.md`, seven cases × 3): Sonnet 5.5 21/21 at 5.5 s and ≈ ₹2.65 a setup; GPT-5.4 19/21 at 7.1 s and ≈ ₹2.70, its misses a two-part request it finished halfway. A scorecard check reads every setup card of an answer, not the first: a link to a list that exists may rightly come as a second card. `suite=core` and `hard` are level-1 cases only, whatever models are set.

## 2026-10-15: Feel: the ChatGPT bar (owner: "as polished, smooth, and thoughtfully designed as ChatGPT itself")

- **The bar:** every screen and interaction is judged by one question: would it feel at home in the ChatGPT iPhone app? Calm, restrained, native; motion that says what changed and nothing more; a finger gets an answer the moment it lands. The owner is fine with the app looking much like ChatGPT's; the brief came from a ChatGPT write-up and we keep our own judgement on it (no framework change: Expo stays; no component zoo: the catalogue stays small).
- **The audit (where we stood):** Expo 57 / React Native 0.86 with Reanimated 4, Gesture Handler and native stack already in; Manrope type; 36 style sheets with about 300 bare font sizes and no type scale; 357 Pressables of which 19 gave any press feedback; 11 sheets and 4 menus each built by hand on React Native's Modal with its stock slide, no drag to close, three different radii; the chat with no thinking state, a jump to the end on every content change, a one-line box; no streaming; nothing read Reduce Motion.
- **Slice 1 (this entry): the foundation.** `type` (display, title, heading, body, small, label, caption, eyebrow, num) and `motion` (press, sheet and settle springs; fade and enter timings; the press scale) tokens in `packages/cards/src/native/theme.ts`, next to the colours. `Tap` (`press.tsx`): a Pressable that shrinks to 0.97 and dims on the UI thread the moment it's touched, with an opt-in haptic; the chat, the home's bar and buttons, menus, sheets' buttons and the card controls use it. `Sheet` (`apps/mobile/src/components/Sheet.tsx`): the one bottom sheet, up on a spring with the scrim fading in, the handle drags it down to close, keeps above the keyboard, one radius, `tone` page / cell / ink; all eleven sheets and four menus are on it. `ThinkingDots` while the assistant answers. The chat follows new messages only when the person is at the bottom, new messages rise in, the box grows to five lines, Send is dim until there's something to send. Reanimated's own Reduce Motion handling covers all of it.
- **Feedback while it works (the owner, same evening: "I just have to wait in hopes that something is happening"):** the assistant tells the person's open apps what it's doing over the live socket (`assistant_progress`: thinking, then a line per tool such as "Adding to Reminders…", then done), and the chat shows it under the thinking dots. Only the step and a list's name travel, never the request's words (decision 2026-10-14 "We don't read people's data" holds: nothing is stored). Streaming the answer itself is slice 2; this gives the ChatGPT-style "thinking / running a command" feel now.
- **Ids made on the device never need `crypto` (the Expenses crash, build 1474):** Hermes has no `crypto` global, so `ulid()` falls back to `Math.random` bytes when Web Crypto is missing. A ULID made on the phone is a name for a record or a chat, never a secret or a token; uniqueness is all it needs (80 random bits beside the time). Secrets stay on the Worker, which has Web Crypto. A fallback inside `ulid()` rather than a polyfill dependency: one line, no new package.
- **No hook below a component's early return, ever:** the signed-out home crashed on every launch with no session (phone and web, since 2026-10-12) because one `useState` sat after the `Redirect` return. React counts hooks per render; a return above a hook makes the count differ between renders. Hooks go first, the early return after the last one, with a comment marking the line. Next: `eslint-plugin-react-hooks` (`rules-of-hooks`) in the lint, which catches this at commit time (a dependency, so its own decision when added).
- **One bad row never takes the app down:** `Boundary` (an error boundary) around every chat item, home card and list row, with "Can't show this one." in its place and the error reported as a count for the app team (never the data, decision 2026-10-14). The crash would still have happened without `crypto` (it threw in the list screen's own setup), so boundaries are a net under the drawing code, not a fix for missing platform APIs: those get tests and the simulator's app log.
- **The assistant's words are drawn, not shown raw:** the model may write short Markdown (bold, a bulleted list; the prompt says no headings or tables) and the chat draws it natively through `packages/cards/src/markdown.ts` + `native/markdown.tsx`. Asked for examples or what it can do, it shows a card rather than a list of words (prompt `2026-10-15c`): "show, don't list" is the chat-first rule applied to its own help.
- **Why tokens and two primitives before anything visual:** polish is consistency; a hundred separate tweaks wouldn't add up to it. With `type`, `motion`, `Tap` and `Sheet` in place, every screen that moves onto them gets the same feel for free, and the remaining bare sizes can be swept screen by screen.
- **Next slices, in order:** 2 streaming (the Worker streams the answer and the card skeleton as the tool call arrives; the chat draws them as they come); 3 the home and list screens onto the type scale, press feedback on cards and rows, the long-press menu scaling from the card; 4 the composer and keyboard on the group chats; 5 performance (memoised rows, `getItemLayout`, measured on the iPhone 16 Pro through the simulator job); 6 the card catalogue's visuals one by one.

## 2026-10-16: Quick and Careful (owner: "we'll name it something else according to us… right now I have no clue what is going on")

- **The two minds have names of their own:** **Quick** answers everyday things in a second (today Claude Haiku 5.5, with GLM behind it); **Careful** builds setups and takes harder questions (today Claude Sonnet 5.5). The names say what each does, never which company or model, so a vendor can change without the app's words changing. The system prompt tells the model which one it is and forbids naming the models behind the names.
- **Shown only when it's the exception:** nothing on a Quick reply (it's the default; a label would be noise); a small "Careful" caption under a reply Careful gave; "Handing this to Careful…" while a setup is handed over; "Careful isn't available right now" when it isn't. Help gets a "Quick and Careful" line that asks the assistant to explain itself.

## 2026-10-16: Sizes by content (owner: "we created cards of different sizes… it seems like it's not being used")

- **The home picks a card's size from what it shows** when nobody chose one (`DEFAULT_CARD_SIZE` in `packages/cards/src/spec.ts`): a number or a countdown is a half-width tile so two sit side by side, a list is full width, a table, bars or a grid is tall, "next" is a full-width strip. Before, every chosen arrangement got its smallest size and every default list got medium, so a home came out one flat size.
- **The assistant is told to leave the size out** unless the person asks for one, so the content rule is the normal path and a spoken size the exception. A person's own size (hold a card, resize) still wins.

## 2026-10-16: Rehearse a workflow, first part (owner: "do the simulation mode… your suggestion sounds okay"; "We can rehearse a workflow, right?")

- **What it does now:** any workflow, on or off, can be rehearsed on one record (the list's newest unless one is named). Its steps run for real inside a transaction that is then rolled back (`SpaceObject.rehearseWorkflow`, the trick setup cards already use), so nothing is kept, nobody is told and nobody is asked. What each step would do comes back in the words its run history uses ("Would ask Asha: “…”", "Set Status to Confirmed", "Told me: “…”"). At a question it stops and shows the question, who it would go to and its answers; picking one (as that person) runs it again with the answer, to the next question or the end. A step that would fail says so as the last line. Only people who can arrange the space can rehearse.
- **Where:** the workflow's screen has a Rehearse part (Rehearse, the answers as buttons or a box, Start again); the assistant has `rehearse_workflow` (Quick), and a new workflow's card says "say “rehearse it”". `POST /api/workflows/:id/rehearse`.
- **Not yet (the rest of the plan):** playing as another person or role through the app's screens (what Asha would see), a practice copy of a whole space with made-up rows, and group chats in a rehearsal (a practice chat with stand-ins). Other workflows that a rehearsed step would set off aren't rehearsed with it; the words say what this one does.

- **Each person answers for themselves, as the real run waits (review of #149):** a question to several people waits for every one of them (or the first, when the step says so), so a rehearsal takes one answer per person, by name, and stops on whoever is left ("It goes on once all 2 have answered. Answer as Priya:"). What it keeps is what the real run keeps: one answer, or "Priya: No · Rahul: Yes". When a "go back" step returns to the same question, that's a new time round and it asks again; each answer says which time it is for.
- **Reaching it:** a workflow the assistant made or changed shows in the chat as a card with its steps in words and "Rehearse or turn on ›", which opens its screen (it used to say "shows on the website").

## 2026-10-16: Rehearse a workflow, second part: practice copies (owner: "plan and do it")

- **A practice copy of a space:** "Practise with people" on a workflow's screen (or the assistant's `start_practice`, which asks first) copies the whole space, its lists, records, fields, rules, views and workflows, into a new space named "Practice: <name>" that only the person who made it is in. Its workflows are all on and run for real there, on their own timers, so a reminder at 9 tomorrow happens at 9 tomorrow, in the copy.
- **Nothing reaches anyone:** in a copy, every message or question a workflow would send goes into the copy's log instead ("What people would have got", with who it was for) and never into anyone's inbox; the copy can't be shared, isn't in search, and nobody else is in it. The questions waiting on people show with "Answer as Rahul" buttons; the answer goes in as if Rahul had given it, and the run goes on.
- **Only arrangers, at most 20 spaces, and a copy is never copied.** "End practice" (two taps) erases the copy completely; the real space was never touched. The home shows a "Practice copy" banner on its page.
- **Group chats:** a copy is not tied to any chat, and a workflow tells or asks people by name, never the group chat itself. So copying a chat's space and practising there puts what each member would have got in the copy's log; the group sees nothing.
- **Not yet:** playing as another person through every screen (what Rahul would see), made-up stand-ins for people the space doesn't know yet, and ending a copy by itself after a week.

## 2026-10-16: Rehearse as each person (owner: "I was hoping for a much better rehearsal where I can rehearse with other roles also, and I can see what other people are going to see")

- **One rehearsal screen, played person by person:** "Rehearse with everyone" on a workflow's screen makes the practice copy and opens the Practice run screen. At the top is a row of people: You, then everyone the space works with (its other members, and everyone something is shared with), each with a count of what's waiting on them. You set things off in the copy's lists; then a "Rahul's turn" card says what's waiting on him and "See Rahul's app ›" switches to him.
- **Their app, as it would be:** switched to a person, the screen shows what's shared with them, drawn with the same cards their home uses, plus their notifications. Their questions have their answer buttons, and their lists can be ticked or changed. Everything is done as that person inside the copy, so the space checks it exactly as it would for them: only their shares, only the records and fields the share shows, view-only stays view-only, and nobody can answer someone else's question. Nothing is a second copy of the rules.
- **The copy keeps who-sees-what:** a practice copy now keeps the space's shares (who sees which records and fields, row limits), but not questions in flight. Its links aren't registered, so nobody outside can open it, and the people it plays aren't pinged or told; only the person practising is in it. The space's other members are remembered, so they can be played and asked.
- **Questions waiting on you** show in your own view with their buttons. "Quick run in words" (the first part) stays as the fast check; the live rehearsal is the main button.
- **Not yet:** a member's full view of the space (they see everything, as you do, so the screen says so instead of drawing it), forms, and copies that end by themselves.

## 2026-10-16: Soft coloured cards (owner: "should we have colored cards… softer colored cards so that it looks good in dark mode and light mode… instead of having that small dot")

- **Every card is filled with a soft wash of its list's colour:** in light mode the colour laid over white at 10%, in dark mode over the card grey at 14%, so it reads as calm in both (`CARD_TINTS` and `cardTint` in `packages/cards/src/native/theme.ts`). The edge is the same colour a little stronger. Text, ticks, money and the "left" pills keep their own colours, so nothing becomes hard to read and warnings still stand out. The "Next up" card keeps its deep blue.
- **The list tiles** (All lists, a space's lists) are filled the same way, with "See all" in the list's colour; the small dot is gone.
- **Every list has a colour of its own:** a few everyday words still pick a fitting one (money, reminders, people, home); any other name gets one of six by its letters, the same every time, instead of grey. Grey stays for things that aren't lists.
- **Next:** a colour chosen in the chat ("make Expenses green"), kept on the list, so two lists that land on the same colour can be told apart.

## 2026-10-16: No band or gig words in what people see (owner: "is this a default message… I've told you repeatedly that this is not a gig specific app or a band specific app")

- **What was wrong:** the Chats screen's empty state said "Talk to your band and family here", a fixed sentence written into the app, not something it knew about the person. The new-group box suggested "Band", a chat idea said "call the venue", and the assistant's own instructions gave "the band" and "by venue" as examples.
- **Now:** everyday words ("Talk to the people you share things with", "e.g. Flatmates", "pay the electricity bill", "a home, a trip or a team", "by category, by person"). `PROMPT_VERSION 2026-10-16c`.
- **So it stays fixed:** `apps/web/test/neutral-words.test.ts` reads the text people see in the phone app (`apps/mobile/app`, `apps/mobile/src`), the cards package (`packages/cards/src`: the assistant's card catalogue and the gallery's samples, reachable from Help) and the assistant's instructions (`core/assistant/service.ts`), tests aside, and fails on band, gig, venue, rehearsal, setlist, guitar, soundcheck or musician, comments and the scripted test sentences aside. AGENTS.md's "Don't" list says the same. The old gig and music modules keep their own words until they are replaced.

## 2026-10-16: A home you arrange (owner: "I don't think I want these pre-built pages… at the start when there is no data, it should be like a blank canvas and there should be a button which says start building… like how iOS has… you can delete an app icon from the pages, and if you want to add it back you can go to another menu")

- **No pre-built pages:** "Now", "My cards", "Shared with you", a page per space and "All lists" are gone as pages. The home is the person's own pages of cards, like a phone's home screen. Lists and views are where data lives; the pages only arrange cards.
- **The library** (the grid button at the top) has every card the person could have: each saved view, each list that has no view (the whole list), every space's (not a chat's home, not a practice run), everything shared with them, each question waiting, and two from the app: **Now** (owner's choice: a card, not a page; it shows the soonest thing coming up on the home's cards) and "What it remembers". Each says which page it's on, or **Add**; a list's card opens the list. "Recently deleted" is at the bottom.
- **New cards land on the last page by themselves** (owner's choice), a new page when the last has 12: a list made in the chat, something shared, a question waiting. From then on the card is "seen", so one the person removed stays off (in the library).
- **Arranging:** hold a card: move it within the page, "Move to the next page" / "Move to the page before" / "Move to a new page", or **Remove from home** (the data stays). Empty pages go.
- **A new account is a blank canvas** (owner's choice: no starter lists, which the server already didn't make): "Your home is empty", **Start building** (opens the chat, which asks what they want to keep track of and sets it up), and the library.
- **Where it's kept:** the layout (pages of card keys, and every key shown) is in the person's Personal space, theirs alone (`GET/PUT /api/me/home`), saved through the outbox so arranging works offline. The first time a home loads after this change, its old pinned cards go on page 1 with Now first, and everything else counts as seen, so nobody's home floods.
- **Not yet:** dragging a card across to another page (the menu moves it), the chat arranging the home ("move spending to page 2"), and chat homes, which keep their own pinned cards.

## 2026-10-16: A practice run that says what to do, with stand-ins (owner: "I created that workflow, and I clicked rehearse it… What am I supposed to do in this? I don't even understand.")

- **It starts from the workflow:** "Rehearse with everyone" opens the practice run on that workflow: its steps in words and one button, **Start**. For a workflow that runs on new records ("when a visitor is added") Start adds a sample record with made-up values (text "Sample …", today's date, the first choice, a link to the first record of the linked list; nothing personal); for one that runs on a change or a date it runs now on the list's newest record; a scheduled one runs now. Then the whose-turn card leads, as before. "What happened" shows above the copy's lists.
- **Stand-ins for roles nobody fills:** in a practice copy, a step that would ask or tell the person in a field (the flat's Resident) when that field is empty, or names someone the space doesn't know, goes to a stand-in for that role, "Resident (stand-in)". It's in the people row like anyone, with its own view ("Made up for this practice run: in real use, the person in that field gets exactly this") and its answers count. Only in practice copies; a real run still asks nobody.
- **Linked records in messages (a real bug, not only practice):** a workflow's message with a link field, "at the gate for {Flat}", came out empty ("at the gate for ."), because links are kept apart from a record's values. It now shows the linked records' titles, and {Link.Field} in a message ({Flat.Resident}) shows that field of the linked records.

## 2026-10-16: Dictation, deleting a workflow, and not finding one (owner's screenshot: the sentence dictated twice; "I can't delete workflows from here… remove it from the workflow screen")

- **Dictation wrote the words twice:** every text box was "controlled" (the app set its text back on each change), which fights iPhone dictation while it's still adding words. The app's one text box (`TextInput` in `packages/cards/src/native/text.tsx`) now keeps its own text. Only changes the app makes on its own reach it: emptied after sending (cleared in place, the keyboard stays up) or filled in (it starts again with that text, focused if it was). What the person types or dictates, and the app's echo of it, never comes back. Every screen keeps using `value` as before.
- **Deleting a workflow:** the assistant's quick mode didn't know workflows and rules are setup work, so it said it couldn't delete one instead of handing over to the careful mode (which can, after a confirm card). Its instructions now name workflows and rules. A workflow's own screen also has **Delete workflow** (two taps), since screens may delete what the chat made.
- **"I've made it" before Confirm (owner's next screenshot):** nothing is made until the person taps Confirm (the server only runs a card's action on the tap), but the reply under a workflow card said "I've made the Visitor approval workflow", which read as if it had already happened. What the model gets back for a card now starts "NOT DONE YET" and tells it to say what the card will do and ask for the tap; the prompt forbids "I've made / added / done" before it. And it does what was asked: asked to delete something it can't find, it says so (with the closest names) and never makes something new instead (it had built a new visitor-approval workflow when asked to delete "mygate").
- **Not found:** before saying a list, workflow or rule doesn't exist, the assistant looks in the person's other spaces, and says which name it found closest (speech-to-text misspells names). It never sends people to a screen or button instead of doing the thing. `PROMPT_VERSION 2026-10-16g`.

## 2026-10-16: "My day" is now "My cards" (owner: "rename my day")

- The home's second page, the person's own pinned cards in the order they keep (Now is the assistant's), was called "My day", which read as if it were about today. It's now **My cards**. Nothing else about the page changes; a home saved on the device shows the new name on its next refresh.

## 2026-10-16: Start over from a GitHub job, never from the app (owner: "having the clearing the data option in the admin panel will be very unsafe… I could clear it by mistake"; scope: "everyone's data and mine also… individual accounts also… only while I'm testing")

- **What it erases:** every account (yours too: everyone signs up again), every space, list, record, card, rule, workflow, chat, memory, group chat, share, search index and inbox, in the dev app or the real one. **What it keeps:** the app's settings (the Google Drive link, alert settings, push keys), the monitoring state, the AI budget (this month's spend still counts against the cap, so a reset can't reopen spending) and the database's migrations. The owner stays the owner (the `ADMIN_EMAILS` secret, not a row).
- **Where it lives:** a GitHub Actions job, "Start over (test phase only)" (`.github/workflows/start-over.yml`), started by hand from the Actions tab. Nothing in the app (no admin button, no API a session or token can reach) can start it.
- **What stops a mistake:** the words ERASE EVERYTHING and today's date in India typed into the job; the real app only from `main`; a backup to Drive first, and in production no erase at all if that backup fails. The Worker's reset path (`/api/internal/reset`) answers only while the job runs: the job sets a one-time `RESET_TOKEN` secret, uses it, deletes it at the end (even after a failure) and checks the path is a 404 again. Without the secret the path is a 404, which a test checks. **While the secret is set the app is closed:** every other request gets a 503 ("being reset"), queued changes are dropped and scheduled jobs skip, so nothing new is written between the backup and the last erase (Codex on the first version: a request mid-run could leave data behind once D1's index to it was gone).
- **How it erases:** the job lists every object that holds data through Cloudflare's API (the deploy token reads them), the Worker erases them in batches of 50 (`wipe()` on each object class: alarm, tables and data gone, the instance thrown away), lists again after each pass (an object's own alarm may still write to another), and only once a pass finds nothing (at most five passes) empties D1 in one transaction. A run that stops part way can be run again. The log shows counts only, never an id's contents.
- **Skipping the backup, by choice (owner, 2026-10-16: "add the skip backup option", after the first real-app run stopped because Google Drive wasn't connected):** the job has a fourth input, "Backup to Google Drive first": **required** (the default, as above) or **skip if it fails**. The backup is still tried either way; with "skip if it fails" a failed backup on the real app is a warning and the erase goes on, and what was erased can't be brought back. Nothing else changes: the words, the date, `main` only, the one-time path.
- **An erase is on disk before the object is thrown away (2026-10-16, the first real run):** every erase came back failed and the same objects still held data on each pass. Throwing the object away right after deleting can lose the delete, so `wipeStorage` now waits for it to be on disk (`storage.sync()`) first; when an erase still fails, the log says why in fixed words (the error class and a category, never its message, which could carry someone's words).
- **Two clean passes count as done (2026-10-16, the third run):** every erase succeeded, yet Cloudflare's listing kept showing the same 19 objects as holding data (an object re-creates its empty tables when it wakes for the erase, and the listing lags). The job now goes on to the database once a pass finds nothing, or once two passes in a row had no failed erase and found no more objects than the one before (a growing count still means something is writing).
- **At go-live the job goes:** the workflow file is deleted (STATUS "Before going live"), and with it the only way to open the path. A person erasing their own account, which the App Store asks for, is a separate, per-person feature for later.

## 2026-10-16: Spaces are the projects (owner: "something like projects in ChatGPT and Claude… maybe we shouldn't call it projects"; "Yes, your spaces idea is fine")

- **What a project is elsewhere:** a folder of chats with its own files and its own standing instructions, so a conversation about one thing starts with that thing known. The app already has the unit for this: a **space** (its own lists, records, cards, people). Rather than a second folder-like thing beside spaces, a space _is_ the project. The name stays "space" in the app.
- **Three things make a space a project, built in this order:**
  1. **Instructions per space** (`PUT /api/spaces/:space/instructions`, `GET /api/spaces/:space`): standing words from the person ("money is always split four ways", "dates are in IST") that go into the system prompt of every chat in that space, never into another space's. Whoever can arrange the space can set them. Only the length is in the audit log.
  2. **Memory per space:** a memory has a `space_id`. One remembered in a space's chat belongs to that space; one remembered in Personal (`space_id` null) is known everywhere. The assistant in a band's chat sees the band's memories and the Personal ones, never another space's. Forgetting works on either.
  3. **Chats per space:** a chat has a `space_id`; `GET /api/chats/current?space=` opens the latest chat of that space (the same two-hour rule) or a new one; `POST /api/chats` takes `space`. In a space's chat every tool that takes a space works there by default (the model can still name another), so "note the PA needs two DI boxes" from the band's chat lands in the band's Notes. The main chat and chats with no space are Personal.
- **A person's own spaces** (`POST /api/spaces`, at most 20, one name once): until now a person had Personal and the spaces behind group chats; now they can make a space for a band, a trip or a house, on their own, from the assistant (`new_space`, a card to confirm) or a screen. Sharing it is the existing people step.
- **Why not a "project" on top of spaces:** one more noun to learn, and two places for the same lists and people. Why not instructions in the one Personal memory with "when in the band…" words: the model would have to sort them per message, and a collaborator with only the band shared would see Personal's words.
- **The phone and web:** the home's pages are the spaces (the next slice): swipe to a band's page and the bar asks in that band's chat; the chats sheet names the space of each chat.

## 2026-10-16: A setup card is checked when it's proposed (owner's screenshot: "Failed. A quick add can't fill in Flat; ask the assistant instead", after Confirm)

- **What was wrong:** the assistant's setup card (a visitor gate for a housing society: Flats, Visitors, a guard's quick add) was only checked when the person tapped Confirm. The check refused the quick add because Flat is a link, and the person got a failure on a card the assistant itself had written, with "ask the assistant instead" as the advice.
- **Now:** a proposed setup is made all the way through inside a transaction that is rolled back (`checkSetup`), before the card exists. Any refusal goes back to the model as a tool error, the way a wrong name does, and the model fixes the proposal (drops the link from the quick add, or makes the field optional) before the person sees anything. The same body (`applySetup`) runs for real on Confirm, so the two can't disagree. Imports and bulk changes already worked this way (`previewImport`, `previewChange`); setups were the gap.
- **The rule a quick add follows** is now in the tool's own words: plain fields only, never a link or a person, every required field included. The real fix for the gate guard is a quick add that can _pick_ a flat from the list; that's a screen feature, next.

## 2026-10-16: One bar (owner: "why have another button when the chat can do the same?"; "if we are offline… it should just work as a search")

- **The home's bar is a text field that searches as you type and asks when you send.** Type, and what you have appears above the bar at once from the device (lists by name, cards by title and rows), then from the server's index a moment later (records and chat messages you can see); tap a match to open it (a card opens its list; a record, the chat about it). Press send, or the "Ask: …" row at the top of the matches, and the words go to the assistant: the chat opens with them already sent (`/chat?ask=…&send=1`). The separate search button and sheet are gone; the tour's "find anything" step points at the bar.
- **Offline it is a search bar and nothing else** (the owner's rule): the send button becomes a magnifier, Return searches, nothing is queued as a message, and a line under the matches says so. Only the device's matches show. The decision comes from `expo-network`'s state; a collaborator without the assistant gets the same search-only bar online too.
- **Why keep instant local search rather than send everything to the model:** a model call costs a few seconds, a few paise and a connection; a name you already know should open in one keystroke, on stage with no signal included (the stage rule). The bar does both without a second button.
- **Not yet:** the keyboard lifting the matches on iOS is the keyboard-room hook's job once a device confirms it; the list screen's own bar stays as it is (it adds to one list).

## 2026-10-16: Chats like Claude (owner: "I want it to work like Claude and ChatGPT"; "very often I need that context beyond 24 messages")

- **What was wrong:** one endless chat, opened at the bottom of everything ever said, and the model given its last 24 messages whatever they were: last week's reminders carried in, something from an hour ago sometimes cut off. The owner felt both.
- **A conversation is the unit, as it is for Claude and ChatGPT.** The app opens on the _current_ chat (`GET /api/chats/current`): the latest one if it was used in the last two hours or is still empty, else a fresh one. "New chat" starts one on purpose. Every chat stays in a list (newest first, grouped by day; the first chat, everything from before, last as "Earlier conversations") and can be continued from there whatever its age. The server already kept several chats (chat-first step 3); the phone now opens on them.
- **The model reads the whole chat, never a count.** `context()` returns every turn. Once a chat passes about 12,000 tokens (48,000 characters), the older turns are folded into a summary by the everyday model (`summariseIfLong`, one call now and then, after the reply is sent, "Tidying up the conversation…" in the progress words), kept in the chat object's meta with the row it covers; the newest six turns stay verbatim, and the summary travels as the first exchange of the conversation. Nothing is lost at a boundary: the next fold reads the previous summary first. Most chats are short, so most requests carry less than before.
- **Why not fold older days under a divider instead:** continuity is memory and the lists, not the thread; a list of chats is the model people know, and it keeps each request small without a cut-off.
- **The home's first frame** (the same conversation: "the upper screen is empty… a user might not know it's loading"): the greeting and the date draw at once, the saved home from the device shows in the first frame with "Updating…" by the date while the fresh one loads, and a first launch shows breathing placeholder cards (`Skeleton`) instead of a blank page. Offline-first rule 17, applied to the home itself.
- **Not yet:** deleting a chat from the sheet (the server has it; a long-press menu next), a title the model writes (the first message names a chat, as before), and the one-bar search (the home slice).

## 2026-10-15: GPT-6 Luna measured, GPT-6.1 Sol waits for the Responses API (owner: "Why didn't we include these models in our tests?")

- **Luna** at the everyday level, three runs of every case: 161/165, equal to Haiku 5.5 on right answers, every Hinglish and date case, about a second slower and roughly three times the cost a message by the run's own counts (`docs/scorecard/2026-10-15-gpt6.md`). Haiku stays the pick; Luna is noted as the first other maker's model that would do the everyday job as well, a fallback should Anthropic's API or price change.
- **Sol** could not be measured: OpenAI's chat-completions endpoint answered 400 on `reasoning_effort` with "low", "none", nothing sent and (2026-10-16, the owner's "try it") "high". Four tries is enough; the next step is the Responses API in the client (`effort: "model"` stays on the entry so a later run sends nothing on chat completions), which would also let the GPT models think with tools. No more scorecard runs on Sol until then.
- **A correction:** the first in-chat figure for Luna (≈ ₹0.19 a message) divided a run's cost by all three repeats; the right reading is ≈ ₹0.57. Scorecard docs quote "per run of the suite" divided by the suite's case count, as the Haiku doc does.

## 2026-10-15: Haiku for every day, Sonnet for setups (owner: "Turn them on")

- **What:** the live app's assistant now uses Claude Haiku 5.5 for everyday messages and Claude Sonnet 5.5 for setups (`AI_EVERYDAY_MODEL`, `AI_SETUP_MODEL` in `wrangler.jsonc`, dev and prod; both `ready: true` in `models.ts`). The owner picked them after the comparison: Sonnet 21 of 21 on the setups scorecard (`docs/scorecard/2026-10-15-setups.md`), Haiku the best of the small models on core and hard and the cheapest frontier one. Each call runs on the owner's prepaid Anthropic credit (no auto-reload) and is also reserved and settled against the app's ₹2,000 monthly cap and the per-person cap, so the cap rules hold unchanged.
- **Fallback, not a cliff:** `modelsFor` puts the picked model first and the other ready, funded models of that level behind it: an everyday message goes to Haiku, and to GLM 4.7 Flash (free) when Haiku fails, the key is missing or the cap is reached; a setup goes to Sonnet, and waits ("needs credit") when it can't. A picked model that isn't funded (no key) isn't offered at all, so "smart available" stays honest.
- **Cost (about):** ₹0.15 a message on Haiku, ₹2.65 a setup on Sonnet; roughly ₹200 a month at today's use, far under the cap. The admin panel's AI section shows the two models ("Claude models: Claude Haiku 5.5 / Claude Sonnet 5.5") and the other makers' keys separately.
- **Not changed:** the comparison keeps running through the scorecard with other models (`model=`, `setup_model=`); Opus for setups waits for the owner's call (about five times Sonnet's price); the OpenAI and Gemini keys stay scorecard-only.

## 2026-10-15: Questions that act, second part: the most picked answer sets a plain field

- **What:** a question in a chat can be about a plain field of a pinned record (one value for everyone: a choice, a text, a date or a date-and-time), not only a personal one. The most picked answer sets the field. The asker chooses how: **Ask me first** (the default: the card shows "Set Dress to Black" to the asker and the chat's admins once one answer is clearly ahead; a tap sends it) or **Set it as the votes come** (`apply: auto`: whenever one answer is clearly ahead and it isn't what was last sent, it's sent). A tie sends nothing. The card shows what was last sent and how it went ("Dress set to Black ✓", "Setting…", "Couldn't set…").
- **Who writes, and as whom:** the record's space writes the field as the person who pinned the record (the share's creator), with their role there deciding (a viewer can't), through `applyFromChat`; the chat queues each send (`poll_apply`) and its alarm sends them in order with a key. A refusal for good (card taken off, field removed, the pinner can't write there any more) is marked failed on the card and dropped; only a conflict is retried. Nothing is written to the space in the request.
- **Answers must fit the field:** the space checks each answer when the question is made (`chatPollField` with the options): a choice's own choices, in the field's spelling; a date or date-and-time the field can store (the stored value is kept with the question); any text. A money, number, link or other field can't be set by a vote (400).
- **Why "ask me" is the default:** the asker is accountable for the record; auto is there for the cases where the vote _is_ the decision (what to wear, which day). Both are the asker's choice on the sheet, per question, never a setting.
- **Phone:** the Ask everyone sheet lists plain fields too ("Dress · Test Taj night"); a choice's answers are its choices, a text or date field takes typed answers (with the date shape shown); the Ask me first / Set it as the votes come chips. The card tells everyone what the question sets and when.
- **Not yet:** schedules (ask again every week), and a question that sets several fields.

## 2026-10-15: A yes/no never set is a no (from the scorecard's `open-reminders` miss)

- **What:** filtering a yes/no field with `eq false` (or `ne true`) finds records that have no value for it as well as those set to no; `eq true` finds only those set to yes. A reminder never ticked is open; the list screen already shows it unticked, so the find tool now agrees.
- **Why:** two models (Cerebras, Haiku) asked for open reminders with `Done = false`, got nothing (the open one had never been set), and told the person there were none. A model making the natural call and being wrong because of our storage is our bug, not a miss. `find-boolean.test.ts`.

## 2026-10-15: Try the small frontier models (owner: "Okay let's try haiku… we should also try an equivalent gpt… Is there an equivalent gemini? Let's compare all three")

- **Why:** the everyday misses that are left (a Hindi day word, weekday arithmetic, a filter that found nothing and gave up) are what small open models get wrong and frontier models don't; no scaffold closes that gap (the prompt already lists the coming week by name and GPT-OSS still slipped). The owner's rule stands: no rule engine for meaning, no date parser. The honest lever is a stronger small model, so it's a cost question, answered by the scorecard.
- **What:** the makers' smallest current models at the everyday level, each on the owner's own prepaid credit and key, called straight: Claude Haiku 5.5 (Anthropic, `ANTHROPIC_API_KEY`, done), then GPT-5.4 nano and mini (OpenAI, `OPENAI_API_KEY`) and Gemini Flash-Lite (Google, `GEMINI_API_KEY`) as the owner adds them. Each is a `MODELS` entry with `ready: false`: the scorecard tries it (`model=` on the workflow), the app doesn't, until one wins and is made ready.
- **Money:** a provider's own credit is the hard stop (no auto-reload anywhere, the owner put in $5 at Anthropic); on our side a Claude call is reserved and settled against the ₹2,000 cap like a paid model (`route: paid`, funded by the key rather than the Cloudflare credit route), so the app's cap applies too. Prices in `models.ts` are the makers' list prices.
- **How OpenAI and Google are called:** the OpenAI chat-completions shape (`client.ts` `callChatCompletions`, the same call Cerebras uses, with a per-maker body: `reasoning_effort: low`, no temperature for the reasoning models), OpenAI at `api.openai.com`, Gemini at the Gemini API's OpenAI-shaped endpoint, so no third conversion is needed. Model ids `gpt-5.4-nano`, `gpt-5.4-mini`, `gemini-3.1-flash-lite` (the makers' current smallest as found 2026-10-15; confirmed by the first run).
- **How Claude is called:** the Messages API with the key (`client.ts` `callAnthropic`): the chat-completions conversation crosses over (`toAnthropic`: system lines as the cached system prompt, tool calls as `tool_use`, replies as `tool_result` in the following user turn) and back (`fromAnthropic`); thinking stays on at `effort: low` (it can't be turned off on these models), room for it in `max_tokens`; a refusal, no credit or a rate limit is a ModelError, so GLM answers. Nothing is logged at the provider by us; the privacy page says messages may go to Anthropic while the comparison runs.
- **How to judge:** three runs of core and hard each, side by side with GLM 4.7 Flash and GPT-OSS at Cerebras: right answers, median time, cost a message. Only then does the owner pick the everyday default and who gets it.

## 2026-10-15: Questions that act (first part; "Ask everyone", next part)

- **A question in a chat can fill in a pinned record.** When the chat has a record pinned ("Chat about this") and that record has a personal yes/no or choice field (one answer per person: "Playing?", "Lift"), an admin, or whoever pinned it, can ask everyone and tie the question to that field (`about`). Each person's answer in the chat becomes their own answer on the record; changing it changes the record, taking it back clears it. The answers offered follow the field: Yes / No / Maybe for a yes/no (Maybe clears), the field's own choices for a choice.
- **The record's space does the writing, with the usual checks.** The chat keeps the answers to send (`poll_out`) and its alarm sends each to the record's space in order, with a key, as that person through the share (`answerFromChat` → the same path as a tap on the shared card: the person must be in the share, the field must be personal). A card taken off, a field removed or a person who left drops their answers quietly. Nothing is written to the space in the request.
- **Why personal fields first:** they're the one kind of field where "Dev said Yes" has an exact meaning with no one deciding for anyone else, so no approval step is needed. Plain fields (one value for everyone: a call time, a date) are the next part, with the asker's Auto / Ask-me choice before the winning answer is applied; schedules after that.
- **Phone:** the Ask everyone sheet shows "Answers fill in" chips when the chat has pinned records with such fields; picking one locks the answers to the field's. The question card says what it fills in.
