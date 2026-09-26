// Better Auth configuration (from the T00 spike). Shared by the Worker, the schema
// guard test and, in T03, the /auth routes. Workspaces = Better Auth organizations.
import type { BetterAuthOptions } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { ulid } from "@assistant/shared";

export const AUTH_BASE_PATH = "/auth";
export const MCP_PATH = "/mcp";
export const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"];

export interface AuthConfig {
  baseURL: string;
  secret: string;
  database: BetterAuthOptions["database"];
  google?: { clientId: string; clientSecret: string };
  /** Tests and localhost only: email/password so flows can run without Google. */
  emailAndPassword?: boolean;
}

export function authOptions(cfg: AuthConfig) {
  const mcpUrl = new URL(MCP_PATH, cfg.baseURL).toString();
  return {
    baseURL: cfg.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: cfg.secret,
    database: cfg.database,
    advanced: { database: { generateId: () => ulid() } },
    emailAndPassword: { enabled: cfg.emailAndPassword ?? false },
    socialProviders: cfg.google
      ? { google: { clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret } }
      : {},
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
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        scopes: OAUTH_SCOPES,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [mcpUrl],
        clientRegistrationDefaultResources: [mcpUrl],
      }),
    ],
  } satisfies BetterAuthOptions;
}
