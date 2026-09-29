// Better Auth's browser client: sign-in (Google, passkeys), sessions, passkey management.
import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/auth",
  plugins: [passkeyClient()],
});

export interface PasskeyInfo {
  id: string;
  name: string | null;
  createdAt: string | null;
}

// online-only: sign-in and passkeys are handled by the server.
async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export const passkeys = {
  list: () => authFetch<PasskeyInfo[]>("/passkey/list-user-passkeys"),
  remove: (id: string) => authFetch<unknown>("/passkey/delete-passkey", { id }),
};

/**
 * The OAuth authorization request (from an MCP connector like Claude) that sent the
 * user to /login, if any. Better Auth signs it; we pass it back unchanged.
 */
export function oauthQuery(query: URLSearchParams): string | null {
  return query.has("client_id") && query.has("sig") ? query.toString() : null;
}

export async function signInWithGoogle(callbackURL: string, oauth: string | null) {
  // With an OAuth request, Better Auth resumes the connector flow after Google.
  const data = await authFetch<{ url: string }>("/sign-in/social", {
    provider: "google",
    callbackURL,
    ...(oauth ? { oauth_query: oauth } : {}),
  });
  window.location.href = data.url;
}
