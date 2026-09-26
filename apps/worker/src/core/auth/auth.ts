// The Better Auth instance for this Worker. One per isolate per env.
import { betterAuth } from "better-auth";
import { authOptions } from "./options.ts";
import { createPersonalWorkspace } from "../workspaces/service.ts";

export interface AuthDeps {
  env: Env;
  moduleIds: readonly string[];
}

export function createAuth({ env, moduleIds }: AuthDeps) {
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
          // Every new user gets a personal workspace with all modules enabled.
          after: async (user) => {
            await createPersonalWorkspace(env.DB, { id: user.id, name: user.name }, moduleIds);
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
