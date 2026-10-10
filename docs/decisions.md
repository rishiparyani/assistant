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
