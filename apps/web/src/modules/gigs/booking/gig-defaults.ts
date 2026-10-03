// A gig saved on this device before an app update may lack newer parts (lists, notes,
// guest list, rehearsals); fill them in until the fresh copy arrives, so no screen breaks.
import type { BookingView } from "@assistant/shared";

export function withDefaults(g: BookingView): BookingView {
  if (
    g.lists &&
    g.shared_notes &&
    g.guest_list &&
    g.kind &&
    g.events.every((e) => e.hold !== undefined) &&
    g.guest_list.guests.every((x) => x.arrived_count !== undefined)
  )
    return g;
  return {
    ...g,
    kind: g.kind ?? "gig",
    events: g.events.map((e) => ({
      ...e,
      kind: e.kind ?? "show",
      hold: e.hold ?? false,
      attendance: e.attendance ?? [],
      my_going: e.my_going ?? null,
    })),
    lists: g.lists ?? [],
    shared_notes: g.shared_notes ?? [],
    can_edit_lists: g.can_edit_lists ?? false,
    guest_list: g.guest_list
      ? {
          ...g.guest_list,
          guests: g.guest_list.guests.map((x) => ({
            ...x,
            arrived_count: x.arrived_count ?? (x.arrived ? 1 + x.plus_ones : 0),
          })),
        }
      : {
          total_limit: null,
          per_person_limit: null,
          closes_at: null,
          open: false,
          heads: 0,
          my_heads: 0,
          arrived_heads: 0,
          guests: [],
          link: null,
        },
  };
}
