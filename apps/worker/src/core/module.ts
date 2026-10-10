// The contract every feature module implements (see docs/modules.md).
import type { CalendarEvent } from "./calendar/ics.ts";
import type { ObjectBindings } from "./context.ts";
import type { AnyOperation } from "./operations.ts";

export interface ModuleHooks {
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
  /** Health checks run every 15 minutes; a failing one alerts the owner (design §10a). */
  checks?: (ctx: AdminCtx) => Promise<HealthCheck[]>;
}

export interface HealthCheck {
  /** Stable id, e.g. "gigs.delivery_stuck". */
  id: string;
  /** Short name for messages, e.g. "Updates stuck". */
  label: string;
  ok: boolean;
  /** What's wrong (counts only, never personal data). */
  detail?: string;
  /** What to do about it. */
  fix?: string;
}

/** A queue this module consumes. `name` is the queue's base name; dev uses `<name>-dev`. */
export interface ModuleQueue {
  name: string;
  /** The dev environment's queue name; defaults to `<name>-dev`. */
  devName?: string;
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
   * Writes keep their data, idempotency record and audit entry in a Durable Object.
   */
  operations?: readonly AnyOperation[];
  hooks?: ModuleHooks;
  /** Queues this module consumes (e.g. gigs' summaries queue). */
  queues?: readonly ModuleQueue[];
  /** Sections and tools for the owner-only admin panel. */
  admin?: ModuleAdmin;
  /** The module's own data in nightly backups (core/backup). */
  backup?: {
    export: (ctx: AdminCtx) => Promise<unknown>;
    /** Restores into empty objects only; returns how many were restored. */
    import: (ctx: AdminCtx, data: unknown) => Promise<number>;
  };
  /**
   * Secret links opened without signing in (e.g. a gig's guest list for its venue), for
   * tokens starting with `<prefix>_`. `read` and `act` return null for a link that isn't
   * valid (or no longer is); core answers 404 without saying why.
   */
  sharedLinks?: {
    prefix: string;
    read: (env: Env, token: string) => Promise<unknown | null>;
    act?: (
      env: Env,
      token: string,
      action: string,
      body: unknown,
      key: string | null,
    ) => Promise<unknown | null>;
  };
  /** Events for this person's private calendar feed (T08), e.g. their gigs. */
  calendar?: (ctx: CalendarCtx, userId: string) => Promise<CalendarEvent[]>;
}

export interface CalendarCtx extends AdminCtx {
  baseUrl: string;
}

export function defineModule<const M extends ModuleDefinition>(module: M): M {
  for (const op of module.operations ?? []) {
    if (!op.id.startsWith(`${module.id}.`))
      throw new Error(`Operation ${op.id} must start with "${module.id}."`);
  }
  return module;
}
