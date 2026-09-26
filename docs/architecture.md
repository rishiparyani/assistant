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
 MCP ─────┘              (user, workspace,   (Zod in/out)  (ctx-scoped)
                          role, module, scope)                └─► audit_log
```

## Core and modules

The Worker is split into **core** and **modules**. Full contract: [modules.md](modules.md).

**Core** (`apps/worker/src/core/`) knows nothing about gigs:

- Auth (Better Auth), users, workspaces, memberships, roles
- Authorization middleware and the service context `{db, user, workspace, source}`
- Operation registry → REST routes + MCP tools
- Idempotency keys, confirm tokens (two-step writes), audit log
- API tokens with scopes, module enablement per workspace
- Notifications (web push, email), calendar feed plumbing, backups
- Shared helpers: ULIDs, money (paise), dates (UTC stored, Asia/Kolkata displayed), pagination, errors

**Modules** (`apps/worker/src/modules/<name>/`) own their tables, services and operations:

- `gigs` (Phase 1): clients, venues, gigs, payments, expenses, views, .ics events
- `music` (Phase 2, provisional name): songs, charts, setlists
- Later: anything else the user wants help with (see [roadmap.md](roadmap.md))

## Stack and why

| Piece      | Choice                                                                           | Notes                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Compute    | Cloudflare Workers                                                               | Free plan; 10 ms CPU limit per request shapes some choices (no password hashing).                                          |
| Data       | Cloudflare D1 (SQLite)                                                           | Billed per rows read/written, no idle compute. Includes auth tables.                                                       |
| Auth       | Better Auth in the Worker                                                        | Google, passkeys, email magic links. OAuth provider for MCP connectors. Organization plugin as workspaces (verify in T00). |
| ORM        | Drizzle                                                                          | Schema + versioned migrations for D1.                                                                                      |
| Routing    | Hono                                                                             |                                                                                                                            |
| Validation | Zod                                                                              | Schemas in `packages/shared`, used by Worker and web app.                                                                  |
| Web        | Vite + Svelte SPA                                                                | Becomes the offline PWA in Phase 2.                                                                                        |
| Files      | R2 (backups, small app files), Google Drive (large media, links only in Phase 1) |                                                                                                                            |
| Email      | A free-tier email service                                                        | Magic links, summaries.                                                                                                    |
| Tooling    | TypeScript, pnpm workspaces, Vitest (Workers pool), GitHub Actions               |                                                                                                                            |

Target recurring cost: the domain only. Decision history: [decisions.md](decisions.md).

## Environments

Separate dev and prod D1 databases (and R2 buckets). Local dev uses `wrangler dev` with a local D1. Deploy on merge to `main` via GitHub Actions.

## Designing for later moves

- `workspace_id` on every tenant row + ULIDs + a single scoped data layer means moving a band to its own database later is a data migration, not a rewrite.
- Operations are defined once, so a new client (e.g. a Telegram bot, WhatsApp) is another adapter, not new logic.
- Modules are independent, so a module can be disabled, rewritten or removed without touching others.
