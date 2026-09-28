// The request context every service receives: the signed-in user, never raw env. Access
// to a gig is decided inside that gig's own object (docs/design/gig-centric.md §3).
import { createMiddleware } from "hono/factory";
import { createDb, type Db } from "./db/client.ts";
import type { Source } from "./db/schema.ts";
import { getAuth } from "./auth/auth.ts";
import { AppError } from "./errors.ts";
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

/** Requires a signed-in user (session cookie; API tokens and OAuth arrive in T09/T10). */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth({ env: c.env, userCreated: c.get("userCreated") });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError("unauthenticated", "Sign in required");
  const { user } = session;
  c.set("userCtx", {
    db: createDb(c.env.DB, c.get("moduleSchemas")),
    d1: c.env.DB,
    objects: objectBindings(c.env),
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    source: "web",
    baseUrl: c.env.BASE_URL,
  });
  await next();
});
