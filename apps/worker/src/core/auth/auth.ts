// The Better Auth instance for this Worker. One per isolate per env.
import { betterAuth } from "better-auth";
import { authOptions } from "./options.ts";
import { objectBindings } from "../context.ts";
import type { UserCreatedHook } from "../module.ts";

export interface AuthDeps {
  env: Env;
  /** Modules' sign-up hooks (e.g. gigs attaches people added by email). */
  userCreated?: readonly UserCreatedHook[];
}

export function createAuth({ env, userCreated = [] }: AuthDeps) {
  const base = authOptions({
    baseURL: env.BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    // Email/password only on localhost (tests, local dev without Google); never deployed.
    emailAndPassword: env.BASE_URL.startsWith("http://localhost:"),
  });
  return betterAuth({
    ...base,
    databaseHooks: {
      user: {
        create: {
          // Modules react to new accounts (gigs attaches people added by email).
          after: async (user) => {
            for (const hook of userCreated) {
              try {
                await hook({ d1: env.DB, objects: objectBindings(env) }, user);
              } catch (err) {
                console.error("sign-up hook failed; it will be retried by the module's safety net", err);
              }
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const cache = new WeakMap<Env, Auth>();
export function getAuth(deps: AuthDeps): Auth {
  let auth = cache.get(deps.env);
  if (!auth) {
    auth = createAuth(deps);
    cache.set(deps.env, auth);
  }
  return auth;
}
