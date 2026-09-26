// End-to-end check of the T00 risks, in-process on node:sqlite:
// workspaces (organization plugin + `kind`), a second member, and the full MCP
// OAuth flow (dynamic registration → consent → token → JWT verification).
// Google is replaced by test-only email/password sign-in; the rest is the real config.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getMigrations } from "better-auth/db/migration";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { authOptions, createAuth, type Auth } from "../src/auth.ts";
import { handleMcpPost } from "../src/mcp.ts";

const BASE = "http://localhost:8787";
const MCP = `${BASE}/mcp`;
let auth: Auth;

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; form?: Record<string, string> } = {}) {
  const headers = new Headers({ origin: BASE });
  if (init.cookie) headers.set("cookie", init.cookie);
  let body: BodyInit | undefined;
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form);
  } else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return auth.handler(new Request(BASE + path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, redirect: "manual" }));
}

async function signUp(name: string, email: string) {
  const res = await req("/auth/sign-up/email", { body: { name, email, password: "test-password-123" } });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { user } = (await res.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

beforeAll(async () => {
  const cfg = {
    baseURL: BASE,
    secret: "test-secret-test-secret-test-secret-00",
    database: new DatabaseSync(":memory:"),
    emailAndPassword: true,
  };
  await (await getMigrations(authOptions(cfg))).runMigrations();
  auth = createAuth(cfg);
});

describe("workspaces", () => {
  it("creates a band workspace with kind and adds a second member", async () => {
    const owner = await signUp("Test Owner", "owner@example.com");
    const other = await signUp("Test Bandmate", "bandmate@example.com");

    const created = await req("/auth/organization/create", {
      cookie: owner.cookie,
      body: { name: "Test Band", slug: "test-band", kind: "band" },
    });
    expect(created.status).toBe(200);
    const org = (await created.json()) as { id: string; kind: string };
    expect(org.kind).toBe("band");

    const invite = await req("/auth/organization/invite-member", {
      cookie: owner.cookie,
      body: { email: "bandmate@example.com", role: "member", organizationId: org.id },
    });
    expect(invite.status).toBe(200);
    const { id: invitationId } = (await invite.json()) as { id: string };

    const accepted = await req("/auth/organization/accept-invitation", { cookie: other.cookie, body: { invitationId } });
    expect(accepted.status).toBe(200);

    const full = await req(`/auth/organization/get-full-organization?organizationId=${org.id}`, { cookie: owner.cookie });
    const members = ((await full.json()) as { members: { role: string; userId: string }[] }).members;
    expect(members.map((m) => m.role).sort()).toEqual(["member", "owner"]);

    // A user outside the workspace can't read it.
    const stranger = await signUp("Test Stranger", "stranger@example.com");
    const denied = await req(`/auth/organization/get-full-organization?organizationId=${org.id}`, { cookie: stranger.cookie });
    expect(denied.status).toBeGreaterThanOrEqual(400);
  });
});

describe("MCP OAuth flow", () => {
  it("registers a client, gets consent, exchanges a code and verifies the JWT", async () => {
    const user = await signUp("Test Musician", "musician@example.com");

    const reg = await req("/auth/oauth2/register", {
      body: {
        client_name: "Test MCP Client",
        redirect_uris: ["https://client.example.com/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
    });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };

    const verifier = createHash("sha256").update(randomBytes(32)).digest("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://client.example.com/callback",
      scope: "openid profile email offline_access",
      state: "state-123",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: MCP,
    });

    // Not signed in → login page.
    const anon = await req(`/auth/oauth2/authorize?${params}`);
    expect(anon.headers.get("location")).toMatch(/^\/login\?/);

    // Signed in → consent page with a signed query.
    const authorize = await req(`/auth/oauth2/authorize?${params}`, { cookie: user.cookie });
    const consentLoc = authorize.headers.get("location") ?? "";
    expect(consentLoc).toMatch(/^\/consent\?/);

    const consent = await req("/auth/oauth2/consent", {
      cookie: user.cookie,
      body: { accept: true, oauth_query: consentLoc.split("?")[1] },
    });
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as { redirect_uri?: string; url?: string };
    const redirect_uri = consentBody.redirect_uri ?? consentBody.url ?? "";
    const cb = new URL(redirect_uri);
    expect(cb.searchParams.get("state")).toBe("state-123");
    const code = cb.searchParams.get("code")!;

    const token = await req("/auth/oauth2/token", {
      form: {
        grant_type: "authorization_code",
        code,
        client_id,
        redirect_uri: "https://client.example.com/callback",
        code_verifier: verifier,
        resource: MCP,
      },
    });
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as { access_token: string; refresh_token?: string };
    expect(tokens.access_token.split(".")).toHaveLength(3);
    expect(tokens.refresh_token).toBeTruthy();

    const meta = (await auth.api.getOAuthServerConfig()) as { issuer: string };
    const payload = await verifyJwsAccessToken(tokens.access_token, {
      jwksFetch: async () => (await auth.api.getJwks()) as any,
      verifyOptions: { audience: MCP, issuer: meta.issuer },
    });
    expect(payload.sub).toBe(user.id);

    // A token for a different audience is rejected.
    await expect(
      verifyJwsAccessToken(tokens.access_token, {
        jwksFetch: async () => (await auth.api.getJwks()) as any,
        verifyOptions: { audience: `${BASE}/other`, issuer: meta.issuer },
      }),
    ).rejects.toThrow();
  });
});

describe("MCP protocol", () => {
  const user = { name: "Test Musician", email: "musician@example.com", workspaces: [{ name: "Test Band", kind: "band", role: "owner" }] };
  const call = (body: unknown) =>
    handleMcpPost(new Request(MCP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), user);

  it("initializes, lists tools and calls whoami", async () => {
    const init = (await (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json()) as any;
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = (await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["whoami"]);
    const res = (await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } })).json()) as any;
    expect(res.result.content[0].text).toContain("Signed in as Test Musician");
  });
});
