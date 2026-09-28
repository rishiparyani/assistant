// Core tables owned by the app in D1 (identity and admin only; gigs live in Durable
// Objects, docs/design/gig-centric.md §4). Conventions: ULID text ids, snake_case, UTC
// ISO timestamps as text, indexes on every filtered column.
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.ts";

export * from "./auth-schema.ts";

/** UTC ISO timestamp, defaulting to now (e.g. 2026-09-26T12:00:00.000Z). */
export const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const SOURCES = ["web", "siri", "mcp", "system"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Admins added from the admin panel (the owner list in the ADMIN_EMAILS secret is always
 * admin too, so nobody can lock themselves out). Written rarely.
 */
export const admins = sqliteTable("admins", {
  email: text("email").primaryKey(),
  addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at"),
});

/** What admins did in the admin panel. */
export const adminAudit = sqliteTable(
  "admin_audit",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    detailJson: text("detail_json"),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);
