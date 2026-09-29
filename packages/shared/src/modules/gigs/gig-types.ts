// Gig types: each person's own list (Settings), used when making or editing a gig. Starts
// as Public and Private; a gig keeps the type's name, so later edits never change old gigs.
import { z } from "zod";

export const DEFAULT_GIG_TYPES = ["Public", "Private"] as const;
export const GIG_TYPES_MAX = 30;

const typeName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((v) => v.replace(/\s+/g, " "));

export const SetGigTypesInput = z.object({
  types: z
    .array(typeName)
    .max(GIG_TYPES_MAX)
    .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length, "Each type once")
    .describe("My gig types, in the order to offer them; replaces the whole list"),
});

export interface GigTypesView {
  types: string[];
}
