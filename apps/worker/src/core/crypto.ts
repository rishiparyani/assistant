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

// --- Files (backups) --------------------------------------------------------------------------
// A backup is encrypted with a key the owner holds (the BACKUP_KEY secret), so a copy in Drive
// is unreadable without it. Format: "GSPB1" + salt (16) + iv (12) + AES-256-GCM ciphertext;
// the key is PBKDF2-SHA256 (600k rounds) of the passphrase and the salt, so the same passphrase
// typed at restore time opens the file wherever it is read.
const FILE_MAGIC = enc.encode("GSPB1");
const FILE_ROUNDS = 600_000;

async function fileKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: FILE_ROUNDS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Whether these bytes are an encrypted file made by encryptFile. */
export const isEncryptedFile = (data: Uint8Array) =>
  data.length > FILE_MAGIC.length + 28 && FILE_MAGIC.every((b, i) => data[i] === b);

export async function encryptFile(passphrase: string, data: Uint8Array): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await fileKey(passphrase, salt), data),
  );
  const out = new Uint8Array(FILE_MAGIC.length + salt.length + iv.length + sealed.length);
  out.set(FILE_MAGIC, 0);
  out.set(salt, FILE_MAGIC.length);
  out.set(iv, FILE_MAGIC.length + salt.length);
  out.set(sealed, FILE_MAGIC.length + salt.length + iv.length);
  return out;
}

/** The plain bytes back; throws when the key is wrong or the file was changed. */
export async function decryptFile(passphrase: string, data: Uint8Array): Promise<Uint8Array> {
  if (!isEncryptedFile(data)) throw new Error("Not an encrypted file");
  const salt = data.subarray(FILE_MAGIC.length, FILE_MAGIC.length + 16);
  const iv = data.subarray(FILE_MAGIC.length + 16, FILE_MAGIC.length + 28);
  const body = data.subarray(FILE_MAGIC.length + 28);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await fileKey(passphrase, salt), body),
    );
  } catch {
    throw new Error("That key doesn't open this backup");
  }
}
