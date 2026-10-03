// Typed calls to the gig-centric operations (docs/api.md, "Gig-centric gigs"). No logic here.
import type {
  GigTypesView,
  GuestLinkView,
  SharedGuestListView,
  AutofillView,
  BookingRole,
  BookingView,
  ContactKind,
  ContactView,
  DuplicateWarning,
  GigSettings,
  HomeView,
  MyEventView,
  GigHistoryView,
  MyReportView,
  MyTagView,
  Page,
  PaymentMethod,
} from "@assistant/shared";
import { request } from "../../core/api.ts";
import { gigChange, newId } from "./offline-changes.ts";

const rupees = (v: string) => `₹${Number(v).toLocaleString("en-IN")}`;

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export interface EventFields {
  kind?: "show" | "rehearsal";
  title?: string | null;
  start_at: string;
  end_at?: string | null;
  venue_name?: string | null;
  venue_city?: string | null;
  notes?: string | null;
}

export interface PersonFields {
  user_id?: string;
  email?: string;
  name?: string;
  phone?: string | null;
  role: BookingRole;
}

export interface GigFields {
  title?: string;
  event_type?: string | null;
  client?: { name: string; phone?: string | null } | null;
  notes?: string | null;
  fee?: string;
  collective?: string | null;
  tags?: string[];
  settings?: Partial<GigSettings>;
}

export interface MoneyEntry {
  amount: string;
  paid_on: string;
  method: PaymentMethod;
  note?: string;
}

export interface ContactFields {
  name?: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  notes?: string | null;
}

export interface LineupFields {
  person_id: string;
  part?: string | null;
  share?: string;
  percent?: number;
}

const base = (id: string) => `/api/gigs/${encodeURIComponent(id)}`;

export const bookingsApi = {
  // Me
  home: () => request<HomeView>("GET", "/api/me/overview"),
  myGigs: (p: {
    from?: string;
    to?: string;
    order?: "asc" | "desc";
    q?: string;
    status?: string;
    kind?: "show" | "rehearsal";
    cursor?: string;
    limit?: number;
  }) => request<Page<MyEventView>>("GET", `/api/me/gigs${q(p)}`),
  report: (p: {
    from: string;
    to: string;
    role?: string;
    status?: string;
    client?: string;
    collective?: string;
    tags?: string;
  }) => request<MyReportView>("GET", `/api/me/report${q(p)}`),
  tags: (p: { kind?: "collective" | "custom"; q?: string } = {}) =>
    request<MyTagView[]>("GET", `/api/me/tags${q(p)}`),
  autofill: (collective: string) => request<AutofillView>("GET", `/api/me/autofill${q({ collective })}`),
  duplicates: (p: { start_at: string; venue_name?: string; client_name?: string }) =>
    request<DuplicateWarning[]>("GET", `/api/me/duplicates${q(p)}`),

  // My gig types (Settings)
  gigTypes: () => request<GigTypesView>("GET", "/api/me/gig-types"),
  // online-only: Settings, rarely changed.
  setGigTypes: (types: string[]) => request<GigTypesView>("PUT", "/api/me/gig-types", { types }),

  // Address book
  contacts: (p: { kind?: ContactKind; q?: string; limit?: number } = {}) =>
    request<ContactView[]>("GET", `/api/me/contacts${q(p)}`),
  // online-only: address book, rarely changed at a gig.
  saveContact: (c: ContactFields & { kind: ContactKind; name: string }) =>
    request<ContactView>("POST", "/api/me/contacts", c),
  // online-only: address book, rarely changed at a gig.
  updateContact: (id: string, c: ContactFields) =>
    request<ContactView>("PATCH", `/api/me/contacts/${encodeURIComponent(id)}`, c),
  // online-only: address book, rarely changed at a gig.
  removeContact: (id: string) =>
    request<{ removed: true }>("DELETE", `/api/me/contacts/${encodeURIComponent(id)}`),

  // Gig
  // online-only: the server picks the gig id and sets up its object.
  create: (
    body: GigFields & {
      kind?: "gig" | "rehearsal";
      status?: "enquiry" | "confirmed";
      events: EventFields[];
      people: PersonFields[];
    },
  ) => request<BookingView>("POST", "/api/gigs", body),
  get: (id: string) => request<BookingView>("GET", base(id)),
  history: (id: string, before?: number) =>
    request<GigHistoryView>("GET", `${base(id)}/history${q({ before })}`),
  // online-only: checked against the gig version the sheet opened (conflicts).
  update: (id: string, version: number, body: GigFields) =>
    request<BookingView>("PATCH", base(id), { version, ...body }),
  // online-only: confirm/complete/cancel depend on rules only the server knows.
  setStatus: (
    id: string,
    action: "confirm" | "complete" | "cancel" | "reopen",
    extra: { reason?: string; refund?: string; refund_method?: PaymentMethod } = {},
  ) => request<BookingView>("POST", `${base(id)}/status`, { action, ...extra }),

  // online-only: deletes need the server to confirm.
  remove: (id: string) => request<{ deleted: true }>("DELETE", base(id)),

  // online-only: events move gig dates and lineups; server rules.
  addEvent: (id: string, e: EventFields) => request<BookingView>("POST", `${base(id)}/events`, e),
  // online-only: checked against the gig version the sheet opened (conflicts).
  updateEvent: (id: string, eventId: string, version: number, e: Partial<EventFields>) =>
    request<BookingView>("PATCH", `${base(id)}/events/${eventId}`, { version, ...e }),
  // online-only: events move gig dates and lineups; server rules.
  removeEvent: (id: string, eventId: string) =>
    request<BookingView>("DELETE", `${base(id)}/events/${eventId}`),
  // online-only: answered ahead of the rehearsal; the server checks who may answer for whom.
  setAttendance: (id: string, eventId: string, going: boolean, personId?: string) =>
    request<BookingView>("PUT", `${base(id)}/events/${eventId}/attendance`, {
      going,
      person_id: personId,
    }),

  // online-only: people and roles are permission changes.
  addPerson: (id: string, p: PersonFields) => request<BookingView>("POST", `${base(id)}/people`, p),
  // online-only: people and roles are permission changes.
  updatePerson: (
    id: string,
    personId: string,
    p: { role?: BookingRole; name?: string; phone?: string | null },
  ) => request<BookingView>("PATCH", `${base(id)}/people/${personId}`, p),
  // online-only: people and roles are permission changes.
  removePerson: (id: string, personId: string) =>
    request<BookingView | { removed: true }>("DELETE", `${base(id)}/people/${personId}`),

  // online-only: checked against the gig version the sheet opened; shares need the server.
  setLineup: (
    id: string,
    eventId: string,
    version: number,
    lineup: LineupFields[],
    split?: { equal?: boolean; total?: string },
  ) =>
    request<BookingView>("PUT", `${base(id)}/events/${eventId}/lineup`, {
      version,
      lineup,
      ...(split?.equal ? { split: "equal" } : {}),
      ...(split?.total ? { split_total: split.total } : {}),
    }),

  // --- Changes that also work offline: they go through the outbox (offline-changes.ts) ---
  recordPayment: (id: string, p: MoneyEntry) =>
    gigChange(
      id,
      "gigs.record_gig_payment",
      "POST",
      `${base(id)}/payments`,
      p,
      `Payment ${rupees(p.amount)}`,
    ),
  // online-only: a correction of a synced entry; needs the server copy.
  reversePayment: (id: string, paymentId: string) =>
    request<BookingView>("POST", `${base(id)}/payments/${paymentId}/reverse`, {}),
  recordPayout: (id: string, p: MoneyEntry & { person_id: string; event_id?: string }) =>
    gigChange(id, "gigs.record_gig_payout", "POST", `${base(id)}/payouts`, p, `Payout ${rupees(p.amount)}`),
  // online-only: a correction of a synced entry; needs the server copy.
  reversePayout: (id: string, payoutId: string) =>
    request<BookingView>("POST", `${base(id)}/payouts/${payoutId}/reverse`, {}),
  recordExpense: (
    id: string,
    p: { category: string; amount: string; spent_on: string; note?: string; event_id?: string },
  ) =>
    gigChange(
      id,
      "gigs.record_gig_expense",
      "POST",
      `${base(id)}/expenses`,
      p,
      `Expense ${rupees(p.amount)} (${p.category})`,
    ),
  // online-only: a correction of a synced entry; needs the server copy.
  removeExpense: (id: string, expenseId: string) =>
    request<BookingView>("DELETE", `${base(id)}/expenses/${expenseId}`),

  // Lists and notes
  createList: (
    id: string,
    l: { title: string; event_id?: string; checkable?: boolean; items?: { text: string; detail?: string }[] },
  ) =>
    gigChange(
      id,
      "gigs.create_gig_list",
      "POST",
      `${base(id)}/lists`,
      { ...l, id: newId(), items: (l.items ?? []).map((x) => ({ ...x, id: newId() })) },
      `New list “${l.title}”`,
    ),
  updateList: (
    id: string,
    listId: string,
    l: { title?: string; event_id?: string | null; checkable?: boolean },
  ) =>
    gigChange(id, "gigs.update_gig_list", "PATCH", `${base(id)}/lists/${listId}`, l, "List changed", {
      list_id: listId,
    }),
  removeList: (id: string, listId: string) =>
    gigChange(
      id,
      "gigs.remove_gig_list",
      "DELETE",
      `${base(id)}/lists/${listId}`,
      undefined,
      "List removed",
      {
        list_id: listId,
      },
    ),
  addItems: (
    id: string,
    listId: string,
    items: { text: string; detail?: string; song_id?: string }[],
    after?: string | null,
  ) =>
    gigChange(
      id,
      "gigs.add_list_items",
      "POST",
      `${base(id)}/lists/${listId}/items`,
      {
        items: items.map((x) => ({ ...x, id: newId() })),
        ...(after !== undefined ? { after_item_id: after } : {}),
      },
      items.length === 1 ? `Added “${items[0]!.text}”` : `Added ${items.length} items`,
      { list_id: listId },
    ),
  updateItem: (
    id: string,
    listId: string,
    itemId: string,
    i: { text?: string; detail?: string | null; done?: boolean },
  ) =>
    gigChange(
      id,
      "gigs.update_list_item",
      "PATCH",
      `${base(id)}/lists/${listId}/items/${itemId}`,
      i,
      i.done === undefined ? "Item changed" : i.done ? "Item ticked" : "Item unticked",
      { list_id: listId, item_id: itemId },
    ),
  moveItem: (id: string, listId: string, itemId: string, after: string | null) =>
    gigChange(
      id,
      "gigs.move_list_item",
      "POST",
      `${base(id)}/lists/${listId}/items/${itemId}/move`,
      { after_item_id: after },
      "Item moved",
      { list_id: listId, item_id: itemId },
    ),
  removeItem: (id: string, listId: string, itemId: string) =>
    gigChange(
      id,
      "gigs.remove_list_item",
      "DELETE",
      `${base(id)}/lists/${listId}/items/${itemId}`,
      undefined,
      "Item removed",
      {
        list_id: listId,
        item_id: itemId,
      },
    ),
  addNote: (id: string, body: string) =>
    gigChange(id, "gigs.add_note", "POST", `${base(id)}/notes`, { id: newId(), body }, "Note posted"),
  updateNote: (id: string, noteId: string, body: string) =>
    gigChange(id, "gigs.update_gig_note", "PATCH", `${base(id)}/notes/${noteId}`, { body }, "Note changed", {
      note_id: noteId,
    }),
  removeNote: (id: string, noteId: string) =>
    gigChange(
      id,
      "gigs.remove_gig_note",
      "DELETE",
      `${base(id)}/notes/${noteId}`,
      undefined,
      "Note removed",
      {
        note_id: noteId,
      },
    ),

  // Guest list
  addGuests: (
    id: string,
    guests: { name: string; plus_ones?: number; note?: string }[],
    hostPersonId?: string,
  ) =>
    gigChange(
      id,
      "gigs.add_gig_guests",
      "POST",
      `${base(id)}/guests`,
      {
        guests: guests.map((g) => ({ ...g, id: newId() })),
        ...(hostPersonId ? { host_person_id: hostPersonId } : {}),
      },
      guests.length === 1
        ? `Guest ${guests[0]!.name}${guests[0]!.plus_ones ? ` +${guests[0]!.plus_ones}` : ""}`
        : `${guests.length} guests`,
    ),
  updateGuest: (
    id: string,
    guestId: string,
    g: { name?: string; plus_ones?: number; note?: string | null; arrived?: boolean },
  ) =>
    gigChange(
      id,
      "gigs.update_gig_guest",
      "PATCH",
      `${base(id)}/guests/${guestId}`,
      g,
      g.arrived === undefined ? "Guest changed" : g.arrived ? "Guest arrived" : "Guest not arrived",
      { guest_id: guestId },
    ),
  removeGuest: (id: string, guestId: string) =>
    gigChange(
      id,
      "gigs.remove_gig_guest",
      "DELETE",
      `${base(id)}/guests/${guestId}`,
      undefined,
      "Guest removed",
      {
        guest_id: guestId,
      },
    ),
  // online-only: limits change what others may add; server rules.
  setGuestList: (
    id: string,
    s: { total_limit?: number | null; per_person_limit?: number | null; closes_at?: string | null },
  ) => request<BookingView>("PATCH", `${base(id)}/guest-list`, s),
  guestLink: (id: string) => request<GuestLinkView>("GET", `${base(id)}/guest-link`),
  // online-only: the server makes the link secret.
  enableGuestLink: (id: string, o: { check_in?: boolean; reset?: boolean } = {}) =>
    request<GuestLinkView>("POST", `${base(id)}/guest-link`, o),
  // online-only: the server revokes the link.
  disableGuestLink: (id: string) => request<GuestLinkView>("DELETE", `${base(id)}/guest-link`),

  // The venue's side (no sign-in)
  sharedGuests: (token: string) =>
    request<SharedGuestListView>("GET", `/api/shared/${encodeURIComponent(token)}`),
  // online-only: the venue page has no sign-in, so no outbox.
  sharedArrive: (token: string, guestId: string, arrived: boolean) =>
    request<SharedGuestListView>("POST", `/api/shared/${encodeURIComponent(token)}/arrive`, {
      guest_id: guestId,
      arrived,
    }),
};
