// Start over (decision 2026-10-16 "Start over from a GitHub job, never from the app"): for
// the test phase only. Erases every account and everything people made: D1's rows and every
// object's data. Nothing in the app can start it. It answers only while the Worker has a
// RESET_TOKEN secret, which the "Start over" GitHub job sets for its own run and deletes at
// the end; without it every reset path is a 404. Kept: the app's settings (the Drive link,
// alert settings, push keys), the monitoring state, the AI budget (so this month's spend
// still counts against the cap) and the migrations table.
import { Hono } from "hono";
import type { ModuleDefinition } from "../module.ts";
import { runBackup } from "../backup/service.ts";

export type ResetEnv = Env & { RESET_TOKEN?: string };

/**
 * Whether a reset is under way (the job's secret is set). The app is then closed: every other
 * request gets a 503, queued changes are dropped and scheduled jobs skip, so nothing is written
 * between the backup and the last erase (people's data can't land after its kind was listed).
 */
export const resetting = (env: Env) => !!(env as ResetEnv).RESET_TOKEN;

/** D1 tables a reset keeps (settings and bookkeeping, no one's data). */
export const KEEP_TABLES = new Set(["d1_migrations", "app_settings", "alert_state"]);

/** The object kinds a reset erases, by binding. The AI budget is not among them. */
export const WIPED_BINDINGS = [
  "BOOKINGS",
  "PEOPLE",
  "MONTHS",
  "PENDING",
  "INBOX",
  "LIBRARIES",
  "SPACES",
  "CHATS",
  "LIVE",
  "GROUPS",
  "SEARCH",
] as const;
export type WipedBinding = (typeof WIPED_BINDINGS)[number];

/** The words the job sends with every step, so a stray call with the token alone does nothing. */
export const RESET_WORDS = "ERASE EVERYTHING";

type Wipeable = { wipe(): Promise<void> };

/** Why an erase failed, in fixed words: the error's class and a category from its message. */
export function errorKind(err: unknown): string {
  if (!(err instanceof Error)) return "error";
  const m = err.message.toLowerCase();
  const kind = /abort|reset/.test(m)
    ? "the object was reset"
    : /invalid|not for this|idfromstring/.test(m)
      ? "an id not of this kind"
      : /overload|too many|exceeded/.test(m)
        ? "overloaded"
        : /timed out|timeout|deadline/.test(m)
          ? "timed out"
          : /not a function|no such method|does not (exist|implement)/.test(m)
            ? "no wipe method"
            : /sql|storage/.test(m)
              ? "a storage error"
              : "something else";
  // The class name only when it's a plain one (never text built from data).
  return `${/^[A-Za-z]{1,40}$/.test(err.name) ? err.name : "Error"}: ${kind}`;
}

/** Erases the given objects of one kind (ids as the Cloudflare API lists them). */
export async function wipeObjects(
  env: ResetEnv,
  binding: WipedBinding,
  ids: readonly string[],
): Promise<{ wiped: number; failed: number; errors: string[] }> {
  const ns = env[binding] as unknown as DurableObjectNamespace;
  let wiped = 0;
  let failed = 0;
  // What went wrong, by kind: the error's name and a fixed category, never its message (the
  // job's log is public, and a message can carry someone's words).
  const errors = new Set<string>();
  for (const id of ids) {
    try {
      const stub = ns.get(ns.idFromString(id)) as unknown as Wipeable;
      await stub.wipe();
      wiped++;
    } catch (err) {
      const e = errorKind(err);
      console.error("reset: an object failed to erase", binding, e);
      if (errors.size < 5) errors.add(e);
      failed++;
    }
  }
  return { wiped, failed, errors: [...errors] };
}

/** Every table that holds people's rows: everything but the kept ones and the engine's own. */
export async function tablesToEmpty(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `select name from sqlite_master where type = 'table'
       and name not like 'sqlite_%' and name not like '_cf_%'`,
    )
    .all<{ name: string }>();
  return rows.results.map((r) => r.name).filter((n) => !KEEP_TABLES.has(n));
}

/** Empties D1 (accounts, sessions, the space list, shares…) in one transaction. */
export async function emptyDatabase(db: D1Database): Promise<{ tables: number; rows: number }> {
  const tables = await tablesToEmpty(db);
  let rows = 0;
  for (const t of tables) {
    const r = await db.prepare(`select count(*) as n from "${t}"`).first<{ n: number }>();
    rows += r?.n ?? 0;
  }
  await db.batch([
    // Rows may point at each other (sessions at users); checked only when the batch ends.
    db.prepare(`pragma defer_foreign_keys = on`),
    ...tables.map((t) => db.prepare(`delete from "${t}"`)),
  ]);
  return { tables: tables.length, rows };
}

/** Same length, every character compared, so the time taken says nothing about the token. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The job's steps, under /api/internal/reset. Each answers with counts only.
 * - backup: a backup to Drive now (required in production; the job stops if it fails)
 * - objects: erase these objects of one kind
 * - database: empty D1 (last, so a run that stopped half way can be started again)
 */
export function resetRoutes(modules: readonly ModuleDefinition[]) {
  const r = new Hono<{ Bindings: Env }>();
  r.use(async (c, next) => {
    const token = (c.env as ResetEnv).RESET_TOKEN;
    const given = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    // No secret, wrong secret: the path doesn't exist.
    if (!token || token.length < 32 || !sameToken(given, token))
      return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    await next();
  });
  r.post("/", async (c) => {
    const body = await c.req.json<{ words?: string; step?: string; binding?: string; ids?: unknown }>();
    if (body.words !== RESET_WORDS)
      return c.json({ error: { code: "validation_failed", message: "Wrong words" } }, 400);
    if (body.step === "backup") {
      const status = await runBackup(c.env, modules);
      return c.json({ ok: !!status?.ok, connected: status !== null, bytes: status?.ok ? status.bytes : 0 });
    }
    if (body.step === "objects") {
      const binding = WIPED_BINDINGS.find((b) => b === body.binding);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      if (!binding || !ids.length || ids.length > 100)
        return c.json({ error: { code: "validation_failed", message: "A kind and 1 to 100 ids" } }, 400);
      return c.json({ ok: true, ...(await wipeObjects(c.env, binding, ids)) });
    }
    if (body.step === "database") return c.json({ ok: true, ...(await emptyDatabase(c.env.DB)) });
    return c.json({ error: { code: "validation_failed", message: "Unknown step" } }, 400);
  });
  return r;
}
