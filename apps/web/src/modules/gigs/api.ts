// Typed calls to the gigs module's operations (docs/api.md). No logic here.
import type {
  ClientView,
  ExpenseView,
  GigMoneyView,
  GigView,
  MusicianView,
  MyHomeView,
  Page,
  PaymentMethod,
  PaymentView,
  PayoutView,
  VenueView,
} from "@assistant/shared";
import { request } from "../../core/api.ts";

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export interface GigInput {
  title?: string;
  event_type?: string | null;
  start_at?: string;
  end_at?: string | null;
  fee?: string;
  client_id?: string | null;
  venue_id?: string | null;
  notes?: string | null;
  status?: "enquiry" | "confirmed";
}

export interface LineupEntryInput {
  musician_id: string;
  role?: string | null;
  share?: string;
  percent?: number;
}

export function gigsApi(ws: string) {
  const base = `/api/w/${ws}`;
  return {
    // Gigs
    findGigs: (p: Record<string, string | number | undefined> = {}) =>
      request<Page<GigView>>("GET", `${base}/gigs${q(p)}`),
    getGig: (id: string) => request<GigView>("GET", `${base}/gigs/${id}`),
    createGig: (input: GigInput) => request<GigView>("POST", `${base}/gigs`, input),
    updateGig: (id: string, input: GigInput) => request<GigView>("PATCH", `${base}/gigs/${id}`, input),
    setStatus: (id: string, action: "confirm" | "complete") =>
      request<GigView>("POST", `${base}/gigs/${id}/${action}`, {}),
    cancelGig: (id: string, reason?: string) =>
      request<GigView>("POST", `${base}/gigs/${id}/cancel`, { reason }),
    deleteGig: (id: string) => request<{ deleted: boolean }>("DELETE", `${base}/gigs/${id}`),
    money: (id: string) => request<GigMoneyView>("GET", `${base}/gigs/${id}/money`),

    // Money
    recordPayment: (
      gigId: string,
      input: { amount: string; paid_on?: string; method: PaymentMethod; note?: string },
    ) => request<PaymentView>("POST", `${base}/gigs/${gigId}/payments`, input),
    reversePayment: (paymentId: string) =>
      request<PaymentView>("POST", `${base}/payments/${paymentId}/reverse`, {}),
    recordExpense: (input: {
      gig_id?: string;
      category: string;
      amount: string;
      spent_on?: string;
      note?: string;
    }) => request<ExpenseView>("POST", `${base}/expenses`, input),
    deleteExpense: (id: string) => request<{ deleted: boolean }>("DELETE", `${base}/expenses/${id}`),
    setLineup: (
      gigId: string,
      input: { lineup: LineupEntryInput[]; split?: "equal"; split_total?: string },
    ) => request<GigMoneyView>("PUT", `${base}/gigs/${gigId}/lineup`, input),
    recordPayout: (
      gigId: string,
      input: { musician_id: string; amount: string; paid_on?: string; method: PaymentMethod; note?: string },
    ) => request<PayoutView>("POST", `${base}/gigs/${gigId}/payouts`, input),
    reversePayout: (payoutId: string) =>
      request<PayoutView>("POST", `${base}/payouts/${payoutId}/reverse`, {}),

    // Clients
    findClients: (p: Record<string, string | number | undefined> = {}) =>
      request<Page<ClientView>>("GET", `${base}/clients${q(p)}`),
    clientHistory: (id: string) =>
      request<{ client: ClientView; gigs: GigView[] }>("GET", `${base}/clients/${id}`),
    createClient: (input: Partial<ClientView>) => request<ClientView>("POST", `${base}/clients`, input),
    updateClient: (id: string, input: Partial<ClientView>) =>
      request<ClientView>("PATCH", `${base}/clients/${id}`, input),
    deleteClient: (id: string) => request<{ deleted: boolean }>("DELETE", `${base}/clients/${id}`),

    // Venues
    findVenues: (p: Record<string, string | number | undefined> = {}) =>
      request<Page<VenueView>>("GET", `${base}/venues${q(p)}`),
    createVenue: (input: Partial<VenueView>) => request<VenueView>("POST", `${base}/venues`, input),
    updateVenue: (id: string, input: Partial<VenueView>) =>
      request<VenueView>("PATCH", `${base}/venues/${id}`, input),
    deleteVenue: (id: string) => request<{ deleted: boolean }>("DELETE", `${base}/venues/${id}`),

    // Roster
    findMusicians: (p: Record<string, string | number | undefined> = {}) =>
      request<Page<MusicianView>>("GET", `${base}/musicians${q(p)}`),
    createMusician: (input: Partial<MusicianView>) =>
      request<MusicianView>("POST", `${base}/musicians`, input),
    updateMusician: (id: string, input: Partial<MusicianView>) =>
      request<MusicianView>("PATCH", `${base}/musicians/${id}`, input),
    deleteMusician: (id: string) => request<{ deleted: boolean }>("DELETE", `${base}/musicians/${id}`),
  };
}

export type GigsApi = ReturnType<typeof gigsApi>;

/** The Me Home: my own gigs and money across all my workspaces. */
export const meApi = {
  home: () => request<MyHomeView>("GET", "/api/me/home"),
};
