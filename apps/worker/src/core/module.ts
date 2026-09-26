// The contract every feature module implements (see docs/modules.md).
import type { AnyOperation } from "./operations.ts";

export interface ModuleDefinition {
  /** Stable id, used in operation ids and scopes (e.g. "gigs"). */
  id: string;
  /** Human-readable name shown in settings. */
  name: string;
  /** The module's Drizzle tables (also listed in drizzle.config.ts for migrations). */
  schema?: Record<string, unknown>;
  /** Actions, each exposed as an HTTP route (and an MCP tool in T10). Ids start with `<id>.`. */
  operations?: readonly AnyOperation[];
}

export function defineModule<const M extends ModuleDefinition>(module: M): M {
  for (const op of module.operations ?? []) {
    if (!op.id.startsWith(`${module.id}.`))
      throw new Error(`Operation ${op.id} must start with "${module.id}."`);
    if (op.scope !== "workspace") throw new Error(`Module operation ${op.id} must be workspace-scoped`);
  }
  return module;
}
