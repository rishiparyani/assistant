// The gigs module's D1 tables: only the shared tag registry and people waiting for an
// account. Gigs themselves live in their own Durable Objects (docs/design/gig-centric.md).
import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { timestamp, user } from "../../core/db/schema.ts";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// --- Gig-centric (R1 step 5; docs/design/gig-centric.md §5 D1) ------------------------

export const TAG_KINDS = ["collective", "custom"] as const;

/**
 * The tag registry: one id per name and kind, so "Wedding" and "wedding" are one tag and
 * grouping survives across gigs and managers. Written only when a new tag is first used.
 */
export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: TAG_KINDS }).notNull(),
    name: text("name").notNull(),
    /** Lowercased, trimmed, single-spaced name: the uniqueness key. */
    nameKey: text("name_key").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    uniqueIndex("tags_kind_name_uidx").on(t.kind, t.nameKey),
    check("tags_kind_check", sql`${t.kind} in (${inList(TAG_KINDS)})`),
  ],
);

/**
 * People added to a gig by an email that has no account yet. When someone signs up with
 * that email, the gig attaches them (their Home then shows it) and the row is deleted.
 */
export const pendingPeople = sqliteTable(
  "pending_people",
  {
    email: text("email").notNull(),
    gigId: text("gig_id").notNull(),
    personId: text("person_id").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("pending_people_email_person_uidx").on(t.email, t.gigId, t.personId)],
);
