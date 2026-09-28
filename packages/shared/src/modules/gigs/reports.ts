// Home and reports for gig-centric gigs (docs/design/gig-centric.md §7): built only from
// the caller's own summaries, so they add up only the caller's money (players: their
// share; managers: the full money of gigs they manage).
import { z } from "zod";
import { isDateOnly } from "../../core/dates.ts";
import type { MyEventView } from "./booking.ts";

type Money = { amount_paise: number; amount_display: string };

/** A gig with money still to settle, for Home's lists. */
export interface GigAmount {
  gig_id: string;
  gig_title: string;
  client_name: string | null;
  first_start_at: string;
  first_start_display: string;
  amount: Money;
}

export interface HomeView {
  /** My next events (not cancelled), soonest first (max 8). */
  upcoming: MyEventView[];
  this_month: {
    label: string;
    /** Gigs starting this month (not cancelled). */
    gigs: number;
    /** My shares for those gigs. */
    earned: Money;
    /** Paid to me so far for those gigs. */
    received: Money;
  };
  /** Played gigs where my share isn't fully paid yet. */
  owed_to_me: { total: Money; gigs: GigAmount[] };
  /** Gigs I manage: still due from clients (played gigs). */
  to_collect: { total: Money; gigs: GigAmount[] };
  /** Gigs I manage: shares not yet paid out to the people playing (played gigs). */
  to_pay: { total: Money; gigs: GigAmount[] };
}

const day = z.string().trim().refine(isDateOnly, "Use a date like 2026-12-12");

export const MyReportInput = z.object({
  from: day.describe("First day (YYYY-MM-DD, India), inclusive"),
  to: day.describe("Last day (YYYY-MM-DD, India), inclusive"),
  status: z
    .enum(["enquiry", "confirmed", "completed", "cancelled"])
    .optional()
    .describe("Only gigs with this status (default: all but cancelled)"),
  role: z.enum(["manager", "player"]).optional().describe("Only gigs where I have this role"),
  client: z.string().trim().min(1).max(120).optional().describe("Only this client (exact name)"),
});

/** Totals for gigs I manage (null when there are none in the report). */
export interface ManagedTotals {
  gigs: number;
  fee: Money;
  received: Money;
  /** fee − received. */
  due: Money;
  expenses: Money;
  shares: Money;
  paid_out: Money;
  /** fee − shares − expenses. */
  net: Money;
}

export interface MyTotals {
  gigs: number;
  share: Money;
  paid: Money;
  owed: Money;
}

export interface ReportGigRow {
  gig_id: string;
  gig_title: string;
  client_name: string | null;
  event_type: string | null;
  status: string;
  role: "manager" | "player";
  first_start_at: string;
  first_start_display: string;
  share: Money;
  paid: Money;
  owed: Money;
  /** Managers only. */
  fee: Money | null;
  received: Money | null;
  net: Money | null;
}

export interface ReportMonth {
  month: string;
  label: string;
  mine: MyTotals;
  managed: ManagedTotals | null;
}

export interface MyReportView {
  from: string;
  to: string;
  mine: MyTotals;
  managed: ManagedTotals | null;
  by_month: ReportMonth[];
  gigs: ReportGigRow[];
}
