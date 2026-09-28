// Address book (docs/design/gig-centric.md §2): each person's own clients, venues and
// people, used to fill in gigs. A gig keeps its own copy of the details, so editing the
// address book never changes past gigs. It also learns from gigs the person manages.
import { z } from "zod";
import { id, optionalText } from "./common.ts";

export const CONTACT_KINDS = ["client", "venue", "person"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const FindContactsInput = z.object({
  kind: z.enum(CONTACT_KINDS).optional().describe("client, venue or person; all kinds if left out"),
  q: z.string().trim().max(100).optional().describe("Part of the name, phone, email or city"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const contactFields = {
  name: z.string().trim().min(1).max(120),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : v === undefined ? undefined : null))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Not an email address"),
  city: optionalText(80).describe("For venues"),
  notes: optionalText(1000),
};

export const SaveContactInput = z.object({
  kind: z.enum(CONTACT_KINDS),
  ...contactFields,
});

export const UpdateContactInput = z.object({
  contact_id: id("Contact"),
  name: contactFields.name.optional(),
  phone: contactFields.phone,
  email: contactFields.email,
  city: contactFields.city,
  notes: contactFields.notes,
});

export const ContactRef = z.object({ contact_id: id("Contact") });

export interface ContactView {
  id: string;
  kind: ContactKind;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  notes: string | null;
  /** The person's account, when known (people added to gigs by email who signed up). */
  user_id: string | null;
  /** Gigs I manage that used this contact. */
  gigs: number;
  last_used_at: string | null;
}
