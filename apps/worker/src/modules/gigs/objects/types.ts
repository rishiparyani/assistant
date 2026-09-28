// Shapes passed between the gigs module's Durable Objects and the summaries queue.

/** One event as a person sees it on Home and in reports. Only their own amounts. */
export type PersonEventSummary = {
  gig_id: string;
  event_id: string;
  gig_title: string;
  event_title: string | null;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  status: string;
  role: "manager" | "player";
};

/** One event's card in a month index (for duplicate warnings and date lookups). */
export type IndexCard = {
  gig_id: string;
  event_id: string;
  start_at: string;
  date: string;
  venue_key: string | null;
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
  /** user id → rows */
  people: Record<string, PersonEventSummary[]>;
  /** "YYYY-MM" → cards */
  months: Record<string, IndexCard[]>;
}

/** The message on the summaries queue: "gig X changed, up to sequence N". */
export interface SummaryMessage {
  gig_id: string;
  seq: number;
}
