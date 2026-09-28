// Access tokens (calendar feed links now, API tokens for Siri in T09): random secrets
// shown to their owner, looked up by SHA-256 hash, never logged.

/** A new random token like "cal_3q2…" (32 random bytes, base64url). */
export function newToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${prefix}_${b64}`;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
