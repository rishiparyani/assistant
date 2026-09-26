// T00 spike: Better Auth config. Throwaway code; see README.md.
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

export const AUTH_BASE_PATH = "/auth";
export const MCP_PATH = "/mcp";
export const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"];

export interface AuthConfig {
  baseURL: string;
  secret: string;
  // Anything Better Auth accepts: D1 binding in the Worker, node:sqlite in scripts/tests.
  database: BetterAuthOptions["database"];
  google?: { clientId: string; clientSecret: string };
  // Tests only: lets vitest create users without Google.
  emailAndPassword?: boolean;
}

export function authOptions(cfg: AuthConfig) {
  const mcpUrl = new URL(MCP_PATH, cfg.baseURL).toString();
  return {
    baseURL: cfg.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: cfg.secret,
    database: cfg.database,
    emailAndPassword: { enabled: cfg.emailAndPassword ?? false },
    socialProviders: cfg.google
      ? { google: { clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret } }
      : {},
    // Workspaces = organizations. `kind` distinguishes personal vs band.
    plugins: [
      organization({
        schema: {
          organization: {
            additionalFields: {
              kind: { type: "string", required: false, defaultValue: "band", input: true },
            },
          },
        },
      }),
      jwt(),
      // Makes the app an OAuth server so Claude/ChatGPT connectors can log in.
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        scopes: OAUTH_SCOPES,
        // MCP clients register themselves (RFC 7591 dynamic client registration).
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Access tokens are issued for the MCP endpoint as audience.
        resources: [mcpUrl],
        clientRegistrationDefaultResources: [mcpUrl],
      }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(cfg: AuthConfig) {
  return betterAuth(authOptions(cfg));
}

export type Auth = ReturnType<typeof createAuth>;
