// Web Push (RFC 8030) with VAPID (RFC 8292) and encrypted payloads (RFC 8291, aes128gcm),
// using only WebCrypto. The app's VAPID key pair is made on first use and kept sealed in
// D1 app_settings, so there's nothing for the owner to set up.
import { getSetting } from "../settings.ts";
import { sealerFor, type Sealer } from "../context.ts";

const enc = new TextEncoder();

export const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const unb64url = (text: string) =>
  Uint8Array.from(
    atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)),
    (c) => c.charCodeAt(0),
  );

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (what browsers call applicationServerKey). */
  publicKey: string;
  privateJwk: JsonWebKey;
}

/** Only real push services (the Worker sends requests to these addresses). */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
];
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** The app's VAPID keys, made and stored (sealed) the first time they're needed. */
export async function vapidKeys(d1: D1Database, sealer: Sealer): Promise<VapidKeys> {
  const stored = await getSetting(d1, "vapid_keys");
  if (stored) return JSON.parse(await sealer.unseal(stored)) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const keys: VapidKeys = {
    publicKey: b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
  };
  // Two first uses at once: the first one stored wins; everyone reads it back.
  await d1
    .prepare(`insert into app_settings (key, value) values ('vapid_keys', ?) on conflict (key) do nothing`)
    .bind(await sealer.seal(JSON.stringify(keys)))
    .run();
  return JSON.parse(await sealer.unseal((await getSetting(d1, "vapid_keys"))!)) as VapidKeys;
}

async function vapidHeader(keys: VapidKeys, endpoint: string, subject: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    keys.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

/** Encrypts a payload for one subscription (RFC 8291, one aes128gcm record). */
export async function encryptPayload(sub: PushSubscriptionKeys, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = unb64url(sub.p256dh);
  const authSecret = unb64url(sub.auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    // The standard name is `public` (workers-types spells it `$public`).
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      local.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(enc.encode("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))),
  );
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export type PushResult = "sent" | "gone" | "failed";

/** Sends one push. "gone" means the subscription no longer exists (remove it). */
export async function sendPush(
  env: Env,
  sub: PushSubscriptionKeys,
  message: unknown,
  fetcher: typeof fetch = fetch,
): Promise<PushResult> {
  if (!isPushEndpoint(sub.endpoint)) return "gone";
  const keys = await vapidKeys(env.DB, sealerFor(env));
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  try {
    const res = await fetcher(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: await vapidHeader(keys, sub.endpoint, env.BASE_URL),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(24 * 3600),
        urgency: "normal",
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
