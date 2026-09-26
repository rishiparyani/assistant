// The operation registry (docs/modules.md). Every action is defined once; the core
// turns it into an HTTP route (and, in T10, an MCP tool) and wraps it with:
// auth → membership/role → module enabled → validation → idempotency (writes) →
// handler → audit log (through ctx.commit). Business logic stays in the handler's service.
import type { Context, Handler, Hono, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { Role } from "@assistant/shared";
import { requireUser, requireWorkspace, type AppEnv, type Ctx, type UserCtx } from "./context.ts";
import { auditStatement } from "./audit.ts";
import { AppError } from "./errors.ts";
import { parse } from "./validation.ts";

export type OperationScope = "user" | "workspace";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A change a write made, recorded in the audit log by the wrapper. */
export interface Change {
  entityType: string;
  entityId: string;
  /** Defaults to the operation's action (e.g. "create_client"). */
  action?: string;
  before?: unknown;
  after?: unknown;
  /** Required for user-scoped operations; defaults to the current workspace. */
  workspaceId?: string;
}

export interface OperationInfo {
  id: string;
  module: string;
  action: string;
  kind: "read" | "write";
}

interface OpExtras {
  operation: OperationInfo;
  /**
   * Runs the statements and their audit entries in one D1 batch (a transaction).
   * The only way an operation writes.
   */
  commit(statements: D1PreparedStatement[], changes: Change | Change[]): Promise<D1Result[]>;
}

export type OpUserCtx = UserCtx & OpExtras;
export type OpCtx = Ctx & OpExtras;

export interface OperationDef<
  S extends z.ZodType = z.ZodType,
  O = unknown,
  Sc extends OperationScope = OperationScope,
> {
  /** `<module>.<action>`, e.g. "gigs.create_client". Module "core" has no module check. */
  id: string;
  /** MCP tool name, unique across modules (T10). */
  tool: string;
  /** Shown to AI assistants and in API docs. */
  description: string;
  scope: Sc;
  kind: "read" | "write";
  /** Minimum role in the workspace (workspace scope only). Default: member. */
  role?: Role;
  /** Path relative to `/api/w/:workspaceId` (workspace) or `/api` (user). Params are snake_case input fields. */
  http: { method: HttpMethod; path: string; status?: 200 | 201 };
  /** Two-step from MCP (money, cancellations, deletes); used in T10. */
  confirm?: boolean;
  input: S;
  handler: (ctx: Sc extends "workspace" ? OpCtx : OpUserCtx, input: z.output<S>) => Promise<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
export type AnyOperation = OperationDef<any, any, any>;

export function defineOperation<S extends z.ZodType, O, Sc extends OperationScope>(
  def: OperationDef<S, O, Sc>,
): OperationDef<S, O, Sc> {
  if (!/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(def.id)) throw new Error(`Bad operation id: ${def.id}`);
  return def;
}

export function operationInfo(op: AnyOperation): OperationInfo {
  const [module, action] = op.id.split(".") as [string, string];
  return { id: op.id, module, action, kind: op.kind };
}

export function fullPath(op: AnyOperation): string {
  return op.scope === "workspace" ? `/api/w/:workspaceId${op.http.path}` : `/api${op.http.path}`;
}

export function validateRegistry(ops: readonly AnyOperation[]) {
  const seen = new Map<string, string>();
  for (const op of ops) {
    for (const key of [`id:${op.id}`, `tool:${op.tool}`, `route:${op.http.method} ${fullPath(op)}`]) {
      if (seen.has(key)) throw new Error(`Duplicate operation ${key} (${seen.get(key)} and ${op.id})`);
      seen.set(key, op.id);
    }
  }
}

function makeCommit(base: UserCtx | Ctx, info: OperationInfo): OpExtras["commit"] {
  return async (statements, changes) => {
    if (info.kind !== "write") throw new Error(`${info.id} is a read operation and can't write`);
    const list = Array.isArray(changes) ? changes : [changes];
    const workspace = "workspace" in base ? (base as Ctx).workspace : undefined;
    const audits = list.map((ch) => {
      const workspaceId = ch.workspaceId ?? workspace?.id;
      if (!workspaceId) throw new Error(`${info.id}: change for ${ch.entityType} needs a workspaceId`);
      return auditStatement(base.d1, {
        workspaceId,
        actorUserId: base.user.id,
        source: base.source,
        module: info.module,
        action: ch.action ?? info.action,
        entityType: ch.entityType,
        entityId: ch.entityId,
        before: ch.before,
        after: ch.after,
      });
    });
    return base.d1.batch([...statements, ...audits]);
  };
}

/** Builds the context an operation handler receives. Also used by the MCP adapter (T10). */
export function operationContext(op: AnyOperation, base: UserCtx | Ctx): OpUserCtx | OpCtx {
  const info = operationInfo(op);
  return { ...base, operation: info, commit: makeCommit(base, info) };
}

// --- Idempotency (architecture rule 8) ---------------------------------------

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const IN_PROGRESS_STALE_MS = 60_000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Reservation = { replay: Response } | { reserved: true };

async function reserveIdempotencyKey(
  d1: D1Database,
  userId: string,
  key: string,
  hash: string,
): Promise<Reservation> {
  const insert = () =>
    d1
      .prepare(
        `insert into idempotency_keys (user_id, key, request_hash, status_code, response_json) values (?, ?, ?, 0, '')
         on conflict (user_id, key) do nothing`,
      )
      .bind(userId, key, hash)
      .run();
  if ((await insert()).meta.changes === 1) return { reserved: true };

  const row = await d1
    .prepare(
      `select request_hash, status_code, response_json, created_at from idempotency_keys where user_id = ? and key = ?`,
    )
    .bind(userId, key)
    .first<{ request_hash: string; status_code: number; response_json: string; created_at: string }>();
  if (!row) return reserveIdempotencyKey(d1, userId, key, hash);
  const age = Date.now() - Date.parse(row.created_at);
  const abandoned = row.status_code === 0 && age > IN_PROGRESS_STALE_MS;
  if (age > IDEMPOTENCY_TTL_MS || abandoned) {
    await d1.prepare(`delete from idempotency_keys where user_id = ? and key = ?`).bind(userId, key).run();
    return reserveIdempotencyKey(d1, userId, key, hash);
  }
  if (row.request_hash !== hash) {
    throw new AppError("conflict", "This Idempotency-Key was already used for a different request", {
      reason: "idempotency_key_reused",
    });
  }
  if (row.status_code === 0) {
    throw new AppError("conflict", "The same request is still being processed", {
      reason: "request_in_progress",
    });
  }
  return {
    replay: new Response(row.response_json, {
      status: row.status_code,
      headers: { "content-type": "application/json", "idempotent-replayed": "true" },
    }),
  };
}

// --- HTTP adapter --------------------------------------------------------------

async function readInput(c: Context<AppEnv>, op: AnyOperation): Promise<Record<string, unknown>> {
  const params = { ...c.req.param() } as Record<string, string>;
  delete params.workspaceId;
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
    const info = operationInfo(op);
    const guards: MiddlewareHandler<AppEnv>[] =
      op.scope === "workspace"
        ? [
            requireUser,
            requireWorkspace({ role: op.role, module: info.module === "core" ? undefined : info.module }),
          ]
        : [requireUser];

    const handler: Handler<AppEnv> = async (c) => {
      const raw = await readInput(c, op);
      const input = parse(op.input, raw);
      const base = op.scope === "workspace" ? c.get("ctx") : c.get("userCtx");
      const ctx = operationContext(op, base);
      const status = op.http.status ?? 200;

      if (op.kind === "read") return c.json((await op.handler(ctx, input)) ?? null, status);

      const key = c.req.header("idempotency-key");
      if (!key || key.length > 200) {
        throw new AppError(
          "validation_failed",
          "Writes need an Idempotency-Key header (a unique value per action)",
        );
      }
      const workspaceId = op.scope === "workspace" ? (base as Ctx).workspace.id : "";
      const hash = await sha256(JSON.stringify([op.id, workspaceId, raw]));
      const reservation = await reserveIdempotencyKey(base.d1, base.user.id, key, hash);
      if ("replay" in reservation) return reservation.replay;
      let result: unknown;
      try {
        result = (await op.handler(ctx, input)) ?? null;
      } catch (err) {
        // Nothing happened for this key, so a retry may run the request again.
        await base.d1
          .prepare(`delete from idempotency_keys where user_id = ? and key = ?`)
          .bind(base.user.id, key)
          .run();
        throw err;
      }
      const json = JSON.stringify(result);
      try {
        await base.d1
          .prepare(
            `update idempotency_keys set status_code = ?, response_json = ? where user_id = ? and key = ?`,
          )
          .bind(status, json, base.user.id, key)
          .run();
      } catch (err) {
        // The write succeeded; don't fail the response over the replay record.
        console.error(`idempotency: couldn't store the response for ${op.id}`, err);
      }
      return new Response(json, { status, headers: { "content-type": "application/json" } });
    };

    app.on([op.http.method], [fullPath(op)], ...guards, handler);
  }
}
