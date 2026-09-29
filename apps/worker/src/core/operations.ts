// The operation registry (docs/modules.md). Every action is defined once; the core turns
// it into an HTTP route (and, in T10, an MCP tool) and wraps it with: sign-in →
// validation → the Idempotency-Key for writes → handler → metrics. Access to a gig, the
// idempotency record and the audit entry all live inside the gig's own object
// (docs/design/gig-centric.md §6), so no write touches a shared place per action.
import type { Context, Handler, Hono } from "hono";
import type { z } from "zod";
import { requireCaller, type AppEnv, type UserCtx } from "./context.ts";
import { AppError } from "./errors.ts";
import { parse } from "./validation.ts";
import { toAppError } from "./objects/errors.ts";
import { recordOperation } from "./metrics.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface OperationInfo {
  id: string;
  module: string;
  action: string;
  kind: "read" | "write";
}

interface OpExtras {
  operation: OperationInfo;
  /**
   * The request's Idempotency-Key (writes only). The handler hands it to the Durable
   * Object that owns the data, which stores it with its own write.
   */
  idempotencyKey: string | null;
}

export type OpUserCtx = UserCtx & OpExtras;

export interface OperationDef<S extends z.ZodType = z.ZodType, O = unknown> {
  /** `<module>.<action>`, e.g. "gigs.create_booking". */
  id: string;
  /** MCP tool name, unique across modules (T10). */
  tool: string;
  /** Shown to AI assistants and in API docs. */
  description: string;
  kind: "read" | "write";
  /** Only for a signed-in session, never API tokens (e.g. managing tokens and feed links). */
  sessionOnly?: boolean;
  /** Path relative to `/api`. Params are snake_case input fields. */
  http: { method: HttpMethod; path: string; status?: 200 | 201 };
  /** Two-step from MCP (money, cancellations, deletes); used in T10. */
  confirm?: boolean;
  input: S;
  handler: (ctx: OpUserCtx, input: z.output<S>) => Promise<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
export type AnyOperation = OperationDef<any, any>;

export function defineOperation<S extends z.ZodType, O>(def: OperationDef<S, O>): OperationDef<S, O> {
  if (!/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(def.id)) throw new Error(`Bad operation id: ${def.id}`);
  return def;
}

export function operationInfo(op: AnyOperation): OperationInfo {
  const [module, action] = op.id.split(".") as [string, string];
  return { id: op.id, module, action, kind: op.kind };
}

export const fullPath = (op: AnyOperation) => `/api${op.http.path}`;

export function validateRegistry(ops: readonly AnyOperation[]) {
  const seen = new Map<string, string>();
  for (const op of ops) {
    for (const key of [`id:${op.id}`, `tool:${op.tool}`, `route:${op.http.method} ${fullPath(op)}`]) {
      if (seen.has(key)) throw new Error(`Duplicate operation ${key} (${seen.get(key)} and ${op.id})`);
      seen.set(key, op.id);
    }
  }
}

/** Builds the context an operation handler receives. Also used by the MCP adapter (T10). */
export function operationContext(
  op: AnyOperation,
  base: UserCtx,
  idempotencyKey: string | null = null,
): OpUserCtx {
  return { ...base, operation: operationInfo(op), idempotencyKey };
}

// --- HTTP adapter --------------------------------------------------------------

async function readInput(c: Context<AppEnv>, op: AnyOperation): Promise<Record<string, unknown>> {
  const params = { ...c.req.param() } as Record<string, string>;
  const query = c.req.queries();
  const fromQuery = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, v.length === 1 ? v[0] : v]));
  let body: unknown = {};
  if (op.http.method === "POST" || op.http.method === "PUT" || op.http.method === "PATCH") {
    const text = await c.req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError("validation_failed", "Request body must be valid JSON");
      }
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AppError("validation_failed", "Request body must be a JSON object");
    }
  }
  // Path params win over body/query so a URL can't be contradicted by the payload.
  return { ...fromQuery, ...(body as Record<string, unknown>), ...params };
}

export function registerOperations(app: Hono<AppEnv>, ops: readonly AnyOperation[]) {
  validateRegistry(ops);
  for (const op of ops) {
    const run = async (c: Context<AppEnv>): Promise<Response> => {
      const { scopes } = c.get("userCtx");
      if (scopes && op.sessionOnly)
        throw new AppError("forbidden", "Sign in to the app to do this (API tokens can't)");
      if (scopes && !scopes.includes(op.kind === "write" ? "write" : "read"))
        throw new AppError("forbidden", `This token can't ${op.kind === "write" ? "make changes" : "read"}`);
      const input = parse(op.input, await readInput(c, op));
      const status = op.http.status ?? 200;
      let key: string | null = null;
      if (op.kind === "write") {
        key = c.req.header("idempotency-key") ?? null;
        if (!key || key.length > 200)
          throw new AppError(
            "validation_failed",
            "Writes need an Idempotency-Key header (a unique value per action)",
          );
      }
      const result = await op.handler(operationContext(op, c.get("userCtx"), key), input);
      return c.json(result ?? null, status);
    };

    // Every call is counted with its status and duration (admin panel; design §10a).
    const handler: Handler<AppEnv> = async (c) => {
      const started = Date.now();
      let status = 500;
      try {
        const res = await run(c);
        status = res.status;
        return res;
      } catch (err) {
        status = err instanceof AppError ? err.status : (toAppError(err)?.status ?? 500);
        throw err;
      } finally {
        recordOperation(c.env, op.id, status, Date.now() - started);
      }
    };

    app.on([op.http.method], [fullPath(op)], requireCaller, handler);
  }
}
