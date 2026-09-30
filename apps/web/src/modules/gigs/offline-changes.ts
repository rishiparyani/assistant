// The gig changes that work offline (docs/design/offline.md, stage 2): notes, lists and
// their items, guests, and money entries. Each goes through the outbox; while it waits,
// an "applier" shows it on the saved gig, marked `pending`. New things get their id here
// (the server accepts it), so they can be changed again before they've synced.
// Money entries aren't laid over the totals (those stay the server's); the Money tab lists
// them as waiting instead.
import {
  ulid,
  type BookingView,
  type GigGuestView,
  type GigListItemView,
  type GigListView,
} from "@assistant/shared";
import { applyWith, outbox, send, type Change } from "../../core/outbox.svelte.ts";
import { readCache } from "../../core/query.svelte.ts";

const scope = (gigId: string) => `gig:${gigId}`;
const titleOf = (gigId: string) => readCache<BookingView>(scope(gigId))?.title ?? "a gig";

/** Makes a gig change through the outbox (sent now if online, else when back). */
export function gigChange(
  gigId: string,
  kind: string,
  method: string,
  path: string,
  body: unknown,
  label: string,
  args?: Record<string, unknown>,
): Promise<BookingView> {
  return send<BookingView>({
    kind,
    scope: scope(gigId),
    method,
    path,
    body,
    args,
    label: `${label} · ${titleOf(gigId)}`,
  });
}

export const newId = () => ulid();

/** Money entries waiting to sync for a gig (the Money tab lists them). */
export const waitingMoney = (gigId: string) =>
  outbox.waiting.filter((c) => c.scope === scope(gigId) && c.kind.startsWith("gigs.record_"));

// --- Appliers -------------------------------------------------------------------------------

type Body = Record<string, unknown>;
const me = (g: BookingView) => g.people.find((p) => p.is_me);
const iso = (c: Change) => new Date(c.at).toISOString();
const on = (kind: string, fn: (g: BookingView, body: Body, c: Change) => BookingView) =>
  applyWith(kind, (data, c) => fn(data as BookingView, (c.body ?? {}) as Body, c));
const withList = (g: BookingView, listId: unknown, fn: (l: GigListView) => GigListView): BookingView => ({
  ...g,
  lists: g.lists.map((l) => (l.id === listId ? fn(l) : l)),
});
const item = (x: Body, pending = true): GigListItemView => ({
  id: String(x.id),
  text: String(x.text),
  detail: (x.detail as string | null | undefined) ?? null,
  song_id: (x.song_id as string | undefined) ?? null,
  done: false,
  done_by: null,
  pending,
});
function insertAfter<T extends { id: string }>(items: T[], add: T[], after: unknown): T[] {
  if (after === undefined) return [...items, ...add];
  if (after === null) return [...add, ...items];
  const i = items.findIndex((x) => x.id === after);
  return i < 0 ? [...items, ...add] : [...items.slice(0, i + 1), ...add, ...items.slice(i + 1)];
}
const heads = (gs: GigGuestView[]) => gs.reduce((n, g) => n + 1 + g.plus_ones, 0);
function withGuests(g: BookingView, fn: (gs: GigGuestView[]) => GigGuestView[]): BookingView {
  const before = g.guest_list.guests;
  const after = fn(before);
  const mine = (gs: GigGuestView[]) => gs.filter((x) => x.is_mine);
  const arrived = (gs: GigGuestView[]) => gs.filter((x) => x.arrived);
  return {
    ...g,
    guest_list: {
      ...g.guest_list,
      guests: after,
      heads: g.guest_list.heads + heads(after) - heads(before),
      my_heads: g.guest_list.my_heads + heads(mine(after)) - heads(mine(before)),
      arrived_heads: g.guest_list.arrived_heads + heads(arrived(after)) - heads(arrived(before)),
    },
  };
}

// Notes
on("gigs.add_note", (g, b, c) => ({
  ...g,
  shared_notes: [
    {
      id: String(b.id),
      body: String(b.body),
      author: me(g)?.name ?? "You",
      is_mine: true,
      created_at: iso(c),
      edited_at: null,
      pending: true,
    },
    ...g.shared_notes,
  ],
}));
on("gigs.update_gig_note", (g, b, c) => ({
  ...g,
  shared_notes: g.shared_notes.map((n) =>
    n.id === c.args?.note_id ? { ...n, body: String(b.body), edited_at: iso(c), pending: true } : n,
  ),
}));
on("gigs.remove_gig_note", (g, _b, c) => ({
  ...g,
  shared_notes: g.shared_notes.filter((n) => n.id !== c.args?.note_id),
}));

// Lists
on("gigs.create_gig_list", (g, b, c) => ({
  ...g,
  lists: [
    ...g.lists,
    {
      id: String(b.id),
      title: String(b.title),
      event_id: (b.event_id as string | undefined) ?? null,
      checkable: !!b.checkable,
      items: ((b.items as Body[] | undefined) ?? []).map((x) => item(x)),
      created_by: me(g)?.name ?? "You",
      updated_at: iso(c),
      pending: true,
    },
  ],
}));
on("gigs.update_gig_list", (g, b, c) =>
  withList(g, c.args?.list_id, (l) => ({
    ...l,
    ...(b.title !== undefined ? { title: String(b.title) } : {}),
    ...(b.event_id !== undefined ? { event_id: (b.event_id as string | null) ?? null } : {}),
    ...(b.checkable !== undefined ? { checkable: !!b.checkable } : {}),
    pending: true,
  })),
);
on("gigs.remove_gig_list", (g, _b, c) => ({ ...g, lists: g.lists.filter((l) => l.id !== c.args?.list_id) }));
on("gigs.add_list_items", (g, b, c) =>
  withList(g, c.args?.list_id, (l) => ({
    ...l,
    items: insertAfter(
      l.items,
      ((b.items as Body[]) ?? []).map((x) => item(x)),
      b.after_item_id,
    ),
  })),
);
on("gigs.update_list_item", (g, b, c) =>
  withList(g, c.args?.list_id, (l) => ({
    ...l,
    items: l.items.map((x) =>
      x.id !== c.args?.item_id
        ? x
        : {
            ...x,
            ...(b.text !== undefined ? { text: String(b.text) } : {}),
            ...(b.detail !== undefined ? { detail: (b.detail as string | null) ?? null } : {}),
            ...(b.done !== undefined
              ? { done: !!b.done, done_by: b.done ? (me(g)?.name ?? "You") : null }
              : {}),
            pending: true,
          },
    ),
  })),
);
on("gigs.move_list_item", (g, b, c) =>
  withList(g, c.args?.list_id, (l) => {
    const moving = l.items.find((x) => x.id === c.args?.item_id);
    if (!moving) return l;
    return {
      ...l,
      items: insertAfter(
        l.items.filter((x) => x !== moving),
        [{ ...moving, pending: true }],
        b.after_item_id,
      ),
    };
  }),
);
on("gigs.remove_list_item", (g, _b, c) =>
  withList(g, c.args?.list_id, (l) => ({ ...l, items: l.items.filter((x) => x.id !== c.args?.item_id) })),
);

// Guests
on("gigs.add_gig_guests", (g, b, c) => {
  const my = me(g);
  const hostId = (b.host_person_id as string | undefined) ?? my?.id ?? "";
  const host = g.people.find((p) => p.id === hostId);
  return withGuests(g, (gs) => [
    ...gs,
    ...((b.guests as Body[]) ?? []).map((x) => ({
      id: String(x.id),
      name: String(x.name),
      plus_ones: Number(x.plus_ones ?? 0),
      note: (x.note as string | undefined) ?? null,
      host_person_id: hostId,
      host_name: host?.name ?? my?.name ?? "You",
      is_mine: hostId === my?.id,
      arrived: false,
      created_at: iso(c),
      pending: true,
    })),
  ]);
});
on("gigs.update_gig_guest", (g, b, c) =>
  withGuests(g, (gs) =>
    gs.map((x) =>
      x.id !== c.args?.guest_id
        ? x
        : {
            ...x,
            ...(b.name !== undefined ? { name: String(b.name) } : {}),
            ...(b.plus_ones !== undefined ? { plus_ones: Number(b.plus_ones) } : {}),
            ...(b.note !== undefined ? { note: (b.note as string | null) ?? null } : {}),
            ...(b.arrived !== undefined ? { arrived: !!b.arrived } : {}),
            pending: true,
          },
    ),
  ),
);
on("gigs.remove_gig_guest", (g, _b, c) => withGuests(g, (gs) => gs.filter((x) => x.id !== c.args?.guest_id)));
