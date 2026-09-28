// Money on a gig-centric gig (docs/design/gig-centric.md §2 point 7, §3): client payments
// and expenses belong to the gig; lineup shares belong to events; payouts belong to people.
// Append-only with reversing entries; balances and statuses are derived, never stored.
import { z } from "zod";
import type { PaymentStatus } from "../../core/money.ts";
import { BookingRef } from "./booking.ts";
import { id, moneyFields, optionalText } from "./common.ts";
import { PAYMENT_METHODS, dateOnly, type PaymentMethod } from "./money.ts";

/** Someone on the gig: their person_id, or their exact name on this gig. */
const personPick = {
  person_id: id("Person").optional(),
  person_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Exact name as on this gig (alternative to person_id)"),
};

export const RecordGigPaymentInput = BookingRef.extend({
  ...moneyFields("amount"),
  paid_on: dateOnly,
  method: z.enum(PAYMENT_METHODS).describe("cash, upi, bank, cheque or other"),
  note: optionalText(500),
});
export const GigPaymentRef = BookingRef.extend({
  payment_id: id("Payment"),
  note: optionalText(500).describe("Why it's being reversed"),
});

export const RecordGigExpenseInput = BookingRef.extend({
  event_id: id("Event").optional().describe("Leave out for gig-wide expenses"),
  category: z.string().trim().min(1).max(60).describe("e.g. travel, food, equipment, rehearsal"),
  ...moneyFields("amount"),
  spent_on: dateOnly,
  note: optionalText(500),
});
export const GigExpenseRef = BookingRef.extend({ expense_id: id("Expense") });

export const LineupInputEntry = z.object({
  ...personPick,
  part: optionalText(60).describe('e.g. "drums", "lead guitar", "dep"'),
  ...moneyFields("share"),
  percent: z.number().min(0).max(100).optional().describe("Share as a percentage of split_total"),
});

export const SetEventLineupInput = BookingRef.extend({
  event_id: id("Event"),
  version: z.number().int().min(1).describe("The gig's version you last saw"),
  lineup: z.array(LineupInputEntry).max(40).describe("The event's full lineup; replaces the current one"),
  split: z
    .enum(["equal"])
    .optional()
    .describe('"equal" divides split_total equally and ignores per-person shares'),
  ...moneyFields("split_total"),
});

export const RecordGigPayoutInput = BookingRef.extend({
  ...personPick,
  event_id: id("Event").optional().describe("Optional: the event this payout is for"),
  ...moneyFields("amount"),
  paid_on: dateOnly,
  method: z.enum(PAYMENT_METHODS),
  note: optionalText(500),
});
export const GigPayoutRef = BookingRef.extend({
  payout_id: id("Payout"),
  note: optionalText(500).describe("Why it's being reversed"),
});

// --- Views ---------------------------------------------------------------------------

type Money = { amount_paise: number; amount_display: string };

export interface GigPaymentView {
  id: string;
  /** "refund": money returned to the client (e.g. when a gig is cancelled). */
  kind: "payment" | "refund";
  amount: Money;
  paid_on: string;
  paid_on_display: string;
  method: PaymentMethod;
  note: string | null;
  /** Set on a correcting entry: the payment it cancels out. */
  reverses_id: string | null;
  /** Set on a payment that has been corrected: the correcting entry. */
  reversed_by_id: string | null;
  created_at: string;
}

export interface GigPayoutView extends GigPaymentView {
  person_id: string;
  event_id: string | null;
}

export interface GigExpenseView {
  id: string;
  event_id: string | null;
  category: string;
  amount: Money;
  spent_on: string;
  spent_on_display: string;
  note: string | null;
  created_at: string;
}

/** One person on an event's lineup. `share` is null when the caller may not see it. */
export interface LineupView {
  id: string;
  person_id: string;
  name: string;
  part: string | null;
  is_me: boolean;
  share: Money | null;
}

/** One person's money on the gig: shares across events, paid to them, still owed. */
export interface PayeeView {
  person_id: string;
  name: string;
  is_me: boolean;
  share: Money;
  paid: Money;
  /** share − paid (negative = paid too much). */
  owed: Money;
  status: PaymentStatus;
  payouts: GigPayoutView[];
}

/**
 * The gig's money as the caller may see it. Managers see everything; players see their
 * own share always, and more only when the gig's settings allow.
 */
export interface GigMoney {
  can_manage: boolean;
  /** Fee side (fee, payments, balance); null fields when hidden. */
  fee: Money | null;
  /** Cancelled gigs: what was kept (paid and not refunded), which is the gig's income. */
  kept: Money | null;
  received: Money | null;
  /** fee − received (negative = overpaid). */
  balance: Money | null;
  payment_status: PaymentStatus | null;
  payments: GigPaymentView[] | null;
  /** The caller's own share, paid and owed (zeros if they're not on any lineup). */
  mine: PayeeView;
  /** Everyone with a share or a payout; null when hidden. */
  payees: PayeeView[] | null;
  /** Managers only from here on. */
  expenses: GigExpenseView[] | null;
  expenses_total: Money | null;
  shares_total: Money | null;
  /** fee − shares. */
  unallocated: Money | null;
  /** fee − shares − expenses; negative means the gig loses money. */
  net: Money | null;
}
