// Access tokens for MCP (T10): issued by Better Auth's OAuth provider when someone connects
// an AI assistant and approves it on the consent page. JWTs for this server's /mcp are
// verified in-process (keys read from Better Auth, no self-fetch); opaque tokens fall back
// to the userinfo endpoint.
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { getAuth } from "../auth/auth.ts";
import { MCP_PATH } from "../auth/options.ts";
import type { UserCreatedHook } from "../module.ts";

export const mcpUrl = (baseUrl: string) => new URL(MCP_PATH, baseUrl).toString();
export const resourceMetadataUrl = (baseUrl: string) =>
  new URL("/.well-known/oauth-protected-resource/mcp", baseUrl).toString();

type Auth = ReturnType<typeof getAuth>;

export async function issuer(auth: Auth): Promise<string> {
  return ((await auth.api.getOAuthServerConfig()) as { issuer: string }).issuer;
}

/** The user id for a valid MCP access token, or null. */
export async function mcpUserId(
  env: Env,
  userCreated: readonly UserCreatedHook[],
  token: string,
): Promise<string | null> {
  const auth = getAuth({ env, userCreated });
  try {
    if (token.split(".").length === 3) {
      const payload = await verifyJwsAccessToken(token, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth's JWKS type
        jwksFetch: async () => (await auth.api.getJwks()) as any,
        verifyOptions: { audience: mcpUrl(env.BASE_URL), issuer: await issuer(auth) },
      });
      return typeof payload.sub === "string" ? payload.sub : null;
    }
    const info = (await auth.api.oauth2UserInfo({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })) as { sub?: string } | null;
    return info?.sub ?? null;
  } catch {
    return null;
  }
}
