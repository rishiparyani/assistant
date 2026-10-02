// The gigs module's part of the private calendar feed (T08): my events from my own person
// object. No money in the feed (calendar apps sync it to other services).
import type { CalendarCtx } from "../../core/module.ts";
import type { CalendarEvent } from "../../core/calendar/ics.ts";
import { personName } from "./objects/names.ts";

/** How far back the feed goes; older events stay in calendars that already have them. */
const PAST_DAYS = 90;
/** Events without an end time show as three hours long. */
const DEFAULT_HOURS = 3;

export async function gigsCalendar(
  ctx: CalendarCtx,
  userId: string,
  now = new Date(),
): Promise<CalendarEvent[]> {
  const from = new Date(now.getTime() - PAST_DAYS * 86400_000).toISOString();
  const rows = await ctx.objects.PEOPLE.getByName(personName(userId)).calendarEvents(from);
  return rows.map((e) => {
    const cancelled = e.status === "cancelled";
    const rehearsal = e.kind === "rehearsal";
    const title = rehearsal
      ? `Rehearsal: ${e.gig_title}`
      : e.event_title && e.event_title !== e.gig_title
        ? `${e.gig_title}: ${e.event_title}`
        : e.gig_title;
    const details = [
      rehearsal
        ? [
            e.event_title,
            e.going === 1
              ? "You're going"
              : e.going === 0
                ? "You can't make it"
                : "Say if you're coming in Gigspree",
          ]
            .filter(Boolean)
            .join(" · ")
        : [e.role === "manager" ? "You manage this gig" : "You're playing", e.part]
            .filter(Boolean)
            .join(" · "),
      e.client_name ? `Client: ${e.client_name}` : null,
      e.collective_name ? `Collective: ${e.collective_name}` : null,
      e.status === "enquiry" ? "Not confirmed yet (enquiry)" : null,
      `${ctx.baseUrl}/gigs/${e.gig_id}`,
    ].filter(Boolean);
    return {
      uid: `${e.event_id}@assistant`,
      title: `${cancelled ? "Cancelled: " : e.status === "enquiry" ? "Enquiry: " : ""}${title}`,
      start: e.start_at,
      end: e.end_at ?? new Date(Date.parse(e.start_at) + DEFAULT_HOURS * 3600_000).toISOString(),
      location: e.venue_name,
      description: details.join("\n"),
      url: `${ctx.baseUrl}/gigs/${e.gig_id}`,
      cancelled,
      tentative: e.status === "enquiry",
      updated: e.updated_at,
    };
  });
}
