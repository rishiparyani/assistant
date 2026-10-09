// Encrypts small secrets the app must keep in D1 (e.g. the Google Drive refresh token),
// with a key derived from BETTER_AUTH_SECRET (itself a Worker secret, never in git).
const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("assistant/app-secrets"), info: enc.encode("v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(plaintext));
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}

export async function decryptSecret(secret: string, sealed: string): Promise<string> {
  const [v, iv, data] = sealed.split(".");
  if (v !== "v1" || !iv || !data) throw new Error("Unknown sealed format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await key(secret),
    unb64(data),
  );
  return new TextDecoder().decode(plain);
}

/**
 * A secret value derived from `label` (HMAC with a key from BETTER_AUTH_SECRET, base64url,
 * 43 characters). The same label always gives the same value, so a retried request can
 * make the same link again without the link ever being stored.
 */
export async function deriveSecret(secret: string, label: string): Promise<string> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const hmac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("assistant/derived"), info: enc.encode("v1") },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, enc.encode(label)));
  return b64(mac).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
