// The contract every feature module implements (see docs/modules.md).
// T01: identity only. Tables, operations and hooks are added in T02-T04.
export interface ModuleDefinition {
  /** Stable id, used in operation ids and scopes (e.g. "gigs"). */
  id: string;
  /** Human-readable name shown in settings. */
  name: string;
}

export function defineModule<const M extends ModuleDefinition>(module: M): M {
  return module;
}
