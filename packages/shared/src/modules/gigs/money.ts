// Payments, expenses, the band roster, lineups and payouts (docs/data-model.md).
import { z } from "zod";
import { isDateOnly, isoDateIST } from "../../core/dates.ts";
import { PageInput } from "../../core/pagination.ts";
import type { PaymentStatus } from "../../core/money.ts";
import { id, moneyFields, optionalText } from "./common.ts";
import { PAYMENT_METHODS_LIST } from "./constants.ts";

export const PAYMENT_METHODS = PAYMENT_METHODS_LIST;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A calendar date (YYYY-MM-DD, India). Defaults to today in India. */
export const dateOnly = z
  .string()
  .trim()
  .refine(isDateOnly, "Use a date like 2026-12-12")
  .optional()
  .transform((v) => v ?? isoDateIST(new Date().toISOString()))
  .describe("Date (YYYY-MM-DD); defaults to today in India");

// --- Client payments -------------------------------------------------------------

export const RecordPaymentInput = z.object({
  gig_id: id("Gig"),
  ...moneyFields("amount"),
  paid_on: dateOnly,
  method: z.enum(PAYMENT_METHODS).describe("cash, upi, bank, cheque or other"),
  note: optionalText(500),
});
export const PaymentRef = z.object({ payment_id: id("Payment"), note: optionalText(500) });

export interface PaymentView {
  id: string;
  gig_id: string;
  amount: { amount_paise: number; amount_display: string };
  paid_on: string;
  paid_on_display: string;
  method: PaymentMethod;
  note: string | null;
  /** Set on a correcting entry: the payment it cancels out. */
  reverses_payment_id: string | null;
  /** Set on a payment that has been corrected: the reversing entry. */
  reversed_by_payment_id: string | null;
  created_at: string;
}

// --- Expenses -----------------------------------------------------------------------

export const RecordExpenseInput = z.object({
  gig_id: id("Gig").optional().describe("Leave out for expenses not tied to one gig"),
  category: z.string().trim().min(1).max(60).describe("e.g. travel, food, equipment, rehearsal"),
  ...moneyFields("amount"),
  spent_on: dateOnly,
  note: optionalText(500),
});
export const ExpenseRef = z.object({ expense_id: id("Expense") });
export const FindExpensesInput = PageInput.extend({
  from: z.string().refine(isDateOnly).optional().describe("First date (YYYY-MM-DD), inclusive"),
  to: z.string().refine(isDateOnly).optional().describe("Last date (YYYY-MM-DD), inclusive"),
  gig_id: id("Gig").optional(),
});

export interface ExpenseView {
  id: string;
  gig_id: string | null;
  category: string;
  amount: { amount_paise: number; amount_display: string };
  spent_on: string;
  spent_on_display: string;
  note: string | null;
  created_at: string;
}

// --- Roster ---------------------------------------------------------------------------

const musicianFields = {
  phone: optionalText(40),
  email: optionalText(200),
  instrument: optionalText(60),
  notes: optionalText(2000),
  user_id: id("User")
    .nullish()
    .describe("Link to a workspace member's account (so they see their own share)"),
};
export const CreateMusicianInput = z.object({ name: z.string().trim().min(1).max(120), ...musicianFields });
export const UpdateMusicianInput = z.object({
  musician_id: id("Musician"),
  name: z.string().trim().min(1).max(120).optional(),
  ...musicianFields,
});
export const MusicianRef = z.object({ musician_id: id("Musician") });
export const FindMusiciansInput = PageInput.extend({ q: z.string().trim().max(120).optional() });

export interface MusicianView {
  id: string;
  name: string;
  instrument: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

// --- Lineup and payouts ---------------------------------------------------------------

export const LineupEntryInput = z.object({
  musician_id: id("Musician").optional(),
  musician_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Exact roster name (alternative to musician_id)"),
  role: optionalText(60).describe("e.g. lead guitar, dep"),
  ...moneyFields("share"),
  percent: z.number().min(0).max(100).optional().describe("Share as a percentage of the split total"),
});

export const SetLineupInput = z.object({
  gig_id: id("Gig"),
  lineup: z.array(LineupEntryInput).max(30).describe("The full lineup; replaces the current one"),
  split: z
    .enum(["equal"])
    .optional()
    .describe('"equal" divides the split total equally and ignores per-person shares'),
  ...moneyFields("split_total"),
});

export const RecordPayoutInput = z.object({
  gig_id: id("Gig"),
  musician_id: id("Musician").optional(),
  musician_name: z.string().trim().min(1).max(120).optional(),
  ...moneyFields("amount"),
  paid_on: dateOnly,
  method: z.enum(PAYMENT_METHODS),
  note: optionalText(500),
});
export const PayoutRef = z.object({ payout_id: id("Payout"), note: optionalText(500) });

export interface PayoutView {
  id: string;
  gig_id: string;
  musician: { id: string; name: string };
  amount: { amount_paise: number; amount_display: string };
  paid_on: string;
  paid_on_display: string;
  method: PaymentMethod;
  note: string | null;
  reverses_payout_id: string | null;
  reversed_by_payout_id: string | null;
  created_at: string;
}

export interface LineupEntryView {
  id: string;
  musician: { id: string; name: string; instrument: string | null; is_me: boolean };
  role: string | null;
  /** Amounts are null on other people's entries when a member (not an owner) asks. */
  share: { amount_paise: number; amount_display: string } | null;
  paid: { amount_paise: number; amount_display: string } | null;
  owed: { amount_paise: number; amount_display: string } | null;
  payout_status: PaymentStatus | null;
  payouts: PayoutView[];
}

type Money = { amount_paise: number; amount_display: string };

/** Everything about a gig's money. Members see the fee side, who plays, and their own share only. */
export interface GigMoneyView {
  gig: { id: string; title: string; status: string; start_display: string };
  visibility: "full" | "own_share";
  fee: Money;
  received: Money;
  /** fee − received (negative = overpaid). */
  balance: Money;
  payment_status: PaymentStatus;
  payments: PaymentView[];
  lineup: LineupEntryView[];
  /** Owners only (null for members). */
  expenses: ExpenseView[] | null;
  expenses_total: Money | null;
  shares_total: Money | null;
  /** fee − shares. */
  unallocated: Money | null;
  /** fee − shares − expenses; negative means the gig loses money. */
  net: Money | null;
}
