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

| Part      | Field it takes                                 | What it shows                                                                                            |
| --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `date`    | date or date-time                              | A calendar tile (OCT / 17); today's is coloured, past ones are faded                                     |
| `details` | up to 3, any type                              | A line under the title ("Sat · 6 pm · ● Vibe Tribe"); a choice shows with its colour dot                 |
| `pills`   | up to 2: money, number, choice, text or yes/no | Highlighted pills ("₹5,000")                                                                             |
| `callout` | text or long text, plus an optional label      | A highlighted box when it has something ("To do: …")                                                     |
| `action`  | text                                           | A button on the right: `directions` (an address, opens maps), `call` (a phone number) or `open` (a link) |

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
