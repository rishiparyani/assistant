// Core tables owned by the app (docs/data-model.md). Conventions: ULID text ids,
// snake_case, UTC ISO timestamps as text, workspace_id on tenant rows, indexes on
// every filtered column.
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organization, user } from "./auth-schema.ts";

export * from "./auth-schema.ts";

/** UTC ISO timestamp, defaulting to now (e.g. 2026-09-26T12:00:00.000Z). */
export const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const workspaceId = () =>
  text("workspace_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

export const SOURCES = ["web", "siri", "mcp", "system"] as const;
export type Source = (typeof SOURCES)[number];

/** Which modules each workspace uses. */
export const workspaceModules = sqliteTable(
  "workspace_modules",
  {
    workspaceId: workspaceId(),
    moduleId: text("module_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    settingsJson: text("settings_json"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.moduleId] })],
);

/** Scoped, revocable tokens for Siri Shortcuts and scripts. Only the hash is stored. */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null = all of the user's workspaces.
    workspaceId: text("workspace_id").references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopesJson: text("scopes_json").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("api_tokens_user_id_idx").on(t.userId)],
);

/** Stored responses for `Idempotency-Key`, kept 24 h. */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_keys_created_at_idx").on(t.createdAt),
  ],
);

/** Two-step writes from MCP: preview issues one, commit consumes it. */
export const confirmTokens = sqliteTable(
  "confirm_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: workspaceId(),
    operationId: text("operation_id").notNull(),
    inputHash: text("input_hash").notNull(),
    previewJson: text("preview_json").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("confirm_tokens_user_id_idx").on(t.userId),
    index("confirm_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

/** Every write: who, from where, what changed. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    source: text("source", { enum: SOURCES }).notNull(),
    module: text("module").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("audit_log_entity_idx").on(t.workspaceId, t.entityType, t.entityId),
    check("audit_log_source_check", sql`${t.source} in ('web', 'siri', 'mcp', 'system')`),
  ],
);
