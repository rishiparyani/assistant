// The contract every feature module implements (see docs/modules.md).
// Operations and hooks are added in T04+.
export interface ModuleDefinition {
  /** Stable id, used in operation ids and scopes (e.g. "gigs"). */
  id: string;
  /** Human-readable name shown in settings. */
  name: string;
  /** The module's Drizzle tables (also listed in drizzle.config.ts for migrations). */
  schema?: Record<string, unknown>;
}

export function defineModule<const M extends ModuleDefinition>(module: M): M {
  return module;
}
