import { z } from "zod";
import { PageInput } from "../../core/pagination.ts";
import { id, optionalText } from "./common.ts";

const fields = { city: optionalText(80), address: optionalText(300), notes: optionalText(2000) };

export const CreateVenueInput = z.object({ name: z.string().trim().min(1).max(120), ...fields });
export const UpdateVenueInput = z.object({
  venue_id: id("Venue"),
  name: z.string().trim().min(1).max(120).optional(),
  ...fields,
});
export const VenueRef = z.object({ venue_id: id("Venue") });
export const FindVenuesInput = PageInput.extend({
  q: z.string().trim().max(120).optional().describe("Part of the venue's name or city"),
});

export interface VenueView {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
