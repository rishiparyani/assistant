// Helpers shared by the gigs services.
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { decodeCursor, encodeCursor, type Page } from "@assistant/shared";
import { AppError } from "../../../core/errors.ts";

export const nowIso = () => new Date().toISOString();

/** Escapes LIKE wildcards so user text is matched literally. */
export function likeContains(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** `lower(col) like ? escape '\'` */
export function contains(col: SQLiteColumn, text: string): SQL {
  return sql`lower(${col}) like ${likeContains(text)} escape '\\'`;
}

/** Keyset condition for rows after the cursor, ordered by (key, id). */
export function afterCursor(
  keyCol: SQL | SQLiteColumn,
  idCol: SQLiteColumn,
  cursor: string | undefined,
  dir: "asc" | "desc" = "asc",
): SQL | undefined {
  if (!cursor) return undefined;
  const keys = decodeCursor(cursor);
  if (!keys || keys.length !== 2 || typeof keys[1] !== "string") {
    throw new AppError("validation_failed", "Invalid cursor");
  }
  const [k, id] = keys;
  return dir === "asc"
    ? sql`(${keyCol} > ${k} or (${keyCol} = ${k} and ${idCol} > ${id}))`
    : sql`(${keyCol} < ${k} or (${keyCol} = ${k} and ${idCol} < ${id}))`;
}

/** Takes `limit + 1` rows and returns a page with the next cursor. */
export function toPage<R, V>(
  rows: R[],
  limit: number,
  key: (r: R) => [string | number, string],
  view: (r: R) => V,
): Page<V> {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items: items.map(view), next_cursor: more && last ? encodeCursor(key(last)) : null };
}

/**
 * Picks the provided fields of `input` for an update: undefined = not given (keep),
 * null = clear. Returns [column, value] pairs.
 */
export function changedFields<T extends Record<string, unknown>>(
  input: T,
  columns: Partial<Record<keyof T, string>>,
): [string, unknown][] {
  return Object.entries(columns)
    .filter(([field]) => input[field] !== undefined)
    .map(([field, column]) => [column as string, input[field]]);
}

/** Builds `update <table> set a = ?, b = ?, updated_at = ? where id = ? and workspace_id = ?`. */
export function updateStatement(
  d1: D1Database,
  table: string,
  fields: [string, unknown][],
  id: string,
  workspaceId: string,
): D1PreparedStatement {
  const all: [string, unknown][] = [...fields, ["updated_at", nowIso()]];
  return d1
    .prepare(
      `update ${table} set ${all.map(([c]) => `${c} = ?`).join(", ")} where id = ? and workspace_id = ?`,
    )
    .bind(...all.map(([, v]) => v), id, workspaceId);
}
