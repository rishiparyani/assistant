// Cursor pagination (docs/api.md): `?cursor=&limit=` → `{ items, next_cursor }`.
import { z } from "zod";

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

export const PageInput = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** Opaque cursor: base64url JSON of the last row's sort keys. */
export function encodeCursor(keys: (string | number | null)[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(keys));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string): (string | number | null)[] | null {
  try {
    const bin = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const keys: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return Array.isArray(keys) ? (keys as (string | number | null)[]) : null;
  } catch {
    return null;
  }
}
