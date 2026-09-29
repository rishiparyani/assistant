// The guest list as plain text, to paste into WhatsApp or an email to the venue.
import { formatDateTimeIST, type BookingView } from "@assistant/shared";

export function guestListText(gig: BookingView): string {
  const l = gig.guest_list;
  const first = gig.events[0];
  const where = first ? [first.venue_name, first.venue_city].filter(Boolean).join(", ") : "";
  const head = [
    `Guest list · ${gig.title}`,
    [first ? formatDateTimeIST(first.start_at) : "", where].filter(Boolean).join(" · "),
    `${l.heads} ${l.heads === 1 ? "person" : "people"}`,
  ].filter(Boolean);
  const byHost = new Map<string, typeof l.guests>();
  for (const g of l.guests) byHost.set(g.host_name, [...(byHost.get(g.host_name) ?? []), g]);
  const blocks = [...byHost].map(([host, guests]) =>
    [
      `Guests of ${host}`,
      ...guests.map(
        (g, i) =>
          `${i + 1}. ${g.name}${g.plus_ones ? ` +${g.plus_ones}` : ""}${g.note ? ` (${g.note})` : ""}`,
      ),
    ].join("\n"),
  );
  return [head.join("\n"), ...blocks].join("\n\n");
}
