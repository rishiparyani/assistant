// Google sign-in for the app's own access to Google services (Drive backups, connectors):
// the consent link, swapping its code for a refresh token, and a fresh access token for each
// use. One Google client for everything (GOOGLE_CLIENT_ID/SECRET, the sign-in client).
type Fetch = typeof fetch;

export function googleAuthUrl(o: { clientId: string; redirectUri: string; state: string; scope: string }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: o.scope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: o.state,
  }).toString();
  return u.toString();
}

async function tokenRequest(body: Record<string, string>, f: Fetch) {
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token)
    throw new Error(`Google token request failed (${res.status} ${json.error ?? ""})`);
  return json;
}

export async function exchangeCode(
  cfg: { clientId: string; clientSecret: string; redirectUri: string },
  code: string,
  f: Fetch = fetch,
): Promise<string> {
  const t = await tokenRequest(
    {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    },
    f,
  );
  if (!t.refresh_token)
    throw new Error("Google didn't return a refresh token; remove the app's access and connect again");
  return t.refresh_token;
}

export async function accessToken(
  cfg: { clientId: string; clientSecret: string; refreshToken: string },
  f: Fetch = fetch,
): Promise<string> {
  const t = await tokenRequest(
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    },
    f,
  );
  return t.access_token!;
}

/** Tells Google to forget the app's access (disconnect). Best effort. */
export async function revokeToken(token: string, f: Fetch = fetch): Promise<void> {
  await f(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token })}`, { method: "POST" }).catch(
    () => undefined,
  );
}
