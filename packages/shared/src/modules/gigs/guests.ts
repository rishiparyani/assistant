// A gig's guest list: everyone on the gig adds their guests; managers set limits and a
// closing time and can share a secret link with the venue (read-only, optionally letting
// door staff tick arrivals). Each guest counts as 1 + their plus-ones ("heads").
import { z } from "zod";
import { BookingRef } from "./booking.ts";
import { dateTime, id, optionalText } from "./common.ts";

export const GUEST_LIMITS = { guests: 500, plus_ones: 20 } as const;

const guestName = z.string().trim().min(1).max(80);
const plusOnes = z.number().int().min(0).max(GUEST_LIMITS.plus_ones);
const headLimit = z.number().int().min(1).max(5000);

export const GuestInput = z.object({
  name: guestName.describe("The guest's name as the venue should see it"),
  plus_ones: plusOnes.default(0).describe("People coming with them (0 for just the guest)"),
  note: optionalText(120).describe('Optional, e.g. "press", "arrives late"'),
});

export const AddGigGuestsInput = BookingRef.extend({
  guests: z.array(GuestInput).min(1).max(50),
  host_person_id: id("Person")
    .optional()
    .describe("Whose guests they are (managers only; leave out for your own)"),
});
export const GigGuestRef = BookingRef.extend({ guest_id: id("Guest") });
export const UpdateGigGuestInput = GigGuestRef.extend({
  name: guestName.optional(),
  plus_ones: plusOnes.optional(),
  note: optionalText(120),
  arrived: z.boolean().optional().describe("Mark them arrived at the door (managers)"),
});
export const SetGuestListInput = BookingRef.extend({
  total_limit: headLimit.nullish().describe("Most heads on the whole list; null for no limit"),
  per_person_limit: headLimit.nullish().describe("Most heads each person may bring; null for no limit"),
  closes_at: dateTime
    .nullish()
    .describe("After this, only managers can change the list; null to keep it open"),
});
export const GuestLinkInput = BookingRef.extend({
  check_in: z.boolean().optional().describe("Door staff can tick arrivals on the link"),
  reset: z.boolean().optional().describe("Make a new link; the old one stops working"),
});

export interface GigGuestView {
  id: string;
  name: string;
  plus_ones: number;
  note: string | null;
  /** The person on the gig whose guest this is. */
  host_person_id: string;
  host_name: string;
  is_mine: boolean;
  arrived: boolean;
  created_at: string;
}

export interface GuestListView {
  total_limit: number | null;
  per_person_limit: number | null;
  closes_at: string | null;
  /** Whether I can still add or change my guests now (managers always can). */
  open: boolean;
  /** Heads on the whole list, and mine. */
  heads: number;
  my_heads: number;
  arrived_heads: number;
  /** Managers see everyone's guests; players see only their own. */
  guests: GigGuestView[];
  /** Managers only: whether the venue link is on and lets door staff tick arrivals. */
  link: { enabled: boolean; check_in: boolean } | null;
}

/** What the venue sees on the shared link. */
export interface SharedGuestListView {
  gig_title: string;
  starts_at: string | null;
  starts_display: string | null;
  venue: string | null;
  heads: number;
  arrived_heads: number;
  check_in: boolean;
  guests: {
    id: string;
    name: string;
    plus_ones: number;
    note: string | null;
    guest_of: string;
    arrived: boolean;
  }[];
}

export interface GuestLinkView {
  enabled: boolean;
  url: string | null;
  check_in: boolean;
}
