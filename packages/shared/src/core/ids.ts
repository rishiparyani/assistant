// ULIDs: 26-char, time-sortable, random IDs (architecture rule 4). No auto-increment
// anywhere, so rows can move between databases later.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now > 2 ** 48 - 1)
    throw new RangeError(`Invalid ULID time: ${now}`);
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32] + time;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = "";
  for (const b of bytes) random += ALPHABET[b % 32];
  return time + random;
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
