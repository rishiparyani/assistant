# Phase 1: core + Gigs module

> **Superseded in part (2026-09-28):** workspaces were replaced by the gig-centric design (docs/design/gig-centric.md); read "workspace" below as history.

## Scope

Core: auth, workspaces (personal + bands), memberships, authorization middleware, operation registry, idempotency, confirm tokens, audit log, API tokens, module enablement, basic notifications, backups.

Gigs module: gigs, clients, venues, fees, payments (partial), expenses, band roster, per-member shares and payouts, outstanding balances (owed to the band and owed to each member), schedule, reports, .ics calendar feed.

Clients: web admin app, Siri Shortcuts, MCP server.

## Out of Phase 1

Songs/setlists/stage mode, offline mode, band sync, MIDI, invoices/GST documents, automatic client reminders, public sign-up, in-app AI assistant (rejected; AI via MCP only), raw-SQL tool for AI (rejected; fixed operations only). Modules beyond `gigs` are out of Phase 1, but the core must not make them hard.

## Clients

### Web app

Dashboard (upcoming gigs, outstanding, this month), gig list/detail with payment timeline and lineup (shares, payouts), clients, forms for gig/payment/expense, reports (monthly, per client, per band, per member, outstanding aging, my earnings across bands), settings (workspaces, members, modules, API tokens). Navigation is built from the enabled modules.

### Siri Shortcuts

Helpers `GA · Config` (API URL + token) and `GA · API Request` (all calls go through it). User-facing: "Next gig", "Gigs this week", "Record payment", "Add gig", "Who owes me", "Who do I owe" (band payouts outstanding), "Record payout". Confirm step before writes. Optional later: Apple's on-device model ("Use Model" action) to parse free-form commands into an action + parameters. Each shortcut documented in `shortcuts/`.

### AI assistants (MCP)

MCP server at `/mcp` with OAuth via Better Auth. Custom connectors in Claude (a project for the assistant), ChatGPT (developer mode), Mistral Le Chat. Gemini consumer app doesn't support custom connectors yet. Tools are generated from operations, so every new module's operations show up automatically (if enabled for the workspace and allowed by scope).

### Notifications (basic)

Web push (iPhone requires home-screen install), email, optional Telegram bot (users connect via a one-time link; bots can't message by username).

## Done when

- All real gigs and payments are managed through it for a month.
- Balances, member shares and payouts match reality.
- Siri and at least one AI assistant read and record safely.
- Nightly backups run and a restore has been tested.
- Adding a second (even trivial) module would need no change to core or clients beyond registration. Check this with a throwaway module in a test.
