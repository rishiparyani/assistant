# Status

_Updated: 2026-09-29_

## Last done

- **Gigspree logo** (decision 2026-09-30): the owner's hand-drawn "gs", "leaning, tight" layout, indigo g + amber s. Transparent in the app (sign-in, header, sidebar, loading screens; `--logo` token, light/dark files) and the browser tab (`icon.svg` switches with dark mode); solid indigo for Home Screen and iPhone icons, plus an iOS dark-mode icon. Checked at 390/1280 px in light and dark. The icon files were made from the owner's PNG in a headless browser (split into g and s by colour, recoloured, placed); the script isn't in the repo, so ask for the source art if it needs remaking.

- **Renamed to Gigspree** (decision 2026-09-30): every visible "Assistant" → "Gigspree" (web, iPhone app, sign-in/connect pages, passkey name, MCP title/instructions, calendar feed, alerts, notifications, venue page), new "G" icon (web icons + iPhone app icon). Code names, Workers, bundle ID and the Drive backup folder stay.

- **iPhone app, stage 1** (decision 2026-09-29, `docs/design/ios-app.md`): Capacitor project in `apps/ios` (bundle `in.gigspree.assistant`) showing the live web app; passkey sign-in in the app (`/.well-known/apple-app-site-association`, needs `APPLE_TEAM_ID`); app mode in the web (`core/native.ts`: login without Google, notifications text). `.github/workflows/ios.yml`: simulator screenshots on PRs (local Worker + `apps/ios/test/seed.mjs` fake data), TestFlight upload on main once the Apple secrets exist.
  - Owner steps pending: App ID with Associated Domains, the App Store Connect app, API key + 4 GitHub secrets, TestFlight (docs/setup.md → "iPhone app (Apple)").
  - Next: first TestFlight build → owner checks sign-in with a passkey; then stage 2 (native push, shared on-device database, Siri actions, widget).
  - Gotcha: after `cap sync` the generated `ios/App/App/capacitor.config.json` and `public/` are git-ignored; the workflow syncs with `APP_ENV=local|production`.

- **Offline rule for every agent** (decision 2026-09-29): `AGENTS.md` rule 17 plus a "Adding a new write" guide in `docs/design/offline.md`; every web write not sent through the outbox is marked `// online-only: <reason>`; `apps/web/test/offline-rule.test.ts` (5 checks, runs in `pnpm test`) fails on unmarked writes, `fetch()` in module code, unmarked `fetch()` in core, or an outbox kind with no applier. Checked that it catches both mistakes. `docs/architecture.md` updated.

- **Offline first, stage 2** (decision 2026-09-29, `docs/design/offline.md`): changes made offline.
  - What works offline: notes, lists and items, guests and arrivals, payments, payouts and expenses.
  - How: they go through the outbox (`core/outbox.svelte.ts`), are shown at once (appliers in `modules/gigs/offline-changes.ts`) and sync in order when online. A refused change is listed under "Couldn't sync" with the reason. Sign-out warns about unsynced changes.
  - The server accepts ids made on the device (`clientId` in shared; booking object `newId`).
  - Tests: 1 new worker test, 9 offline-change browser checks, and every earlier suite re-run on a real build (offline 5, walkthrough 10, lists/notes 21, guests 19, plus-ones 2, types 4, multi-user 19, calendar 18).
  - Gotcha: the outbox's `flush` must set its busy flag before the run can finish (fixed; see the comment).

- **Offline first, stage 1** (decision 2026-09-29, `docs/design/offline.md`): the app opens and reads offline.
  - The service worker keeps the app's files: `apps/web/src/sw.js` is the template; the `service-worker` plugin in `apps/web/vite.config.ts` writes `/sw.js` with the build's file list.
  - Upcoming gigs and lists are saved ahead (`modules/gigs/offline.ts`, `core/offline.svelte.ts`).
  - There's an Offline bar, and screens with nothing saved say so ("Not saved on this device yet").
  - Browser-tested against a real build (`pnpm build` + `pnpm --filter @assistant/web preview`): 5 offline checks, plus the earlier suites (54 checks).
  - Gotcha: `vite preview` must be restarted after a rebuild.
  - Next: stage 2 (changes made offline: outbox, instant local changes, "Couldn't sync").

- **Guest shorthand** (2026-09-29, owner: guests are often written "Name +2"): the guest box reads a trailing +N (also "+ 1", "(+3)", "Name, +2") as plus-ones, and pasting several lines (e.g. a numbered WhatsApp list; bullets and numbers are dropped) adds them all at once (`guest-parse.ts`, up to 50). The stepper still works; a +N typed in the name wins.

- **Together page + gig types** (decision 2026-09-29): guest list, lists and notes moved off the gig's tabs to `/gigs/:id/guests|lists|notes`, reached from a "Together" card on the gig page (tabs back to Details · Money · People). Gig types are per person, Public and Private by default, edited in Settings (person object migration 9; `get_gig_types`/`set_gig_types`). Browser checks re-run: lists/notes 21, guests 19, gig types 4, multi-user 19; worker tests 84.

- **Guest lists** (decision 2026-09-29): new Guests tab (tabs: Details · Guests · Lists · Notes · Money · People). Everyone adds their own guests with plus-ones and notes; managers see all, add for anyone, tick arrivals, set total/per-person limits and a closing time, and share a venue link (no sign-in; search, door check-in, print, auto-refresh at `/guests/<token>`) or copy the list as text. Seven operations (`operations-guests.ts`, `services/guests.ts`; link ones app-only), booking object migration 7, core `sharedLinks` hook and `/api/shared/*` routes. Tests: 3 worker tests (`guests.test.ts`), 19 browser checks (player/manager/venue, limits, closing, link reset, old cached gig, 390/820/1280 light and dark).

- **Multi-user functional test** (2026-09-29, local dev, 6 fake users: manager, co-manager, player on the lineup, player on no lineup, stranger, someone invited by email): 19 checks on what each sees with every visibility setting, role changes, removal, payouts and "You were paid", Home/Reports/calendar per person, stranger 404s, players refused manager actions (403), live updates between users. Found and fixed: when two managers edited at once, the second save silently overwrote the first (sheets sent the live-refreshed version); gig, event and lineup sheets now send the version they were opened on, so the second gets "changed by someone else" and keeps their typing.

- **Lists and notes on gigs** (decision 2026-09-29): new Lists and Notes tabs on the gig page (tabs are now Details/Events · Lists · Notes · Money · People). Lists: per gig or per event, tick boxes optional, drag to reorder (touch and mouse), arrow keys, quick add, paste lines to start. Notes: posts for everyone on the gig, author edits, author or manager removes. Setting "Players can add notes and change lists" (default on). Ten operations → REST + MCP tools (`operations-collab.ts`, `services/collab.ts`, booking object migration 6). Also fixed: sheets no longer lose typing when a live refresh arrives. Tests: 5 new worker tests (`collab.test.ts`, MCP list/note test), 21 browser checks (live updates between two users, drag, keyboard, permissions, 390/820/1280 light and dark).

- **Calendar view on Gigs** (decision 2026-09-29): List / Calendar switch (list is the default; the choice is remembered per device). iPhone Calendar look (owner's ask): Sunday first, red month name and today, black circle on the picked day, grey dot on days with gigs, the picked day's gigs listed below with "Add a gig on <day>" (future days; prefills the date via `GigEditor`'s new `date` prop), Today, arrows and swipe; wide screens look like the iPad month view (titles with status dots). India time throughout. `GigEventRow.svelte` is shared by the list and the calendar. Browser-tested (18 checks incl. a 00:30 IST gig with the device in New York, back navigation, swipe, 390/820/1280 light and dark).

- **First-level app test** (2026-09-29, local dev, fake users, headless Chromium): 39 checks across sign-up, gig create/edit, events, people, lineup, money (payment, payout, expense, reversal), cancel with partial refund, mark played, confirm, band flows (invited mate signs up, player view hides fee and lineup, stranger gets 404, live rename, visibility switch), notices on Home, gigs list tabs and search, contacts (learned, add/search/edit/remove, suggestions in the form), reports, settings (calendar feed, Siri token + brief, admin link hidden), admin panel (non-admin 404, admin OK), and no sideways scroll at 390/820/1280 in light and dark. All pass. Fixed: missing space in "Client· phone" on the gig page. Noted, not changed: someone who signs up after being added by email gets no "You're on" notice (the gig does show on Home); a cancelled gig still offers "Record client payment", "Set lineup" and "Add an event". Scripts stay in the agent scratchpad (not in the repo).

- **Move to gigspree.in**: on hold at the owner's request ("ship it where we were shipping till we get gigspree up"). Cloudflare says the zone is active. The config part was taken back out (decision 2026-09-29); to finish: owner deletes imported DNS records for `gigspree.in`/`www`/`dev` and adds the Google origins and redirect URIs (docs/setup.md), then restore the code from commit `152b922` (`git checkout 152b922 -- .github/workflows/deploy.yml apps/web/src/main.ts apps/web/src/core/domain.ts apps/worker/wrangler.jsonc shortcuts/README.md`), deploy dev, verify, PR.

- **Handoff enforced by CI** (decision 2026-09-29): new `Handoff` check fails PRs that change app code without updating this file (a line with only `[skip-status]` in the PR description skips it, with a warning); PR template with the handoff checklist; `AGENTS.md` and `docs/handoff.md` mention both. Owner could make `Handoff` a required check in branch protection (optional; merges are by agents that already wait for green).

- **Notifications (T11)** (decision 2026-09-28): Settings → Notifications (turn on for this device, test, turn off; iPhone hint to use the Home Screen app), "New for you" on Home with mark all read, push-only service worker `/sw.js`. Core `InboxObject` per person (wrangler DO migration v2) and `notify()`; gigs notifies on added / confirmed / changed / cancelled / paid, not for your own changes. Web Push with VAPID and encrypted payloads, keys made by the Worker (no owner step). Tests: 3 new in `notifications.test.ts` (decrypting like a browser, devices, all triggers). Headless Chromium can't subscribe (always "blocked"), so the first real push is the owner's "Send a test".

- **MCP server (T10)** (decision 2026-09-28): `/mcp` with tools from the operation registry, OAuth connect via the consent page, two-step confirm for money/cancel/delete, data fenced as data, `mcp` audit source. Settings → "AI assistants" card (address, Claude and ChatGPT steps). Tests: 3 new in `mcp.test.ts` (full OAuth flow, tools, confirm, retries, access); browser check of consent → code → token → tool call. Owner step: add the connector in Claude (and ChatGPT) with `https://assistant.rishiparyani.workers.dev/mcp`; the old spike connector can be removed.

- **API tokens and Siri Shortcuts (T09)** (decision 2026-09-28): Settings → Siri and Shortcuts (make a token, read or read+change, shown once; list with last used; revoke). Bearer tokens on operation routes only (`requireCaller`, `sessionOnly` ops), audited as `siri`. `get_brief` (spoken answers) and `pick` (choices for Shortcuts). Guide: `shortcuts/README.md` (Next gig, Gigs this week, Who owes me, Who do I owe, Clients who owe, Record payment, Record payout, Add gig). Tests: 4 new in `api-tokens.test.ts`. Calendar feed live on prod ([rishiparyani/assistant#26](https://github.com/rishiparyani/assistant/pull/26)).

- **Calendar feed (T08)** (decision 2026-09-28): Settings → Calendar: turn on, "Add to Apple Calendar" (webcal), copy link (Google steps shown), new link, turn off. `/api/calendar/<token>.ics` with my gigs' events (no money; cancelled/tentative marked). D1 migration `0006_access_tokens` (`access_tokens`, `user_audit`); core hook `calendar` in module definitions; `ctx.sealer`. Tests: 63 worker (4 new in `calendar.test.ts`); browser check at 390/820/1280 light and dark. Address book live on prod ([rishiparyani/assistant#25](https://github.com/rishiparyani/assistant/pull/25)).

- **Address book** (decision 2026-09-28): my clients, venues and people in my person object (schema v7), filled in from gigs I manage (via the summaries, managers only) and by hand; `find_contacts`, `save_contact`, `update_contact`, `remove_contact` (`/api/me/contacts`); in nightly backups. Web: "Contacts" tab (search, kinds, add/edit/remove sheet) and suggestions while typing client, venue or person in the new-gig form (`core/ui/SuggestField`; picking fills phone, city, email/account). Tests: 57 worker (3 new in `contacts.test.ts`); browser walkthrough at 390/820/1280 light and dark.

- **Backups to Google Drive, live on prod** ([rishiparyani/assistant#24](https://github.com/rishiparyani/assistant/pull/24)) (decision 2026-09-28): nightly (~02:30 IST) gzip JSON of D1 (secrets blanked) + every gig object, uploaded by the Worker to "Assistant backups (<env>)" with `drive.file` scope; newest 60 kept; restore (owners, never overwrites); "Backup" alert when failed/overdue; admin panel Backups section (connect, back up now, disconnect, restore). Owner steps in `docs/setup.md` → Google Drive backups. Alerts live on prod (#23).

- **Alerts** (decision 2026-09-28): Worker cron every 15 min runs health checks (updates stuck, failed deliveries; errors and slowness with the analytics token) and sends Telegram messages on change only (production only; admin switch; test button). DLQ consumer records dead letters; admin tool "Retry failed deliveries". D1 migration `0005_alerts` (`app_settings`, `alert_state`, `dead_letters`). Owner step: `TELEGRAM_BOT_TOKEN` secret + send the bot a message.

- **R1 step 7, workspaces retired, live on prod** ([rishiparyani/assistant#22](https://github.com/rishiparyani/assistant/pull/22); prod migrations 5; owner's OK 2026-09-28): old workspace/collective code, old gigs module operations and screens removed; D1 migration `0004_retire_workspaces` drops the 16 old tables (children first); Better Auth organization plugin off; operation registry is user-only with idempotency and audit inside objects. AGENTS.md rules rewritten for the gig-centric model; docs updated (`data-model.md` rewritten). Load test dropped from the plan. Tests: 72 shared, 49 worker; browser walkthroughs (gig flow, cache, live updates) pass.

- **Owner feedback round 1**: gig page tabs (Details / Money / People) with each money list inside its card; cancel with keep or refund of an advance (gig object v5: `payments.kind`); add people from the lineup sheet (the "could only add myself" report: only people on the gig were listed). Monitoring part 1 live on prod (#19; the owner switched on Analytics Engine).

- **Monitoring, part 1**: every API action is counted with its status and duration in Workers Analytics Engine (`core/metrics.ts`, binding `METRICS`, datasets `assistant_dev_metrics` / `assistant_metrics`; ids and numbers only). Admin panel "Actions, last 24 hours" (`GET /api/admin/operations`) reads them once the optional `ANALYTICS_TOKEN` secret exists. Live updates (#18) and device cache (#17) are on prod.

- **Smooth app, step 2: live updates**: `GET /api/live` WebSocket to the person object (hibernating; `setWebSocketAutoResponse` answers pings), which sends `gig_changed` after applying a summary; module hook `live` in `ModuleDefinition`, origin check in core. Web: `core/live.ts` connects while visible and signed in, reconnects with back-off, refreshes on-screen queries (bunched). Two-browser check: a co-manager's payment shows on the other's open gig page in ~1.9 s, Home too. Tests: 108 worker (2 new in `live.test.ts`).
- **Smooth app, step 1** live on prod (#17).

- **Smooth app, step 1: device cache** (decision 2026-09-28): screens show their last data at once and refresh behind (`core/query.svelte.ts`, used by Home, Gigs, gig page, Reports); the app opens with the saved user; pull to refresh; refresh when returning to the app; sign-out clears saved data. Measured with a 4 s server delay: Home back in 0.07 s, cold start to Home 0.6 s. Also: the home-screen app reloads itself when a new version is deployed (#16).

- **R1 steps 4–6 live on prod** ([rishiparyani/assistant#15](https://github.com/rishiparyani/assistant/pull/15); prod health migrations 4, new routes 401 signed out). **R1 step 6, screens**: new navigation (Home, Gigs, Reports, Settings; no workspace switcher) and pages on the gig API: Home (`booking/Home.svelte`), Gigs list with search, gig page (events with lineups, people, client payment, shares and payouts, expenses and net, who-sees-what switches, status actions), New/Edit gig (events, people by email or name, collective with autofill, tags, duplicate warnings), Reports (period, role, collective, tag). Loading states (owner's request): splash in `index.html` before the app starts, labelled placeholders, top progress bar while requests are in flight (`core/activity.svelte.ts`, `TopProgress`). Browser walkthrough (create → lineup → payment → payout → expense → setting → player's view) and screenshots at 390/820/1280, light and dark, no overflow or page errors. Old workspace pages still work by URL (`/w/...`) until step 7.
- Review fixes on steps 4–5 (Codex): tags reach the shared registry only after the gig accepts the edit; Home filters cancelled events in the query; reports load tags for the date range only.

- **R1 step 5, tags, autofill, people without accounts, duplicate warnings** (API; screens in step 6): collective and custom tags on gigs (D1 tag registry, migration `0003_gig_tags`), report filters by collective and tags, `find_my_tags`, `suggest_gig_people` (autofill), `check_gig_duplicates` (month index, only people I've played with), people added by email attach on sign-up (D1 `pending_people`, core hook `userCreated`, Home retries). Gig object v4, person object v6, month index v2. Tests: 73 shared, 106 worker (4 new in `booking-tags.test.ts`).

- **R1 step 4, Home and reports** (API; screens in step 6): `get_home` (`/me/overview`), `get_my_report` (`/me/report`), search and status filter on `find_my_gigs`. All from the caller's own person object (schema v5 adds client, type and payouts to `my_gigs`). Tests: 73 shared, 102 worker (3 new in `booking-home.test.ts`).

- **R1 step 3, money, live on prod** ([rishiparyani/assistant#14](https://github.com/rishiparyani/assistant/pull/14); API only, screens in step 6): gig fee and who-sees-what settings on create/update, client payments and payouts (append-only, reversals), expenses, per-event lineup with part and share (per person, equal split or percent), people picked by id or exact name (near matches → candidates). Every gig response has `money` filtered by role and settings; person summaries gain my part/share per event and a `my_gigs` row with my money (and the gig's money for managers). Person object schema v4, gig object schema v3. Tests: 73 shared, 99 worker (3 new in `booking-money.test.ts`).

- **Admin panel live on prod** ([rishiparyani/assistant#13](https://github.com/rishiparyani/assistant/pull/13)): `/admin` (link in Settings, admins only; others get 404). Owners from the `ADMIN_EMAILS` GitHub secret (added by the owner 2026-09-28; the deploy workflow copies it into the Worker), more admins added in the panel (D1 `admins`), admin actions in D1 `admin_audit` (migration `0002_admin`, which also indexes `user.createdAt` and `session.updatedAt`). Shows counts only: people (accounts, sign-ups, active), gigs created, delivery backlog; tools: flush outboxes, rebuild summaries. Modules contribute via `admin` in their definition. Tests: 96 worker (4 new in `admin.test.ts`).

- **R1 steps 1–2 live on prod** ([rishiparyani/assistant#12](https://github.com/rishiparyani/assistant/pull/12); verified: health OK, new routes answer 401 signed out). **Step 2, gigs API**: `/api/gigs` create/get/update/status/delete/history, events and people with manager/player roles, version checks, `/api/me/gigs` from person summaries; idempotency and audit inside each gig; retried creates reach the same gig; registry option `idempotency: "object"` and `ctx.objects` (Durable Object namespaces only); old gig tools renamed `legacy_*`. Tests: 73 shared, 92 worker (8 new in `bookings.test.ts`).

- **R1 step 1, foundation** (branch; no visible change): Durable Objects for gigs, people, month indexes and pending lists, with per-object migrations, idempotency and audit inside the gig, the outbox → `summaries` queue → consumer path (combining per gig, sequence numbers, dead letter queue), retries that never give up, flush and rebuild tools; deploy workflow creates the queues; tests: 73 shared, 84 worker (9 new in `objects.test.ts`). See `docs/architecture.md` → Gig-centric storage.

- **Design approved: gig-centric, scale-ready** (`docs/design/gig-centric.md`, learning notes `docs/learn/scale.md`, decision 2026-09-28): gigs with events, per-gig roles, collective as a tag, Durable Objects per gig/person/month index, outbox → Cloudflare Queue, monitoring and email alerts. Build started (R1 step 1).

- **Collective settings live on prod** ([rishiparyani/assistant#11](https://github.com/rishiparyani/assistant/pull/11)): per-collective Gigs settings on the Collective page (owners change, members see): who sees who's playing, who can set the lineup, who can record payouts (owners only / everyone). Enforced in services (`set_gig_lineup`, `record_payout`, `reverse_payout`, `create_musician`), `get_gig_money` returns `permissions`; the gig page follows them. Stored in `workspace_modules.settings_json`. Tests: 73 shared, 75 worker.
- **Me Home live on prod** ([rishiparyani/assistant#10](https://github.com/rishiparyani/assistant/pull/10)).

- **T06 part 1, Me Home**: `gigs.get_my_home` (user-scoped read: upcoming gigs I play, earned/received this month, owed to me per collective and from clients in my personal space, what I owe musicians in collectives I own, collectives where I'm not on the roster); Home at `/` is this view, `/w/:id` opens that workspace's gigs. Members see the gig lineup (names, roles) without others' amounts. Core: module `hooks.memberJoined` (committed with the core write, audited under the module) and user-scoped module reads; gigs puts people on the roster when they join (links an unlinked entry with the same email, else creates one); one account can't be linked twice per collective (409). "Collective" is the product word (PR #9). Tests: 72 shared, 70 worker.

- Repo setup from the project brief (no application code): `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/`, `tasks/`, folder structure, root configs.
- Architecture made flexible: a small core plus feature modules, with Gigs as module one (see `docs/modules.md` and the decision in `docs/decisions.md`).
- Decisions recorded: per-member shares and payouts in Phase 1 (T02/T05 updated); no further modules planned yet.
- Added `docs/setup.md` (deploys via GitHub Actions, where secrets live, owner's manual steps, free-tier limits) and public-repo safety rules in `AGENTS.md` and `docs/security.md`.
- **U1 live on prod** ([rishiparyani/assistant#8](https://github.com/rishiparyani/assistant/pull/8)): Gigs list (upcoming/past/all, search, month groups), gig detail (status actions, payment card with progress, payments with reverse, lineup with shares and payout status, payouts with reverse, expenses, totals; two columns ≥1100 px; members see only "Your share"), add/edit gig sheet (inline client/venue creation, end time past midnight = next day), lineup sheet (equal / percent / amount with live preview), payment/payout/expense sheets, People (clients with gig history, venues, roster linked to member accounts; roster owner-only). Core UI: Picker, PickerField, Stat, styled confirm dialog. Browser E2E (sign in → gig → payment → lineup → payout → expense → reverse → edit → cancel/delete) and screenshots at 390/820/1280 light/dark checked locally.
- **U0 live on prod** ([rishiparyani/assistant#7](https://github.com/rishiparyani/assistant/pull/7)); owner feedback on the look pending: design system in `apps/web/src/core/ui/` (tokens light/dark, Inter, Lucide icons; Button, fields, ListGroup/ListRow, Card, Pill, Segmented, Sheet, Toast, EmptyState, Skeleton, Avatar, PageHeader), app shell (phone: top bar + tab bar; ≥768px: sidebar), workspace switcher, workspace-scoped routes (`/w/:id/...`), PWA manifest + icons; login, consent, invite, home (upcoming gigs), band, settings rebuilt. Gigs/People tabs show a placeholder until U1.
- **T05 live on prod** ([rishiparyani/assistant#6](https://github.com/rishiparyani/assistant/pull/6)): payments with reversals, expenses, roster, lineups with equal/percent/fixed shares, payouts with reversals, `get_gig_money` (derived balance/status/owed/unallocated/net; member visibility). Shared: `paymentStatus`, `splitEqual`, `splitPercent` (table-tested). Tests: 72 shared, 66 worker.
- **T04 live on prod** ([rishiparyani/assistant#5](https://github.com/rishiparyani/assistant/pull/5)): operation registry (routes, validation, idempotency, audit via `ctx.commit`), T03 routes moved onto it, gigs module clients/venues/gigs with soft delete, cursor pagination, name resolution with candidates, status transitions. Shared: IST date helpers, pagination, gigs schemas. Tests: 53 shared, 54 worker (incl. isolation, idempotency, ambiguity, throwaway module).
- **T03 live on prod** ([rishiparyani/assistant#3](https://github.com/rishiparyani/assistant/pull/3); verified: Google sign-in redirects to the prod callback, `/api/me` 401 without session, migrations 2): Google + passkey sign-in, personal workspace on sign-up, band workspaces, invite links, remove members, `requireUser`/`requireWorkspace` middleware, audit entries, Better Auth org endpoints blocked. Web: login, consent (for MCP), workspaces, workspace detail with invites, invite accept, settings with passkeys. Tests: 35 worker (isolation, roles, invite flow, module check, schema guard incl. passkey table) + a two-browser E2E run locally (owner invites, bandmate joins, owner removes).
- **T02 live on prod** via [rishiparyani/assistant#1](https://github.com/rishiparyani/assistant/pull/1) + smoke-test fix [rishiparyani/assistant#2](https://github.com/rishiparyani/assistant/pull/2) (prod D1 `assistant` created; `/api/health` → `migrations: 1`). Verified on dev 2026-09-26 ( D1 `assistant-dev` created by the workflow, `/api/health` → `migrations: 1`): Drizzle schema for core, Better Auth and gigs tables (`0000_init.sql`), CHECK constraints, indexes, D1 in wrangler (dev + prod) and the deploy workflow, `ulid`/money helpers. Tests: 34 shared, 23 worker (schema, constraints, index usage via EXPLAIN, Better Auth schema guard).
- **T01 done**: pnpm workspace with catalog, `packages/shared`, `apps/worker` (Hono, core with module registry, `/api/health`), `apps/web` (Svelte 5 SPA via the Cloudflare Vite plugin), ESLint + Prettier, CI (`ci.yml`) and deploy (`deploy.yml`) workflows. Root `pnpm typecheck`, `lint`, `test`, `build` all pass locally; the web app was checked in a headless browser.
- **T00 done** (2026-09-26): all ACs met; results in `docs/decisions.md`. Spike in `spikes/t00/` (see its README) with deploy workflow `.github/workflows/spike-t00.yml`. Verified here: typecheck, 3 vitest tests (workspace with `kind`, invite + accept second member, stranger denied, full MCP OAuth flow with JWT verification), and the same flow against `wrangler dev` with local D1.
- Original brief archived in `docs/archive/gig-assistant-brief.md`.

## Next

1. All planned tasks (T08–T12, address book) are live on prod (T09 + T10 + T11 merged in [rishiparyani/assistant#27](https://github.com/rishiparyani/assistant/pull/27) with the owner's OK, 2026-09-29; prod migrations 8). Next: owner feedback. Owner to try: notifications "Send a test" on the iPhone Home Screen app (never tested on a real device), connect Claude to `/mcp`. Owner steps still open: `TELEGRAM_BOT_TOKEN` + message the bot; Drive API + redirect URIs + Connect in the admin panel; publish the Google app; optional `ANALYTICS_TOKEN`.
2. (done) **R1 step 2, gigs** (design section 12): create/edit gigs with events and people via the API, permissions, version checks.
3. Paused: the rest of T06 (collective views), replaced by R1.
4. Owner, before inviting bandmates: publish the Google app (Google Cloud → Google Auth Platform → Audience → Publish app).

## Gotchas (for any agent)

- iOS simulator screenshots take ~20–45 s each on GitHub's Mac runner. Keep the set small (`.github/workflows/ios.yml`: full set on the large iPhone, three light shots on the small one); the step has a 25-minute limit.
- `pnpm -s typecheck | grep error` can hide a failure: check the **exit code** (`pnpm typecheck; echo $?`) before pushing. CI caught one this way.
- Tests must not assert on short numbers that can appear inside ULIDs (e.g. `not.toContain("50")`); assert on the real strings.
- Changing a Durable Object's migrations bumps its schema version: update the version check in `apps/worker/test/objects.test.ts`; a new D1 migration bumps `migrations` in `test/health.test.ts`.
- A new Durable Object class needs a binding and a new `migrations` tag in **both** envs of `wrangler.jsonc`, an export in `src/index.ts`, then `pnpm --filter @assistant/worker types`.
- Local dev: `pkill -f vite` also kills your own shell; stop old servers by PID. Email/password sign-up works only on localhost (tests, local browser checks), not on dev.
- Headless Chromium always reports notifications as blocked, so real push subscribe can't be tested in a browser script.
- Anything that adds a way to reach data from outside the app (tokens, OAuth, push) is a security change: open the PR and wait for the owner's explicit OK before merging.

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
- [ ] Google app published (needed before bandmates can sign in with Google)
- [ ] GitHub secret scanning, push protection, Dependabot alerts enabled; fork PR workflows require approval
- [x] `main` created (2026-09-26)
- [x] `main` set as default branch; ruleset `main` active (pull request required, no deletion, no force-push); verified via API 2026-09-26
- [x] GitHub Environment `production` limited to `main` (owner reported; not readable via the API from agent sessions)
- [x] Claude custom connector added (`Assistant`, pointing at the spike)

## In progress

Nothing. The spike stays deployed at https://assistant-spike.rishiparyani.workers.dev (Claude connector `Assistant` points at it) until T10 replaces it.

## Gotchas

- Durable Object alarms fire by themselves in tests right after `setAlarm(now)`; to observe a failed hand-over, break the queue binding (`runInDurableObject`, replace `env.SUMMARIES`) before the change, then use `runDurableObjectAlarm` to force a retry.
- Month-index objects are shared by every gig with events that month; in tests, filter cards by gig id.
- Interfaces don't satisfy `SqlStorage.exec<T>`'s record constraint; use `type` aliases for row shapes.

- "Collective" is the product word for a shared workspace; code and data say `band`. Use "collective" in UI copy and operation descriptions.

- `CLAUDE.md` is a symlink; on Windows without symlink support replace it with a file containing `@AGENTS.md`.
- **The repo is public.** No secrets or real personal data anywhere; see `docs/security.md#public-repository`.
- `main` created 2026-09-26 at the T01 commit; prod deployed via manual `workflow_dispatch` (https://assistant.rishiparyani.workers.dev).
- Right after `wrangler deploy`, requests can hit the previous version for several seconds, even after one request saw the new one: the smoke test retries its whole set of checks together.
- `wrangler secret` ignores the Vite build's redirected config: the deploy workflow passes `--name` explicitly.
- CSS grids: give single-column grids `grid-template-columns: minmax(0, 1fr)`; an implicit `auto` column grows to fit unwrapped (ellipsised) row text and pushes the page sideways on phones. `ListGroup` and `Card` set `min-width: 0` for the same reason.
- Forms inside sheets need unique ids (`$props.id()`): two sheets of the same component on one page otherwise submit each other's form.
- UI screenshots: run `pnpm dev`, sign up with the localhost email form, seed data through `/api` with `fetch` from the page, then capture with Playwright at 390 / 820 / 1280 px (see git history of this note for the script idea). Headless Chromium here can't load `*.workers.dev` through the sandbox proxy (TLS/retry errors); verify live apps with curl, and run browser tests against `pnpm dev`.
- Pushing a new branch whose commit already exists on the default branch doesn't trigger path-filtered workflows (no changed files). Run the workflow manually (Actions → Deploy → Run workflow).
- Better Auth docs site (better-auth.com) is blocked from agent sessions; read the types in `node_modules/@better-auth/*/dist/*.d.mts` instead.
- `@better-auth/oauth-provider`: `/auth/oauth2/consent` returns `{ url }` (not `redirect_uri`). Access tokens are JWTs only when the client sends `resource`; the spike falls back to `/oauth2/userinfo` for opaque tokens.
- Better Auth tables keep camelCase columns; IDs are ULIDs. If a Better Auth upgrade adds columns, `test/auth-schema.test.ts` fails: update `auth-schema.ts`, run `pnpm db:generate`.
- The Vite dev server and `wrangler` share local D1 state in `apps/worker/.wrangler/state` (`persistState` in `apps/web/vite.config.ts`).
- Agent sessions can reach `*.rishiparyani.workers.dev` (custom network allowlist, 2026-09-26): verify live apps with curl or headless Chromium.
- **Workflow since `main` is protected:** work on a branch (deploys to dev); when a task is done and verified, open a PR to `main` and merge it after CI passes (owner OK'd, 2026-09-26), then tell the owner what went live.
- Agent sessions can't reach `api.cloudflare.com` (network policy), and shouldn't: deploys go through GitHub Actions only.

- Any `$state` changed by the API client (like the request counter) must be changed inside `untrack`, or every `$effect` that starts a request re-runs forever and freezes the page.
- A form used twice on one page (payment and payout sheets) needs unique field ids (`$props.id()`), or labels point at the other copy.
