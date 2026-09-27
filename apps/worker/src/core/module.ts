// The contract every feature module implements (see docs/modules.md).
import type { UserCtx } from "./context.ts";
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
}

export function defineModule<const M extends ModuleDefinition>(module: M): M {
  for (const op of module.operations ?? []) {
    if (!op.id.startsWith(`${module.id}.`))
      throw new Error(`Operation ${op.id} must start with "${module.id}."`);
    if (op.scope === "user" && op.kind !== "read")
      throw new Error(`Module operation ${op.id}: user-scoped module operations must be reads`);
  }
  return module;
}
