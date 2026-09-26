// Better Auth's HTTP surface, minus the parts the app handles itself.
import { Hono } from "hono";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import type { AppEnv } from "../context.ts";
import { getAuth } from "./auth.ts";

// Workspace/membership changes go through /api (authorization + audit log), and OAuth
// client/resource administration isn't exposed. Everything else (sign-in, callbacks,
// session, passkeys, the OAuth flow for MCP connectors) passes through.
const BLOCKED = [
  /^\/auth\/organization(\/|$)/,
  /^\/auth\/admin(\/|$)/,
  /^\/auth\/oauth2\/(create-client|get-client|get-clients|update-client|delete-client|client\/rotate-secret|get-consents?|update-consent|delete-consent)$/,
];

export const authRoutes = new Hono<AppEnv>()
  .on(["GET", "POST"], "/auth/*", (c) => {
    if (BLOCKED.some((re) => re.test(c.req.path))) {
      return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    }
    return getAuth({ env: c.env, moduleIds: c.get("moduleIds") }).handler(c.req.raw);
  })
  // OAuth discovery for MCP connectors (Better Auth serves these under /auth; clients
  // also look at the root and at path-inserted variants).
  .get("/.well-known/oauth-authorization-server/auth", (c) =>
    oauthProviderAuthServerMetadata(getAuth({ env: c.env, moduleIds: c.get("moduleIds") }))(c.req.raw),
  )
  .get("/.well-known/oauth-authorization-server", (c) =>
    oauthProviderAuthServerMetadata(getAuth({ env: c.env, moduleIds: c.get("moduleIds") }))(c.req.raw),
  )
  .get("/.well-known/openid-configuration/auth", (c) =>
    oauthProviderOpenIdConfigMetadata(getAuth({ env: c.env, moduleIds: c.get("moduleIds") }))(c.req.raw),
  )
  .get("/.well-known/openid-configuration", (c) =>
    oauthProviderOpenIdConfigMetadata(getAuth({ env: c.env, moduleIds: c.get("moduleIds") }))(c.req.raw),
  );
