// Payment methods and dates shared by gig payments, payouts and expenses.
import { z } from "zod";
import { isDateOnly, isoDateIST } from "../../core/dates.ts";
export const PAYMENT_METHODS = ["cash", "upi", "bank", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A calendar date (YYYY-MM-DD, India). Defaults to today in India. */
export const dateOnly = z
  .string()
  .trim()
  .refine(isDateOnly, "Use a date like 2026-12-12")
  .optional()
  .transform((v) => v ?? isoDateIST(new Date().toISOString()))
  .describe("Date (YYYY-MM-DD); defaults to today in India");
