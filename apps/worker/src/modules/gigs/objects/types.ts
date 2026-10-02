// Shapes passed between the gigs module's Durable Objects and the summaries queue.

/** One event as a person sees it on Home and in reports. Only their own amounts. */
export type PersonEventSummary = {
  gig_id: string;
  event_id: string;
  /** Older summaries have none: a show. */
  kind?: "show" | "rehearsal";
  /** Rehearsals: my answer (null if I haven't said). */
  going?: boolean | null;
  gig_title: string;
  event_title: string | null;
  event_type: string | null;
  client_name: string | null;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  status: string;
  role: "manager" | "player";
  /** My part and share on this event (0 if I'm not on its lineup). */
  part: string | null;
  share_paise: number;
  collective_name?: string | null;
};

/**
 * One gig as a person sees it in reports: their own money always; the gig's full money
 * only for its managers (null for players).
 */
export type PersonGigSummary = {
  gig_id: string;
  /** Older summaries have none: a gig. */
  kind?: "gig" | "rehearsal";
  gig_title: string;
  event_type: string | null;
  client_name: string | null;
  status: string;
  role: "manager" | "player";
  first_start_at: string;
  share_paise: number;
  paid_paise: number;
  fee_paise: number | null;
  received_paise: number | null;
  expenses_paise: number | null;
  shares_total_paise: number | null;
  payouts_paise: number | null;
  collective?: { id: string; name: string } | null;
  tags?: { id: string; name: string }[];
  /** Whether this person may see the gig's lineup (autofill only uses such gigs). */
  lineup_visible?: boolean;
  /** Other people with accounts on the gig that this person may see (for duplicate warnings). */
  co_user_ids?: string[];
  /** Who made the latest change (notifications skip changes people made themselves). */
  changed_by?: string | null;
  /** Managers only: the client, venues and people on the gig, for their address book. */
  contacts?: LearnedContact[];
};

/** A client, venue or person a manager used on a gig (their address book learns it). */
export type LearnedContact = {
  kind: "client" | "venue" | "person";
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  user_id?: string | null;
};

/** What one person receives about one gig (empty when they're no longer on it). */
export type PersonSummary = { events: PersonEventSummary[]; gig: PersonGigSummary | null };

/** One event's card in a month index (for duplicate warnings and date lookups). */
export type IndexCard = {
  gig_id: string;
  event_id: string;
  start_at: string;
  date: string;
  venue_key: string | null;
  venue_name?: string | null;
  client_key?: string | null;
  status: string;
  manager_user_ids: string[];
};

/**
 * Everything a gig tells the outside world at one sequence number. Every recipient that
 * ever received rows is listed, with an empty list when it no longer has any (so removals
 * reach them too). Applying is "replace this gig's rows", so repeats are harmless.
 */
export interface GigSummaries {
  gig_id: string;
  seq: number;
  /** user id → their rows */
  people: Record<string, PersonSummary>;
  /** "YYYY-MM" → cards */
  months: Record<string, IndexCard[]>;
}

/** The message on the summaries queue: "gig X changed, up to sequence N". */
export interface SummaryMessage {
  gig_id: string;
  seq: number;
}
