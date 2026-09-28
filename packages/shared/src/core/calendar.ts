import { z } from "zod";

/** My private calendar feed link (null when switched off). */
export interface CalendarFeedView {
  enabled: boolean;
  /** https link for Google Calendar ("From URL") and others. Private: anyone with it sees my gigs. */
  url: string | null;
  /** The same link as webcal://, which opens Apple Calendar's subscribe screen. */
  webcal_url: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export const EnableCalendarFeedInput = z.object({
  reset: z.boolean().optional().describe("Make a new link; the old one stops working"),
});
