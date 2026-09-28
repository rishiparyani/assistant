# Modules

The assistant is a core plus modules. Gigs is the first module; the aim is that helping with a new kind of task means adding a module, not reworking the core or the clients.

## What a module is

A folder in each package, named the same:

```
packages/shared/src/modules/<name>/   Zod schemas + types for inputs/outputs
apps/worker/src/modules/<name>/
  schema.ts        Drizzle tables (module-owned)
  services/        business logic, takes ctx {db, user, objects, source}
  objects/         the module's Durable Object classes (data, idempotency, audit)
  operations.ts    operation definitions (see below)
  index.ts         module manifest: id, name, tables, operations, optional hooks
apps/web/src/modules/<name>/           screens, forms, nav entries
```

Migrations stay in one sequence for the whole database (`apps/worker/migrations/`); D1 has one schema.

## Operations: define once, expose everywhere

Every action is one **operation**. The core turns each into a REST route and an MCP tool, and the web app and Siri call the REST route.

```ts
// apps/worker/src/modules/<name>/operations.ts (real example: modules/gigs/operations.ts)
defineOperation({
  id: "gigs.create_client", // <module>.<action>; module "core" for core operations
  tool: "create_client", // MCP tool name (T10), unique across modules
  description: "Add a client (the person or company booking gigs).", // shown to AI assistants
  kind: "write", // read | write
  role: "owner", // optional minimum role (default member)
  confirm: true, // optional: two-step from MCP (money, cancel, delete), T10
  http: { method: "POST", path: "/clients", status: 201 }, // → POST /api/clients
  input: CreateClientInput, // Zod schema from packages/shared; path params/query/body are merged in
  handler: (ctx, input) => clients.createClient(ctx, input),
});
```

The registry (`apps/worker/src/core/operations.ts`) wraps every operation with: session → membership/role → module enabled → Zod validation → idempotency (writes need an `Idempotency-Key` header; repeats replay the stored response) → handler → audit log. Token scopes (T09) and confirm tokens (T10) plug into the same wrapper.

**Writing:** handlers never call `d1.batch` or write audit rows themselves. They build prepared statements and call `ctx.commit(statements, change)`; the wrapper adds the audit entry (module, action, actor, source, before/after) and runs everything in one D1 batch. Read operations can't commit.

**Access:** the wrapper only checks sign-in. Which data a person may see or change is decided by the object that owns it (for gigs: the person's role on that gig).

**Hooks:** `defineModule({ hooks: { userCreated } })` runs after sign-up (gigs attaches gigs that added the person's email). Modules can also contribute `queues`, `admin` sections and tools, and `live` (the WebSocket for live updates).

**Registering:** export the operations from the module and pass them to `defineModule({ ..., operations })`. `test/gigs.test.ts` ("serves a new module's operation with no core changes") shows a module added without touching core.

## Rules

1. A module depends on core. It never imports another module's `schema.ts` or internals; it may call another module's exported service functions (e.g. `music` reading a gig to link a setlist).
2. Core never imports a module. Modules are registered in one list (`apps/worker/src/modules/index.ts`).
3. Data lives in the module's Durable Objects (per entity); D1 tables only for small shared registries. Every table has `id` (ULID), timestamps, indexes on filtered columns, and `deleted_at` for user-facing entities. Table names are plain and descriptive (`gigs`, `payments`); prefix only on a real name clash.
4. Operation ids are `<module>.<action>`; scopes are `<module>:read` / `<module>:write` (finer scopes allowed).
5. Responses are LLM-friendly: names and display strings, not just IDs.
6. Modules are registered for the whole app (no per-workspace switching; workspaces were retired).
7. Anything two modules need (people/contacts, money, dates, attachments, reminders) is promoted into core **only when the second module actually needs it**, with a decision recorded. Until then it stays in the module that uses it.

## Adding a module (checklist)

1. Record a decision in `docs/decisions.md` (what, why, what data it holds).
2. Add schemas in `packages/shared`, tables + migration, services with tests (including a test that people not on an entity can't read or change it), operations.
3. Register it in the module list; add web screens; add Siri Shortcuts or MCP notes if relevant.
4. Update `docs/data-model.md`, `docs/api.md`, `docs/roadmap.md`, and `tasks/`.

## Current modules

| Module  | Status                              | Holds                                          |
| ------- | ----------------------------------- | ---------------------------------------------- |
| `gigs`  | Phase 1                             | clients, venues, gigs, payments, expenses      |
| `music` | Phase 2 (planned)                   | songs, chart revisions, arrangements, setlists |
| others  | ideas, see [roadmap.md](roadmap.md) |                                                |
