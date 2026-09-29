// The request context every service receives: the signed-in user, never raw env. Access
// to a gig is decided inside that gig's own object (docs/design/gig-centric.md §3).
import { createMiddleware } from "hono/factory";
import { createDb, type Db } from "./db/client.ts";
import type { Source } from "./db/schema.ts";
import { getAuth } from "./auth/auth.ts";
import { AppError } from "./errors.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { hashToken } from "./tokens.ts";
import type { UserCreatedHook } from "./module.ts";

export interface CtxUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/** The Durable Object namespaces in the environment (no secrets or plain vars). */
export type ObjectBindings = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any object class
  [K in keyof Env as Env[K] extends DurableObjectNamespace<any> ? K : never]: Env[K];
};

/** Picks the Durable Object namespaces out of the environment. */
export function objectBindings(env: Env): ObjectBindings {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env as unknown as Record<string, unknown>)) {
    if (v && typeof v === "object" && typeof (v as DurableObjectNamespace).idFromName === "function")
      out[k] = v;
  }
  return out as ObjectBindings;
}

/** What services get: never raw env, always scoped to the signed-in user. */
export interface UserCtx {
  db: Db;
  d1: D1Database;
  /** Durable Object namespaces (gig-centric storage); no secrets. */
  objects: ObjectBindings;
  user: CtxUser;
  source: Source;
  baseUrl: string;
  /** Encrypts / decrypts small secrets kept in D1 (the key itself stays out of services). */
  sealer: Sealer;
  /** What an API token may do; null for a signed-in session (everything). */
  scopes: readonly TokenScope[] | null;
}

export type TokenScope = "read" | "write";

export interface Sealer {
  seal: (plaintext: string) => Promise<string>;
  unseal: (sealed: string) => Promise<string>;
}

export function sealerFor(env: Env): Sealer {
  const secret = (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET;
  const need = () => {
    if (!secret) throw new Error("BETTER_AUTH_SECRET is missing");
    return secret;
  };
  return {
    seal: (text) => encryptSecret(need(), text),
    unseal: (sealed) => decryptSecret(need(), sealed),
  };
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    userCtx: UserCtx;
    moduleIds: readonly string[];
    userCreated: readonly UserCreatedHook[];
    moduleSchemas: Record<string, unknown>;
  };
};

/** Requires a signed-in user (session cookie). Admin, token and feed management use this. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth({ env: c.env, userCreated: c.get("userCreated") });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError("unauthenticated", "Sign in required");
  const { user } = session;
  c.set("userCtx", userCtxFor(c.env, c.get("moduleSchemas"), user, "web", null));
  await next();
});

/**
 * Requires a signed-in user or an API token (`Authorization: Bearer ast_…`, T09). Only
 * operation routes accept tokens; tokens act as the person who made them, with their scopes.
 */
export const requireCaller = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return requireUser(c, next);
  const token = header.slice(7).trim();
  const found = /^ast_[A-Za-z0-9_-]{20,100}$/.test(token) ? await apiTokenUser(c.env.DB, token) : null;
  if (!found) throw new AppError("unauthenticated", "This token isn't valid (revoked or mistyped)");
  c.set("userCtx", userCtxFor(c.env, c.get("moduleSchemas"), found.user, "siri", found.scopes));
  await next();
});

export function userCtxFor(
  env: Env,
  schemas: Record<string, unknown>,
  user: { id: string; name: string; email: string; image?: string | null },
  source: Source,
  scopes: readonly TokenScope[] | null,
): UserCtx {
  return {
    db: createDb(env.DB, schemas),
    d1: env.DB,
    objects: objectBindings(env),
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    source,
    baseUrl: env.BASE_URL,
    sealer: sealerFor(env),
    scopes,
  };
}

const DAY_MS = 86400_000;

/** The person an API token belongs to, and its scopes; null if unknown or revoked. */
async function apiTokenUser(d1: D1Database, token: string) {
  const row = await d1
    .prepare(
      `select t.id, t.scopes, t.last_used_at, u.id as user_id, u.name, u.email, u.image
       from access_tokens t join "user" u on u.id = t.user_id
       where t.token_hash = ? and t.kind = 'api' and t.revoked_at is null`,
    )
    .bind(await hashToken(token))
    .first<{
      id: string;
      scopes: string;
      last_used_at: string | null;
      user_id: string;
      name: string;
      email: string;
      image: string | null;
    }>();
  if (!row) return null;
  // "Last used" in settings; written at most once a day per token.
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > DAY_MS)
    await d1
      .prepare(`update access_tokens set last_used_at = ? where id = ?`)
      .bind(new Date().toISOString(), row.id)
      .run();
  const scopes = row.scopes.split(" ").filter((x): x is TokenScope => x === "read" || x === "write");
  return { user: { id: row.user_id, name: row.name, email: row.email, image: row.image }, scopes };
}
