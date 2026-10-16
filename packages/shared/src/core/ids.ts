// ULIDs: 26-char, time-sortable, random IDs (architecture rule 4). No auto-increment
// anywhere, so rows can move between databases later.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now > 2 ** 48 - 1)
    throw new RangeError(`Invalid ULID time: ${now}`);
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32] + time;
  let random = "";
  for (const b of randomBytes(16)) random += ALPHABET[b % 32];
  return time + random;
}

/**
 * 16 random bytes. The Web Crypto API where there is one (browsers, Workers, Node); the phone's
 * JavaScript engine (Hermes) has no `crypto` global, and an id made on the device only needs to
 * be unique, not secret, so Math.random stands in there (the phone's Expenses list crashed on
 * this, 2026-10-15: "Property 'crypto' doesn't exist").
 */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_RE.test(value);
}

/** Milliseconds since epoch encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new TypeError(`Not a ULID: ${id}`);
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
