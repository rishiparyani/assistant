// Typed calls to the gig-centric operations (docs/api.md, "Gig-centric gigs"). No logic here.
import type {
  AutofillView,
  BookingRole,
  BookingView,
  ContactKind,
  ContactView,
  DuplicateWarning,
  GigSettings,
  HomeView,
  MyEventView,
  MyReportView,
  MyTagView,
  Page,
  PaymentMethod,
} from "@assistant/shared";
import { request } from "../../core/api.ts";

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export interface EventFields {
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

  // Address book
  contacts: (p: { kind?: ContactKind; q?: string; limit?: number } = {}) =>
    request<ContactView[]>("GET", `/api/me/contacts${q(p)}`),
  saveContact: (c: ContactFields & { kind: ContactKind; name: string }) =>
    request<ContactView>("POST", "/api/me/contacts", c),
  updateContact: (id: string, c: ContactFields) =>
    request<ContactView>("PATCH", `/api/me/contacts/${encodeURIComponent(id)}`, c),
  removeContact: (id: string) =>
    request<{ removed: true }>("DELETE", `/api/me/contacts/${encodeURIComponent(id)}`),

  // Gig
  create: (
    body: GigFields & { status?: "enquiry" | "confirmed"; events: EventFields[]; people: PersonFields[] },
  ) => request<BookingView>("POST", "/api/gigs", body),
  get: (id: string) => request<BookingView>("GET", base(id)),
  update: (id: string, version: number, body: GigFields) =>
    request<BookingView>("PATCH", base(id), { version, ...body }),
  setStatus: (
    id: string,
    action: "confirm" | "complete" | "cancel",
    extra: { reason?: string; refund?: string; refund_method?: PaymentMethod } = {},
  ) => request<BookingView>("POST", `${base(id)}/status`, { action, ...extra }),

  remove: (id: string) => request<{ deleted: true }>("DELETE", base(id)),

  addEvent: (id: string, e: EventFields) => request<BookingView>("POST", `${base(id)}/events`, e),
  updateEvent: (id: string, eventId: string, version: number, e: Partial<EventFields>) =>
    request<BookingView>("PATCH", `${base(id)}/events/${eventId}`, { version, ...e }),
  removeEvent: (id: string, eventId: string) =>
    request<BookingView>("DELETE", `${base(id)}/events/${eventId}`),

  addPerson: (id: string, p: PersonFields) => request<BookingView>("POST", `${base(id)}/people`, p),
  updatePerson: (
    id: string,
    personId: string,
    p: { role?: BookingRole; name?: string; phone?: string | null },
  ) => request<BookingView>("PATCH", `${base(id)}/people/${personId}`, p),
  removePerson: (id: string, personId: string) =>
    request<BookingView | { removed: true }>("DELETE", `${base(id)}/people/${personId}`),

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

  recordPayment: (id: string, p: MoneyEntry) => request<BookingView>("POST", `${base(id)}/payments`, p),
  reversePayment: (id: string, paymentId: string) =>
    request<BookingView>("POST", `${base(id)}/payments/${paymentId}/reverse`, {}),
  recordPayout: (id: string, p: MoneyEntry & { person_id: string; event_id?: string }) =>
    request<BookingView>("POST", `${base(id)}/payouts`, p),
  reversePayout: (id: string, payoutId: string) =>
    request<BookingView>("POST", `${base(id)}/payouts/${payoutId}/reverse`, {}),
  recordExpense: (
    id: string,
    p: { category: string; amount: string; spent_on: string; note?: string; event_id?: string },
  ) => request<BookingView>("POST", `${base(id)}/expenses`, p),
  removeExpense: (id: string, expenseId: string) =>
    request<BookingView>("DELETE", `${base(id)}/expenses/${expenseId}`),
};
