# Modules

The assistant is a core plus modules. Gigs is the first module; the aim is that helping with a new kind of task means adding a module, not reworking the core or the clients.

## What a module is

A folder in each package, named the same:

```
packages/shared/src/modules/<name>/   Zod schemas + types for inputs/outputs
apps/worker/src/modules/<name>/
  schema.ts        Drizzle tables (module-owned)
  services/        business logic, takes ctx {db, user, workspace, source}
  operations.ts    operation definitions (see below)
  index.ts         module manifest: id, name, tables, operations, optional hooks
apps/web/src/modules/<name>/           screens, forms, nav entries
```

Migrations stay in one sequence for the whole database (`apps/worker/migrations/`); D1 has one schema.

## Operations: define once, expose everywhere

Every action is one **operation**. The core turns each into a REST route and an MCP tool, and the web app and Siri call the REST route.

```ts
// shape only, finalised in T04/T10
defineOperation({
  id: "gigs.record_payment",      // <module>.<action>, unique
  tool: "record_payment",          // MCP tool name, unique across modules
  http: { method: "POST", path: "/gigs/:gigId/payments" },
  kind: "write",                   // read | write
  confirm: true,                   // two-step from MCP (money, cancel, delete)
  scopes: ["gigs:write"],          // API token scopes required
  roles: ["owner", "member"],
  input: RecordPaymentInput,       // Zod, from packages/shared
  output: PaymentView,             // Zod, includes display strings
  description: "Record a payment received for a gig.", // shown to AI assistants
  handler: (ctx, input) => payments.record(ctx, input),
});
```

The core wraps every operation with: auth → membership/role → module enabled → token scope → Zod validation → idempotency (writes) → confirm token (if `confirm` and source is MCP) → handler → audit log.

## Rules

1. A module depends on core. It never imports another module's `schema.ts` or internals; it may call another module's exported service functions (e.g. `music` reading a gig to link a setlist).
2. Core never imports a module. Modules are registered in one list (`apps/worker/src/modules/index.ts`).
3. Every module table has `id` (ULID), `workspace_id`, timestamps, indexes on filtered columns, and `deleted_at` for user-facing entities. Table names are plain and descriptive (`gigs`, `payments`); prefix only on a real name clash.
4. Operation ids are `<module>.<action>`; scopes are `<module>:read` / `<module>:write` (finer scopes allowed).
5. Responses are LLM-friendly: names and display strings, not just IDs.
6. Modules can be switched on or off per workspace (`workspace_modules`). A personal workspace and a band workspace can use different modules.
7. Anything two modules need (people/contacts, money, dates, attachments, reminders) is promoted into core **only when the second module actually needs it**, with a decision recorded. Until then it stays in the module that uses it.

## Adding a module (checklist)

1. Record a decision in `docs/decisions.md` (what, why, what data it holds).
2. Add schemas in `packages/shared`, tables + migration, services with tests (including the cross-workspace access test), operations.
3. Register it in the module list; add web screens; add Siri Shortcuts or MCP notes if relevant.
4. Update `docs/data-model.md`, `docs/api.md`, `docs/roadmap.md`, and `tasks/`.

## Current modules

| Module | Status | Holds |
| --- | --- | --- |
| `gigs` | Phase 1 | clients, venues, gigs, payments, expenses |
| `music` | Phase 2 (planned) | songs, chart revisions, arrangements, setlists |
| others | ideas, see [roadmap.md](roadmap.md) | |
