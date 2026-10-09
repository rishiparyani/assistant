// Core tables owned by the app in D1 (identity and admin only; gigs live in Durable
// Objects, docs/design/gig-centric.md §4). Conventions: ULID text ids, snake_case, UTC
// ISO timestamps as text, indexes on every filtered column.
import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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

/** Small app-wide settings (e.g. the Telegram chat for alerts, alerts on/off). Written rarely. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at"),
});

/**
 * One row per health check (design §10a): whether it's failing and when we last told the
 * owner. Written only when a check changes state, or for the daily reminder.
 */
export const alertState = sqliteTable("alert_state", {
  id: text("id").primaryKey(),
  firing: text("firing").notNull().default("no"),
  message: text("message"),
  since: text("since"),
  lastSentAt: text("last_sent_at"),
});

/**
 * Secrets people use to reach their own data without signing in: a private calendar feed
 * link (kind "calendar", one per person) and, from T09, API tokens for Siri Shortcuts.
 * Only a SHA-256 hash is used to look them up; calendar links are also kept sealed
 * (encrypted) so the settings page can show them again. Written only when created or revoked.
 */
export const accessTokens = sqliteTable(
  "access_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["calendar", "api"] }).notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    sealed: text("sealed"),
    scopes: text("scopes").notNull().default(""),
    createdAt: timestamp("created_at"),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    /** The Idempotency-Key of the request that made it (a retry returns the same token). */
    requestKey: text("request_key"),
  },
  (t) => [
    uniqueIndex("access_tokens_hash_idx").on(t.tokenHash),
    index("access_tokens_user_idx").on(t.userId, t.kind),
    index("access_tokens_request_idx").on(t.requestKey),
  ],
);

/** What people did to their own account-level settings (tokens, feeds). */
export const userAudit = sqliteTable(
  "user_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    source: text("source", { enum: SOURCES }).notNull(),
    action: text("action").notNull(),
    entityId: text("entity_id").notNull(),
    detailJson: text("detail_json"),
    /** The Idempotency-Key of the request (a repeat of it doesn't act again). */
    requestKey: text("request_key"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("user_audit_user_idx").on(t.userId, t.createdAt),
    index("user_audit_request_idx").on(t.userId, t.requestKey),
  ],
);

/**
 * Spaces (docs/design/universal.md): which spaces exist and who is in them, for listing
 * "my spaces". Everything inside a space (collections, records, rules) lives in its own
 * Durable Object, which also checks roles itself. Written only when a space is created or
 * its members change. One personal space per user (unique index).
 */
export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["personal", "shared"] }).notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("spaces_owner_idx").on(t.ownerUserId),
    uniqueIndex("spaces_personal_idx")
      .on(t.ownerUserId)
      .where(sql`kind = 'personal'`),
  ],
);

export const spaceMembers = sqliteTable(
  "space_members",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    addedAt: timestamp("added_at"),
  },
  (t) => [
    uniqueIndex("space_members_pk").on(t.spaceId, t.userId),
    index("space_members_user_idx").on(t.userId),
  ],
);

/**
 * Cards shared with a person (design §11), for their "Shared with me" list: which space holds
 * each share they joined. The share itself (link hash, access, hidden fields, who joined)
 * lives in the space's object, which checks every open and edit. Written on join and leave.
 */
export const sharedWith = sqliteTable(
  "shared_with",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    shareId: text("share_id").notNull(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at"),
  },
  (t) => [
    uniqueIndex("shared_with_pk").on(t.userId, t.shareId),
    index("shared_with_space_idx").on(t.spaceId),
  ],
);
