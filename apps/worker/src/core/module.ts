// The contract every feature module implements (see docs/modules.md).
import type { ObjectBindings, UserCtx } from "./context.ts";
import type { AnyOperation, Change } from "./operations.ts";

/** Statements a module adds to a core write, committed in the same batch with their audit entries. */
export interface HookResult {
  statements: D1PreparedStatement[];
  changes: Change[];
}

export interface ModuleHooks {
  /**
   * A user joined a shared workspace (created it, or accepted an invitation). Runs before the
   * core write; the returned statements are committed with it.
   */
  memberJoined?: (ctx: UserCtx, args: { workspaceId: string }) => Promise<HookResult>;
  /**
   * A new account was created (sign-up). Runs after the account exists; failures are
   * logged and never block sign-up, so hooks must have their own safety net.
   */
  userCreated?: UserCreatedHook;
}

export type UserCreatedHook = (
  deps: { d1: D1Database; objects: ObjectBindings },
  user: { id: string; name: string; email: string },
) => Promise<void>;

/** Admin panel (docs/design/gig-centric.md §10b): counts only, never other people's data. */
export interface AdminStat {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "warn" | "bad";
}
export interface AdminSection {
  title: string;
  stats: AdminStat[];
}
export interface AdminCtx {
  d1: D1Database;
  objects: ObjectBindings;
}
export interface AdminTool {
  id: string;
  label: string;
  description: string;
  /** Optional inputs, e.g. a month range. */
  fields?: { name: string; label: string; placeholder?: string }[];
  run: (ctx: AdminCtx, input: Record<string, string>) => Promise<string>;
}
export interface ModuleAdmin {
  sections?: (ctx: AdminCtx) => Promise<AdminSection[]>;
  tools?: readonly AdminTool[];
}

/** A queue this module consumes. `name` is the queue's base name; dev uses `<name>-dev`. */
export interface ModuleQueue {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each queue has its own body type
  handle: (batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) => Promise<void>;
}

export interface ModuleDefinition {
  /** Stable id, used in operation ids and scopes (e.g. "gigs"). */
  id: string;
  /** Human-readable name shown in settings. */
  name: string;
  /** The module's Drizzle tables (also listed in drizzle.config.ts for migrations). */
  schema?: Record<string, unknown>;
  /**
   * Actions, each exposed as an HTTP route (and an MCP tool in T10). Ids start with `<id>.`.
   * Workspace-scoped by default; user-scoped operations (e.g. the Me Home across workspaces)
   * must only read workspaces the user belongs to that have the module enabled.
   */
  operations?: readonly AnyOperation[];
  hooks?: ModuleHooks;
  /** Queues this module consumes (e.g. gigs' summaries queue). */
  queues?: readonly ModuleQueue[];
  /** Sections and tools for the owner-only admin panel. */
  admin?: ModuleAdmin;
  /**
   * Live updates: takes a signed-in user's WebSocket upgrade (from `/api/live`, already
   * authenticated and origin-checked by core) and returns the 101 response. One module.
   */
  live?: (env: Env, userId: string, request: Request) => Promise<Response>;
}

export function defineModule<const M extends ModuleDefinition>(module: M): M {
  for (const op of module.operations ?? []) {
    if (!op.id.startsWith(`${module.id}.`))
      throw new Error(`Operation ${op.id} must start with "${module.id}."`);
    if (op.scope === "user" && op.kind !== "read" && op.idempotency !== "object")
      throw new Error(
        `Module operation ${op.id}: user-scoped module writes must keep their data (and idempotency) in an object`,
      );
  }
  return module;
}
