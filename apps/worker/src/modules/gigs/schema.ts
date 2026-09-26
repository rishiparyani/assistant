// Gigs module tables (docs/data-model.md). Balances, owed amounts and payment status
// are derived from these rows, never stored (architecture rule 6).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { timestamp, user, workspaceId } from "../../core/db/schema.ts";

export const GIG_STATUSES = ["enquiry", "confirmed", "completed", "cancelled"] as const;
export const PAYMENT_METHODS = ["cash", "upi", "bank", "cheque", "other"] as const;

const createdBy = () =>
  text("created_by")
    .notNull()
    .references(() => user.id);
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
// Date-only fields are YYYY-MM-DD in Asia/Kolkata (docs/conventions.md).
const isDate = (col: AnySQLiteColumn) => sql`${col} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    organisation: text("organisation"),
    notes: text("notes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("clients_workspace_name_idx").on(t.workspaceId, t.name)],
);

export const venues = sqliteTable(
  "venues",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    city: text("city"),
    address: text("address"),
    notes: text("notes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("venues_workspace_name_idx").on(t.workspaceId, t.name)],
);

export const gigs = sqliteTable(
  "gigs",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    clientId: text("client_id").references(() => clients.id),
    venueId: text("venue_id").references(() => venues.id),
    title: text("title").notNull(),
    eventType: text("event_type"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at"),
    status: text("status", { enum: GIG_STATUSES }).notNull().default("enquiry"),
    feePaise: integer("fee_paise").notNull().default(0),
    notes: text("notes"),
    createdBy: createdBy(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("gigs_workspace_start_idx").on(t.workspaceId, t.startAt),
    index("gigs_workspace_client_idx").on(t.workspaceId, t.clientId),
    index("gigs_workspace_status_idx").on(t.workspaceId, t.status),
    index("gigs_venue_idx").on(t.venueId),
    check("gigs_status_check", sql`${t.status} in (${inList(GIG_STATUSES)})`),
    check("gigs_fee_check", sql`${t.feePaise} >= 0`),
    check("gigs_end_after_start_check", sql`${t.endAt} is null or ${t.endAt} >= ${t.startAt}`),
  ],
);

/** Money received from the client. Append-only: corrections are negative reversals. */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    gigId: text("gig_id")
      .notNull()
      .references(() => gigs.id),
    amountPaise: integer("amount_paise").notNull(),
    paidOn: text("paid_on").notNull(),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    reversesPaymentId: text("reverses_payment_id").references((): AnySQLiteColumn => payments.id),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("payments_workspace_gig_idx").on(t.workspaceId, t.gigId),
    index("payments_workspace_paid_on_idx").on(t.workspaceId, t.paidOn),
    uniqueIndex("payments_reverses_uidx").on(t.reversesPaymentId),
    check("payments_amount_check", sql`${t.amountPaise} <> 0`),
    check("payments_method_check", sql`${t.method} in (${inList(PAYMENT_METHODS)})`),
    check("payments_paid_on_check", isDate(t.paidOn)),
    // A reversal is negative and points at what it reverses; a payment is positive.
    check(
      "payments_reversal_check",
      sql`(${t.reversesPaymentId} is null and ${t.amountPaise} > 0) or (${t.reversesPaymentId} is not null and ${t.amountPaise} < 0)`,
    ),
  ],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    gigId: text("gig_id").references(() => gigs.id),
    category: text("category").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    spentOn: text("spent_on").notNull(),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("expenses_workspace_spent_on_idx").on(t.workspaceId, t.spentOn),
    index("expenses_gig_idx").on(t.gigId),
    check("expenses_amount_check", sql`${t.amountPaise} > 0`),
    check("expenses_spent_on_check", isDate(t.spentOn)),
  ],
);

/** A band's roster. Not every musician has an account (deps, session players). */
export const musicians = sqliteTable(
  "musicians",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    instrument: text("instrument"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("musicians_workspace_name_idx").on(t.workspaceId, t.name),
    index("musicians_user_idx").on(t.userId),
  ],
);

/** Who plays a gig and their agreed share. */
export const gigLineup = sqliteTable(
  "gig_lineup",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    gigId: text("gig_id")
      .notNull()
      .references(() => gigs.id),
    musicianId: text("musician_id")
      .notNull()
      .references(() => musicians.id),
    role: text("role"),
    sharePaise: integer("share_paise").notNull().default(0),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    uniqueIndex("gig_lineup_gig_musician_uidx").on(t.gigId, t.musicianId),
    index("gig_lineup_workspace_gig_idx").on(t.workspaceId, t.gigId),
    index("gig_lineup_workspace_musician_idx").on(t.workspaceId, t.musicianId),
    check("gig_lineup_share_check", sql`${t.sharePaise} >= 0`),
  ],
);

/** Money paid by the band to a musician. Append-only, like payments. */
export const payouts = sqliteTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    gigId: text("gig_id")
      .notNull()
      .references(() => gigs.id),
    musicianId: text("musician_id")
      .notNull()
      .references(() => musicians.id),
    amountPaise: integer("amount_paise").notNull(),
    paidOn: text("paid_on").notNull(),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    reversesPayoutId: text("reverses_payout_id").references((): AnySQLiteColumn => payouts.id),
    note: text("note"),
    createdBy: createdBy(),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("payouts_workspace_gig_idx").on(t.workspaceId, t.gigId),
    index("payouts_workspace_musician_idx").on(t.workspaceId, t.musicianId),
    uniqueIndex("payouts_reverses_uidx").on(t.reversesPayoutId),
    check("payouts_amount_check", sql`${t.amountPaise} <> 0`),
    check("payouts_method_check", sql`${t.method} in (${inList(PAYMENT_METHODS)})`),
    check("payouts_paid_on_check", isDate(t.paidOn)),
    check(
      "payouts_reversal_check",
      sql`(${t.reversesPayoutId} is null and ${t.amountPaise} > 0) or (${t.reversesPayoutId} is not null and ${t.amountPaise} < 0)`,
    ),
  ],
);
