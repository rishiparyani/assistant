// Gig-centric API shapes (docs/design/gig-centric.md). Internally a gig is a "booking"
// (one engagement, one or more events); people see "Gig" and "Events".
import { z } from "zod";
import { PageInput } from "../../core/pagination.ts";
import { dateTime, id, moneyFields, optionalText } from "./common.ts";
import type { GigMoney, LineupView } from "./booking-money.ts";

export const BOOKING_ROLES = ["manager", "player"] as const;
export type BookingRole = (typeof BOOKING_ROLES)[number];

/** Who may see what on a gig (managers always see everything). */
export const GIG_SETTINGS_DEFAULTS = {
  players_see_lineup: true,
  players_see_fee: false,
  players_see_shares: false,
} as const;
export type GigSettings = { [K in keyof typeof GIG_SETTINGS_DEFAULTS]: boolean };

export const GigSettingsInput = z
  .object({
    players_see_lineup: z.boolean().optional().describe("Players see who's playing (default yes)"),
    players_see_fee: z.boolean().optional().describe("Players see the fee and client payments (default no)"),
    players_see_shares: z
      .boolean()
      .optional()
      .describe("Players see everyone's shares and payouts (default no)"),
  })
  .describe("Change only the settings you give");

const title = z.string().trim().min(1).max(160);
const name = z.string().trim().min(1).max(120);

/** Client details kept on the gig itself (a snapshot; editing an address book never changes gigs). */
export const ClientSnapshot = z.object({
  name,
  phone: optionalText(40),
  organisation: optionalText(120),
});

export const EventInput = z.object({
  title: optionalText(80).describe('e.g. "Sangeet", "Reception"; optional for single-event gigs'),
  start_at: dateTime,
  end_at: dateTime.nullish(),
  venue_name: optionalText(120),
  venue_city: optionalText(80),
  notes: optionalText(2000),
});

export const PersonInput = z
  .object({
    user_id: id("User").optional().describe("Someone with an account"),
    email: z.email().trim().toLowerCase().optional().describe("Matched to an account if one exists"),
    name: name.optional().describe("Needed for people without an account"),
    phone: optionalText(40),
    role: z.enum(BOOKING_ROLES).default("player"),
  })
  .refine((p) => p.user_id || p.email || p.name, "Give a user_id, an email or a name");

export const CreateBookingInput = z.object({
  title,
  event_type: optionalText(60).describe("e.g. wedding, corporate, club, concert"),
  status: z.enum(["enquiry", "confirmed"]).default("enquiry"),
  client: ClientSnapshot.nullish(),
  notes: optionalText(4000),
  ...moneyFields("fee"),
  settings: GigSettingsInput.optional(),
  events: z.array(EventInput).min(1).max(20).describe("At least one event"),
  people: z.array(PersonInput).max(100).default([]).describe("You are added as a manager"),
});

export const BookingRef = z.object({ gig_id: id("Gig") });
const version = z
  .number()
  .int()
  .min(1)
  .describe("The gig's version you last saw (edits are refused if it changed)");

export const UpdateBookingInput = BookingRef.extend({
  version,
  title: title.optional(),
  event_type: optionalText(60),
  client: ClientSnapshot.nullish(),
  notes: optionalText(4000),
  ...moneyFields("fee"),
  settings: GigSettingsInput.optional(),
});

export const BookingStatusInput = BookingRef.extend({
  action: z.enum(["confirm", "complete", "cancel"]),
  reason: optionalText(500),
});

export const AddEventInput = BookingRef.extend(EventInput.shape);
export const UpdateEventInput = BookingRef.extend({
  event_id: id("Event"),
  version,
  title: optionalText(80),
  start_at: dateTime.optional(),
  end_at: dateTime.nullish(),
  venue_name: optionalText(120),
  venue_city: optionalText(80),
  notes: optionalText(2000),
});
export const EventRef = BookingRef.extend({ event_id: id("Event") });

export const AddPersonInput = BookingRef.extend({
  user_id: id("User").optional(),
  email: z.email().trim().toLowerCase().optional(),
  name: name.optional(),
  phone: optionalText(40),
  role: z.enum(BOOKING_ROLES).default("player"),
});
export const UpdatePersonInput = BookingRef.extend({
  person_id: id("Person"),
  role: z.enum(BOOKING_ROLES).optional(),
  name: name.optional(),
  phone: optionalText(40),
});
export const PersonRef = BookingRef.extend({ person_id: id("Person") });

export const FindMyGigsInput = PageInput.extend({
  from: dateTime.optional().describe("Earliest event start (inclusive)"),
  to: dateTime.optional().describe("Latest event start (exclusive)"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export interface BookingEventView {
  id: string;
  title: string | null;
  start_at: string;
  start_display: string;
  end_at: string | null;
  end_display: string | null;
  venue_name: string | null;
  venue_city: string | null;
  notes: string | null;
  /** Who's playing; only your own entry when the gig hides the lineup from players. */
  lineup: LineupView[];
}

export interface BookingPersonView {
  id: string;
  user_id: string | null;
  name: string;
  role: BookingRole;
  is_me: boolean;
  has_account: boolean;
}

export interface BookingView {
  id: string;
  title: string;
  event_type: string | null;
  status: "enquiry" | "confirmed" | "completed" | "cancelled";
  cancel_reason: string | null;
  client: { name: string; phone: string | null; organisation: string | null } | null;
  notes: string | null;
  version: number;
  events: BookingEventView[];
  people: BookingPersonView[];
  my_role: BookingRole;
  /** Managers see and change these; players see them too. */
  settings: GigSettings;
  money: GigMoney;
  created_at: string;
  updated_at: string;
}

/** One row of "my gigs": an event I'm on, from my own summaries (may lag a few seconds). */
export interface MyEventView {
  gig_id: string;
  event_id: string;
  gig_title: string;
  event_title: string | null;
  event_type: string | null;
  client_name: string | null;
  start_at: string;
  start_display: string;
  end_at: string | null;
  venue_name: string | null;
  status: string;
  role: BookingRole;
  /** My part and share on this event (share 0 if I'm not on its lineup). */
  part: string | null;
  share: { amount_paise: number; amount_display: string };
}
