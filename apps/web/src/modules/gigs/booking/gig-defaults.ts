// A gig saved on this device before an app update may lack newer parts (lists, notes,
// guest list); fill them in until the fresh copy arrives, so no screen breaks.
import type { BookingView } from "@assistant/shared";

export function withDefaults(g: BookingView): BookingView {
  if (g.lists && g.shared_notes && g.guest_list) return g;
  return {
    ...g,
    lists: g.lists ?? [],
    shared_notes: g.shared_notes ?? [],
    can_edit_lists: g.can_edit_lists ?? false,
    guest_list: g.guest_list ?? {
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
