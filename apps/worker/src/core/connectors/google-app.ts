// The app's Google client as services see it: consent links, codes for tokens, fresh access
// tokens. The client secret stays in here. With CONNECTORS_FAKE=1 (tests only) a fake Google
// answers instead (fake-google.ts), so tests never reach Google.
import { accessToken, exchangeCode, googleAuthUrl, revokeToken } from "../google.ts";
import { fakeGoogle } from "./fake-google.ts";

export interface GoogleApp {
  configured: boolean;
  /** Tests only: the fake calendar stands in for Google Calendar. */
  fake: boolean;
  authUrl(o: { redirectUri: string; state: string; scope: string }): string;
  exchange(code: string, redirectUri: string): Promise<string>;
  access(refreshToken: string): Promise<string>;
  revoke(token: string): Promise<void>;
}

export function googleApp(env: Env): GoogleApp {
  const e = env as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; CONNECTORS_FAKE?: string };
  if (e.CONNECTORS_FAKE === "1") return fakeGoogle;
  const clientId = e.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = e.GOOGLE_CLIENT_SECRET ?? "";
  return {
    configured: !!(clientId && clientSecret),
    fake: false,
    authUrl: (o) => googleAuthUrl({ clientId, ...o }),
    exchange: (code, redirectUri) => exchangeCode({ clientId, clientSecret, redirectUri }, code),
    access: (refreshToken) => accessToken({ clientId, clientSecret, refreshToken }),
    revoke: (token) => revokeToken(token),
  };
}
