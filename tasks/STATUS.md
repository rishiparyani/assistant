# Status

_Updated: 2026-09-26_

## Last done

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

1. **R1 step 7, retire workspaces** (needs the owner's OK before dropping old prod data), then monitoring and alerts (design §10a). Later for the panel: per-action counts, errors and speed via Workers Analytics Engine, and email alerts (design §10a).
2. (done) **R1 step 2, gigs** (design section 12): create/edit gigs with events and people via the API, permissions, version checks.
3. Paused: the rest of T06 (collective views), replaced by R1.
4. Owner, before inviting bandmates: publish the Google app (Google Cloud → Google Auth Platform → Audience → Publish app).

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
