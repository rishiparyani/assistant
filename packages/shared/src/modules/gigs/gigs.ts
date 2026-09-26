import { z } from "zod";
import { PageInput } from "../../core/pagination.ts";
import { dateTime, id, moneyFields, optionalText } from "./common.ts";

export const GIG_STATUSES = ["enquiry", "confirmed", "completed", "cancelled"] as const;
export type GigStatus = (typeof GIG_STATUSES)[number];

// A gig's client/venue can be given by id or by name. Names must match exactly one
// existing record (case-insensitive); otherwise the API returns candidates.
const links = {
  client_id: id("Client").nullish(),
  client_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Existing client's name (alternative to client_id)"),
  venue_id: id("Venue").nullish(),
  venue_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Existing venue's name (alternative to venue_id)"),
};

export const CreateGigInput = z.object({
  title: z.string().trim().min(1).max(160),
  event_type: optionalText(60).describe("e.g. wedding, corporate, club, concert"),
  start_at: dateTime,
  end_at: dateTime.optional(),
  status: z.enum(["enquiry", "confirmed"]).default("enquiry"),
  ...moneyFields("fee"),
  ...links,
  notes: optionalText(4000),
});

export const UpdateGigInput = z.object({
  gig_id: id("Gig"),
  title: z.string().trim().min(1).max(160).optional(),
  event_type: optionalText(60),
  start_at: dateTime.optional(),
  end_at: dateTime.nullish(),
  ...moneyFields("fee"),
  ...links,
  notes: optionalText(4000),
});

export const GigRef = z.object({ gig_id: id("Gig") });
export const CancelGigInput = GigRef.extend({ reason: optionalText(500) });

export const FindGigsInput = PageInput.extend({
  from: dateTime.optional().describe("Earliest start (inclusive)"),
  to: dateTime.optional().describe("Latest start (exclusive)"),
  status: z.enum(GIG_STATUSES).optional(),
  client_id: id("Client").optional(),
  venue_id: id("Venue").optional(),
  q: z.string().trim().max(120).optional().describe("Part of the title"),
  order: z.enum(["asc", "desc"]).default("asc").describe("By start time"),
});

export interface GigView {
  id: string;
  title: string;
  event_type: string | null;
  status: GigStatus;
  start_at: string;
  start_display: string;
  /** Calendar date in India (YYYY-MM-DD). */
  date: string;
  end_at: string | null;
  end_display: string | null;
  client: { id: string; name: string } | null;
  venue: { id: string; name: string; city: string | null } | null;
  fee: { amount_paise: number; amount_display: string };
  notes: string | null;
  created_at: string;
  updated_at: string;
}
