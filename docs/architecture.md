# Architecture

## Shape

One Cloudflare Worker on one domain (e.g. `app.<domain>`):

| Path      | What                                                         |
| --------- | ------------------------------------------------------------ |
| `/api/*`  | REST API (JSON), generated from module operations            |
| `/auth/*` | Better Auth (sessions, Google, passkeys, magic links, OAuth) |
| `/mcp`    | MCP server, tools generated from the same operations         |
| `/*`      | Static web app (Vite + Svelte SPA, PWA in Phase 2)           |

Clients (web app, Siri Shortcuts, Claude/ChatGPT/Le Chat via MCP) hold no business logic. They call operations.

```
 web app ─┐
 Siri ────┼─► Worker ─► auth middleware ─► operation ─► service ─► D1
 MCP ─────┘              (user, objects,    (Zod in/out)  (ctx-scoped)
                          role, module, scope)                └─► audit_log
```

## Gig-centric storage (R1, in progress)

The app is moving to the design in [design/gig-centric.md](design/gig-centric.md). Built so far (step 1, no visible change yet):

- `apps/worker/src/core/objects/`: helpers every Durable Object uses: per-object schema migrations (`migrate`), audit (`_audit`), idempotency (`idempotent`, `_idempotency`, 24 h), the one-row outbox (`bumpAndNote`, `clearOutbox`, retry delays 2 s → 1 h, never giving up), and `ObjectError` (codes travel through Workers RPC and become `AppError`s at the edge).
- `apps/worker/src/modules/gigs/objects/`: `BookingObject` (`booking:<gig id>`; minimal gig, events, people, roles, version check), `PersonObject` (`person:<user id>`; summary rows), `MonthIndexObject` (`index:<YYYY-MM>`; event cards by date and the registry of gigs created that month), `PendingObject` (`pending:<0-3>`; gigs whose note couldn't be sent), and `delivery.ts` (queue consumer, `flushOutboxes`, `rebuildSummaries`).
- Flow: a change writes its outbox note in the same transaction → the gig's alarm registers the gig (first time) and sends `{gig_id, seq}` to the `summaries` queue → the consumer combines messages per gig, reads the gig's current summaries once, and replaces that gig's rows in each person and month index, ignoring older sequence numbers.
- Config: `apps/worker/wrangler.jsonc` (bindings `BOOKINGS`, `PEOPLE`, `MONTHS`, `PENDING`, queue `SUMMARIES` → `summaries-dev` / `summaries`, dead letter `-dlq`); the deploy workflow creates the queues. Tests: `apps/worker/test/objects.test.ts`.

## Core and modules

The Worker is split into **core** and **modules**. Full contract: [modules.md](modules.md).

**Core** (`apps/worker/src/core/`) knows nothing about gigs:

- Auth (Better Auth), users; roles live on each gig (manager/player), checked inside the gig's object
- Sign-in middleware and the service context `{db, user, objects, source}`
- Operation registry → REST routes + MCP tools
- Idempotency keys, confirm tokens (two-step writes), audit log
- API tokens with scopes (T09)
- Notifications (web push, email), calendar feed plumbing, backups
- Shared helpers: ULIDs, money (paise), dates (UTC stored, Asia/Kolkata displayed), pagination, errors

**Modules** (`apps/worker/src/modules/<name>/`) own their tables, services and operations:

- `gigs` (Phase 1): clients, venues, gigs, payments, expenses, views, .ics events
- `music` (Phase 2, provisional name): songs, charts, setlists
- Later: anything else the user wants help with (see [roadmap.md](roadmap.md))

## Stack and why

| Piece      | Choice                                                                           | Notes                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Compute    | Cloudflare Workers                                                               | Free plan; 10 ms CPU limit per request shapes some choices (no password hashing).                                         |
| Data       | Cloudflare D1 (SQLite)                                                           | Billed per rows read/written, no idle compute. Includes auth tables.                                                      |
| Auth       | Better Auth in the Worker                                                        | Google, passkeys, email magic links. OAuth provider for MCP connectors. No organizations (workspaces retired 2026-09-28). |
| ORM        | Drizzle                                                                          | Schema + versioned migrations for D1.                                                                                     |
| Routing    | Hono                                                                             |                                                                                                                           |
| Validation | Zod                                                                              | Schemas in `packages/shared`, used by Worker and web app.                                                                 |
| Web        | Vite + Svelte SPA                                                                | Offline-first PWA: opens and reads offline, queues changes and syncs them (docs/design/offline.md).                       |
| Files      | R2 (backups, small app files), Google Drive (large media, links only in Phase 1) |                                                                                                                           |
| Email      | A free-tier email service                                                        | Magic links, summaries.                                                                                                   |
| Tooling    | TypeScript, pnpm workspaces, Vitest (Workers pool), GitHub Actions               |                                                                                                                           |

Target recurring cost: the domain only. Decision history: [decisions.md](decisions.md).

## Environments

Separate dev and prod D1 databases (and R2 buckets). Local dev uses `wrangler dev` with a local D1. Deploy on merge to `main` via GitHub Actions.

## Designing for later moves

- Each gig, person and month index is its own small database (Durable Object), so growth spreads across many objects instead of one shared database (docs/design/gig-centric.md).
- Operations are defined once, so a new client (e.g. a Telegram bot, WhatsApp) is another adapter, not new logic.
- Modules are independent, so a module can be disabled, rewritten or removed without touching others.
