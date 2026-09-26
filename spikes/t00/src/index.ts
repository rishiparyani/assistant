// T00 spike Worker: Better Auth (Google) on D1 + organizations + a minimal MCP
// endpoint protected by Better Auth's OAuth provider. Throwaway; see README.md.
import { Hono } from "hono";
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { createAuth, MCP_PATH, OAUTH_SCOPES, type Auth } from "./auth.ts";
import { handleMcpPost, type McpUser } from "./mcp.ts";
import { consentPage, homePage, loginPage } from "./pages.ts";

export interface Env {
  DB: D1Database;
  BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

// One auth instance per isolate (env is stable for the isolate's lifetime).
let cached: { env: Env; auth: Auth } | undefined;
function getAuth(env: Env): Auth {
  if (cached?.env !== env) {
    cached = {
      env,
      auth: createAuth({
        baseURL: env.BASE_URL,
        secret: env.BETTER_AUTH_SECRET,
        database: env.DB,
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
        // Email/password only for local testing without Google; never on a deployed URL.
        emailAndPassword: env.BASE_URL.startsWith("http://localhost:"),
      }),
    };
  }
  return cached.auth;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, spike: "t00" }));

// --- Better Auth ---------------------------------------------------------
app.on(["GET", "POST"], "/auth/*", (c) => getAuth(c.env).handler(c.req.raw));

// OAuth discovery. Better Auth serves these under /auth; MCP clients also look
// at the root and at path-inserted variants (RFC 8414 / RFC 9728), so mount all.
for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/auth"]) {
  app.get(path, (c) => oauthProviderAuthServerMetadata(getAuth(c.env))(c.req.raw));
}
for (const path of ["/.well-known/openid-configuration", "/.well-known/openid-configuration/auth"]) {
  app.get(path, (c) => oauthProviderOpenIdConfigMetadata(getAuth(c.env))(c.req.raw));
}

async function issuer(auth: Auth): Promise<string> {
  const meta = (await auth.api.getOAuthServerConfig()) as { issuer: string };
  return meta.issuer;
}

function mcpUrl(env: Env) {
  return new URL(MCP_PATH, env.BASE_URL).toString();
}

function resourceMetadataUrl(env: Env) {
  return new URL("/.well-known/oauth-protected-resource/mcp", env.BASE_URL).toString();
}

for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
  app.get(path, async (c) =>
    c.json({
      resource: mcpUrl(c.env),
      authorization_servers: [await issuer(getAuth(c.env))],
      scopes_supported: OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "Assistant (spike)",
    }),
  );
}

// --- MCP -----------------------------------------------------------------
function unauthorized(env: Env, description: string) {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl(env)}"`,
    },
  });
}

// Returns the user id (sub) for a valid access token, or null.
async function verifyToken(env: Env, token: string): Promise<string | null> {
  const auth = getAuth(env);
  try {
    if (token.split(".").length === 3) {
      // JWT access token (issued when the client sent `resource`, as MCP requires).
      // Verified in-process: JWKS read straight from Better Auth, no self-fetch.
      const payload = await verifyJwsAccessToken(token, {
        jwksFetch: async () => (await auth.api.getJwks()) as any,
        verifyOptions: { audience: mcpUrl(env), issuer: await issuer(auth) },
      });
      return typeof payload.sub === "string" ? payload.sub : null;
    }
    // Opaque token fallback (client didn't send `resource`): validate via userinfo.
    const info = (await auth.api.oauth2UserInfo({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })) as { sub?: string };
    return info?.sub ?? null;
  } catch (err) {
    console.log("token verification failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function loadUser(env: Env, userId: string): Promise<McpUser | null> {
  const user = await env.DB.prepare(`select name, email from "user" where id = ?`).bind(userId).first<{ name: string; email: string }>();
  if (!user) return null;
  const { results } = await env.DB.prepare(
    `select o.name, o.kind, m.role from member m join organization o on o.id = m.organizationId where m.userId = ? order by o.name`,
  )
    .bind(userId)
    .all<{ name: string; kind: string | null; role: string }>();
  return { ...user, workspaces: results };
}

app.post(MCP_PATH, async (c) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized(c.env, "Missing bearer token");
  const userId = await verifyToken(c.env, token);
  if (!userId) return unauthorized(c.env, "Invalid or expired token");
  const user = await loadUser(c.env, userId);
  if (!user) return unauthorized(c.env, "Unknown user");
  return handleMcpPost(c.req.raw, user);
});

// Stateless server: no SSE stream, no sessions to delete.
app.on(["GET", "DELETE"], MCP_PATH, () => new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }));

// --- Pages -----------------------------------------------------------------
app.get("/", (c) => c.html(homePage()));
app.get("/login", (c) => c.html(loginPage()));
app.get("/consent", (c) => c.html(consentPage()));

export default app;
