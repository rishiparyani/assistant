// One person's own database (docs/design/gig-centric.md §5): summaries of the gigs and
// events they're on, used for Home and reports. Written only by summary deliveries, which
// may repeat or arrive out of order: a delivery replaces the gig's rows only if its
// sequence number isn't older than what's already applied.
import { DurableObject } from "cloudflare:workers";
import { DEFAULT_GIG_TYPES, formatDateTimeIST, formatINR, ulid } from "@assistant/shared";
import type { ContactKind, ContactView, GigTypesView } from "@assistant/shared";
import { ObjectError } from "../../../core/objects/errors.ts";
import {
  audit,
  getMeta,
  setMeta,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  type Actor,
  type Migrations,
} from "../../../core/objects/storage.ts";
import type { LearnedContact, PersonEventSummary, PersonGigSummary } from "./types.ts";
import { notify } from "../../../core/push/notify.ts";
import type { NewNotification } from "../../../core/push/inbox.ts";

const MIGRATIONS: Migrations = [
  `
  create table my_events (
    event_id text primary key,
    gig_id text not null,
    gig_title text not null,
    event_title text,
    start_at text not null,
    end_at text,
    venue_name text,
    status text not null,
    role text not null
  );
  create index my_events_gig_idx on my_events (gig_id);
  create index my_events_start_idx on my_events (start_at);
  create table applied (gig_id text primary key, seq integer not null, at text not null);
  `,
  // Step 2: more detail for lists and reports.
  `
  alter table my_events add column event_type text;
  alter table my_events add column client_name text;
  `,
  // Step 2: "create gig" retries reuse the same gig id (Idempotency-Key → gig id, 24 h).
  `
  create table create_keys (key text primary key, gig_id text not null, created_at text not null);
  create index create_keys_created_idx on create_keys (created_at);
  `,
  // Step 3: my part and share per event, and one row per gig with my money (and, for gigs
  // I manage, the gig's money) for Home and reports.
  `
  alter table my_events add column part text;
  alter table my_events add column share_paise integer not null default 0;
  create table my_gigs (
    gig_id text primary key,
    gig_title text not null,
    status text not null,
    role text not null,
    first_start_at text not null,
    share_paise integer not null,
    paid_paise integer not null,
    fee_paise integer,
    received_paise integer,
    expenses_paise integer,
    shares_total_paise integer
  );
  create index my_gigs_start_idx on my_gigs (first_start_at);
  `,
  // Step 4: report filters (client, type) and what managers still owe their players.
  `
  alter table my_gigs add column event_type text;
  alter table my_gigs add column client_name text;
  alter table my_gigs add column payouts_paise integer;
  create index my_gigs_client_idx on my_gigs (client_name);
  `,
  // Step 5: collective and custom tags (report filters, suggestions, autofill) and the
  // people I've been on gigs with (duplicate warnings only look at their gigs).
  `
  alter table my_events add column collective_name text;
  alter table my_gigs add column collective_tag_id text;
  alter table my_gigs add column collective_name text;
  alter table my_gigs add column lineup_visible integer not null default 0;
  create index my_gigs_collective_idx on my_gigs (collective_tag_id);
  create table my_gig_tags (gig_id text not null, tag_id text not null, name text not null, primary key (gig_id, tag_id));
  create index my_gig_tags_tag_idx on my_gig_tags (tag_id);
  create table my_gig_people (gig_id text not null, user_id text not null, primary key (gig_id, user_id));
  create index my_gig_people_user_idx on my_gig_people (user_id);
  `,
  // Step 6: the address book (my clients, venues and people; learned from gigs I manage
  // and edited by me), with idempotency and audit for my own edits.
  `
  create table if not exists _audit (
    id integer primary key autoincrement,
    at text not null,
    actor_user_id text,
    source text not null,
    action text not null,
    entity_type text not null,
    entity_id text not null,
    before_json text,
    after_json text
  );
  create table if not exists _idempotency (
    key text primary key,
    request_hash text not null,
    response_json text not null,
    created_at text not null
  );
  create index if not exists _idempotency_created_idx on _idempotency (created_at);
  create table contacts (
    id text primary key,
    kind text not null check (kind in ('client', 'venue', 'person')),
    name text not null,
    name_key text not null,
    phone text,
    email text,
    city text,
    notes text,
    user_id text,
    last_used_at text,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index contacts_kind_name_idx on contacts (kind, name_key);
  create index contacts_email_idx on contacts (email);
  create index contacts_user_idx on contacts (user_id);
  create index contacts_used_idx on contacts (last_used_at);
  create table contact_gigs (contact_id text not null, gig_id text not null, primary key (contact_id, gig_id));
  create index contact_gigs_gig_idx on contact_gigs (gig_id);
  `,
  // Step 7: contact search by indexed words (no scans), and old names of renamed
  // contacts so gigs that still use an old name find the same contact.
  `
  create table contact_words (word text not null, contact_id text not null, primary key (word, contact_id));
  create index contact_words_contact_idx on contact_words (contact_id);
  create table contact_aliases (
    kind text not null,
    name_key text not null,
    contact_id text not null,
    primary key (kind, name_key)
  );
  create index contacts_list_idx on contacts (deleted_at, kind, last_used_at);
  `,
  // My gig types (Settings), in order. Until I change them, the defaults apply.
  `
  create table if not exists _meta (key text primary key, value text not null);
  create table gig_types (name_key text primary key, name text not null, position integer not null);
  create index gig_types_position_idx on gig_types (position);
  `,
];

/** Search words for a contact: name, city and email words, and phone digits. */
function contactWords(c: { name: string; email: string | null; phone: string | null; city: string | null }) {
  const words = new Set<string>();
  for (const text of [c.name, c.city ?? "", c.email ?? ""])
    for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w) words.add(w);
  if (c.email) words.add(c.email.toLowerCase());
  const digits = (c.phone ?? "").replace(/\D/g, "");
  if (digits) {
    words.add(digits);
    if (digits.length > 10) words.add(digits.slice(-10));
  }
  return [...words].map((w) => w.slice(0, 80));
}

/** Search terms: words as typed; a number (e.g. "+91 900") is matched on its digits. */
function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) =>
      /\p{L}/u.test(t) ? t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}@.]+$/gu, "") : t.replace(/\D/g, ""),
    )
    .filter(Boolean)
    .slice(0, 5);
}

/** "  Blue  Frog " → "blue frog": one contact however the name is typed. */
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** ContactView as a SQL row type (a mapped type, so it has the index signature rows need). */
type ContactOut = { [K in keyof ContactView]: ContactView[K] };
type ContactRow = { [K in keyof Omit<ContactView, "gigs">]: ContactView[K] } & {
  name_key: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
const CONTACT_COLUMNS = `c.id, c.kind, c.name, c.phone, c.email, c.city, c.notes, c.user_id, c.last_used_at`;

const MAX_SOCKETS = 8;

/** A my_gigs row as stored (tags and flags are shaped on the way out). */
type GigRow = {
  gig_id: string;
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
  collective_tag_id: string | null;
  collective_name: string | null;
  lineup_visible: number;
};

export class PersonObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql, MIGRATIONS);
      // Contacts from before search words existed get them once.
      const hasWords = this.sql.exec(`select 1 from contact_words limit 1`).toArray().length > 0;
      if (!hasWords)
        for (const { id } of this.sql.exec<{ id: string }>(`select id from contacts`).toArray())
          this.reindex(id);
    });
    // Keep-alive pings are answered without waking the object (hibernation).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // --- Live updates ------------------------------------------------------------------
  // The person's open apps connect here (via /api/live). Connections hibernate while idle,
  // so they cost nothing until something changes.

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    // A few devices at most; drop the oldest beyond that.
    const open = this.ctx.getWebSockets();
    for (const old of open.slice(0, Math.max(0, open.length - (MAX_SOCKETS - 1)))) {
      try {
        old.close(1000, "Too many connections");
      } catch {
        // already closed
      }
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(): Promise<void> {
    // Clients only send pings (answered automatically); nothing else is accepted.
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "Closed");
    } catch {
      // already closed
    }
  }

  /** Tells this person's open apps that a gig changed (they refresh what's on screen). */
  private notify(gigId: string) {
    const message = JSON.stringify({ type: "gig_changed", gig_id: gigId });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // closed in the meantime
      }
    }
  }

  /** Whose object this is (from its name, `person:<user id>`). */
  private get userId(): string | null {
    const name = this.ctx.id.name;
    return name?.startsWith("person:") ? name.slice("person:".length) : null;
  }

  /**
   * What to tell me about this delivery, compared with what I had (run before replacing
   * the rows). Nothing for changes I made myself, or for gigs that are over.
   */
  private noticesFor(
    gigId: string,
    rows: PersonEventSummary[],
    gig: PersonGigSummary | null,
  ): NewNotification[] {
    const me = this.userId;
    if (!gig || !me || gig.changed_by === me) return [];
    const before = this.sql
      .exec<{ status: string; paid_paise: number; gig_title: string }>(
        `select status, paid_paise, gig_title from my_gigs where gig_id = ?`,
        gigId,
      )
      .toArray()[0];
    const url = `/gigs/${gigId}`;
    const now = new Date().toISOString();
    const next = rows
      .filter((r) => r.start_at >= now)
      .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    const where = (r: PersonEventSummary | undefined) =>
      r
        ? [formatDateTimeIST(r.start_at).replace(/ IST$/, ""), r.venue_name].filter(Boolean).join(" · ")
        : null;
    const out: NewNotification[] = [];
    if (!before) {
      if (gig.status !== "cancelled" && next)
        out.push({
          kind: "gig_added",
          title: `You're on “${gig.gig_title}”`,
          body: [where(next), gig.role === "manager" ? "as a manager" : null].filter(Boolean).join(" · "),
          url,
        });
      return out;
    }
    if (before.status !== "cancelled" && gig.status === "cancelled") {
      out.push({ kind: "gig_cancelled", title: `“${gig.gig_title}” was cancelled`, body: where(next), url });
      return out;
    }
    if (before.status === "enquiry" && gig.status === "confirmed")
      out.push({ kind: "gig_confirmed", title: `“${gig.gig_title}” is confirmed`, body: where(next), url });
    if (gig.paid_paise > before.paid_paise)
      out.push({
        kind: "paid",
        title: `You were paid ${formatINR(gig.paid_paise - before.paid_paise)}`,
        body: `For “${gig.gig_title}”`,
        url,
      });
    // A time or venue change on an event that's still ahead.
    const old = new Map(
      this.sql
        .exec<{ event_id: string; start_at: string; venue_name: string | null }>(
          `select event_id, start_at, venue_name from my_events where gig_id = ?`,
          gigId,
        )
        .toArray()
        .map((e) => [e.event_id, e]),
    );
    const moved = rows.find((r) => {
      const o = old.get(r.event_id);
      return (
        o && r.start_at >= now && (o.start_at !== r.start_at || (o.venue_name ?? "") !== (r.venue_name ?? ""))
      );
    });
    if (moved && gig.status !== "cancelled")
      out.push({
        kind: "gig_changed",
        title: `“${gig.gig_title}” changed`,
        body: `Now ${where(moved)}`,
        url,
      });
    return out;
  }

  /** Replaces this gig's rows if `seq` is at least what was applied. Returns whether applied. */
  async apply(
    gigId: string,
    seq: number,
    rows: PersonEventSummary[],
    gig: PersonGigSummary | null = null,
  ): Promise<boolean> {
    let notices: NewNotification[] = [];
    const applied = this.ctx.storage.transactionSync(() => {
      const current = this.sql
        .exec<{ seq: number }>(`select seq from applied where gig_id = ?`, gigId)
        .toArray()[0]?.seq;
      if (current !== undefined && seq < current) return false;
      notices = this.noticesFor(gigId, rows, gig);
      this.sql.exec(`delete from my_events where gig_id = ?`, gigId);
      this.sql.exec(`delete from my_gigs where gig_id = ?`, gigId);
      this.sql.exec(`delete from my_gig_tags where gig_id = ?`, gigId);
      this.sql.exec(`delete from my_gig_people where gig_id = ?`, gigId);
      this.learn(gigId, gig?.first_start_at ?? null, gig?.contacts ?? []);
      for (const t of gig?.tags ?? [])
        this.sql.exec(
          `insert or ignore into my_gig_tags (gig_id, tag_id, name) values (?, ?, ?)`,
          gigId,
          t.id,
          t.name,
        );
      for (const u of gig?.co_user_ids ?? [])
        this.sql.exec(`insert or ignore into my_gig_people (gig_id, user_id) values (?, ?)`, gigId, u);
      if (gig)
        this.sql.exec(
          `insert into my_gigs (gig_id, gig_title, event_type, client_name, status, role, first_start_at, share_paise,
             paid_paise, fee_paise, received_paise, expenses_paise, shares_total_paise, payouts_paise,
             collective_tag_id, collective_name, lineup_visible)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          gig.gig_id,
          gig.gig_title,
          gig.event_type ?? null,
          gig.client_name ?? null,
          gig.status,
          gig.role,
          gig.first_start_at,
          gig.share_paise,
          gig.paid_paise,
          gig.fee_paise,
          gig.received_paise,
          gig.expenses_paise,
          gig.shares_total_paise,
          gig.payouts_paise ?? null,
          gig.collective?.id ?? null,
          gig.collective?.name ?? null,
          gig.lineup_visible ? 1 : 0,
        );
      for (const r of rows) {
        this.sql.exec(
          `insert into my_events (event_id, gig_id, gig_title, event_title, event_type, client_name, start_at, end_at,
             venue_name, status, role, part, share_paise, collective_name)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.event_id,
          r.gig_id,
          r.gig_title,
          r.event_title,
          r.event_type,
          r.client_name,
          r.start_at,
          r.end_at,
          r.venue_name,
          r.status,
          r.role,
          r.part ?? null,
          r.share_paise ?? 0,
          r.collective_name ?? null,
        );
      }
      this.sql.exec(
        `insert into applied (gig_id, seq, at) values (?, ?, ?)
         on conflict (gig_id) do update set seq = excluded.seq, at = excluded.at`,
        gigId,
        seq,
        new Date().toISOString(),
      );
      return true;
    });
    if (applied) this.notify(gigId);
    // Tell me what changed, unless I changed it (best effort; never blocks the update).
    if (applied && this.userId) for (const n of notices) await notify(this.env, this.userId, n);
    return applied;
  }

  /**
   * The gig id to use for a "create gig" request with this Idempotency-Key: the same id
   * for every retry of that request, so a retry reaches the same gig's database.
   */
  async gigIdForKey(key: string): Promise<string> {
    return this.ctx.storage.transactionSync(() => {
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      this.sql.exec(`delete from create_keys where created_at < ?`, cutoff);
      const row = this.sql
        .exec<{ gig_id: string }>(`select gig_id from create_keys where key = ?`, key)
        .toArray()[0];
      if (row) return row.gig_id;
      const gigId = ulid();
      this.sql.exec(
        `insert into create_keys (key, gig_id, created_at) values (?, ?, ?)`,
        key,
        gigId,
        new Date().toISOString(),
      );
      return gigId;
    });
  }

  /**
   * My events in start order, a page at a time. The cursor is the last row's
   * (start_at, event_id); `order` picks direction.
   */
  async events(
    q: {
      from?: string;
      to?: string;
      q?: string;
      status?: string;
      /** Leave out events of gigs with this status (Home skips cancelled ones). */
      exclude_status?: string;
      order?: "asc" | "desc";
      limit?: number;
      after?: [string, string] | null;
    } = {},
  ): Promise<PersonEventSummary[]> {
    const desc = q.order === "desc";
    const after = q.after ?? null;
    const cmp = desc ? "<" : ">";
    return this.sql
      .exec<PersonEventSummary>(
        `select gig_id, event_id, gig_title, event_title, event_type, client_name, start_at, end_at, venue_name,
                status, role, part, share_paise, collective_name
         from my_events
         where start_at >= ? and start_at < ?
           and (? is null or status = ?) and (? is null or status <> ?)
           and (? is null or lower(gig_title || ' ' || coalesce(event_title, '') || ' ' || coalesce(client_name, '')
                || ' ' || coalesce(venue_name, '')) like ? escape '\\')
           and (? is null or start_at ${cmp} ? or (start_at = ? and event_id ${cmp} ?))
         order by start_at ${desc ? "desc" : "asc"}, event_id ${desc ? "desc" : "asc"}
         limit ?`,
        q.from ?? "",
        q.to ?? "9999",
        q.status ?? null,
        q.status ?? null,
        q.exclude_status ?? null,
        q.exclude_status ?? null,
        q.q ? 1 : null,
        q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null,
        after ? 1 : null,
        after?.[0] ?? null,
        after?.[0] ?? null,
        after?.[1] ?? null,
        q.limit ?? 1000,
      )
      .toArray();
  }

  /** My gigs with money, by first event, optionally filtered (Home and reports). */
  async gigs(
    q: {
      from?: string;
      to?: string;
      status?: string;
      role?: string;
      client?: string;
      collective_id?: string;
      /** Gigs carrying all of these tags. */
      tag_ids?: string[];
      /** Load each gig's custom tags (reports); Home doesn't need them. */
      with_tags?: boolean;
    } = {},
  ): Promise<PersonGigSummary[]> {
    const tagIds = (q.tag_ids ?? []).slice(0, 10);
    const tagClause = tagIds
      .map(() => ` and gig_id in (select gig_id from my_gig_tags where tag_id = ?)`)
      .join("");
    const rows = this.sql
      .exec<GigRow>(
        `select gig_id, gig_title, event_type, client_name, status, role, first_start_at, share_paise, paid_paise,
                fee_paise, received_paise, expenses_paise, shares_total_paise, payouts_paise,
                collective_tag_id, collective_name, lineup_visible
         from my_gigs
         where first_start_at >= ? and first_start_at < ?
           and (? is null or status = ?) and (? is null or role = ?)
           and (? is null or lower(client_name) = lower(?))
           and (? is null or collective_tag_id = ?)${tagClause}
         order by first_start_at, gig_id`,
        q.from ?? "",
        q.to ?? "9999",
        q.status ?? null,
        q.status ?? null,
        q.role ?? null,
        q.role ?? null,
        q.client ?? null,
        q.client ?? null,
        q.collective_id ?? null,
        q.collective_id ?? null,
        ...tagIds,
      )
      .toArray();
    const tags = new Map<string, { id: string; name: string }[]>();
    // Only the tags of gigs in the same date range (a person's history can be long).
    for (const t of q.with_tags
      ? this.sql.exec<{ gig_id: string; tag_id: string; name: string }>(
          `select t.gig_id, t.tag_id, t.name from my_gig_tags t join my_gigs g on g.gig_id = t.gig_id
           where g.first_start_at >= ? and g.first_start_at < ?`,
          q.from ?? "",
          q.to ?? "9999",
        )
      : [])
      tags.set(t.gig_id, [...(tags.get(t.gig_id) ?? []), { id: t.tag_id, name: t.name }]);
    return rows.map(({ collective_tag_id, collective_name, lineup_visible, ...g }) => ({
      ...g,
      collective: collective_tag_id ? { id: collective_tag_id, name: collective_name ?? "" } : null,
      tags: tags.get(g.gig_id) ?? [],
      lineup_visible: lineup_visible === 1,
    }));
  }

  /** Tags on gigs I'm on, most used first (suggestions; collective ones also for autofill). */
  async tags(q: { kind?: "collective" | "custom"; search?: string } = {}) {
    const like = q.search ? `%${q.search.toLowerCase()}%` : null;
    const custom = this.sql
      .exec<{ id: string; name: string; gigs: number }>(
        `select tag_id as id, max(name) as name, count(*) as gigs from my_gig_tags
         where (? is null or lower(name) like ?) group by tag_id order by gigs desc, name limit 50`,
        like,
        like,
      )
      .toArray()
      .map((t) => ({ ...t, kind: "custom" as const }));
    const collective = this.sql
      .exec<{ id: string; name: string; gigs: number }>(
        `select collective_tag_id as id, max(collective_name) as name, count(*) as gigs from my_gigs
         where collective_tag_id is not null and (? is null or lower(collective_name) like ?)
         group by collective_tag_id order by gigs desc, name limit 50`,
        like,
        like,
      )
      .toArray()
      .map((t) => ({ ...t, kind: "collective" as const }));
    if (q.kind === "custom") return custom;
    if (q.kind === "collective") return collective;
    return [...collective, ...custom];
  }

  /** My latest gig with this collective tag whose lineup I could see (for autofill). */
  async latestWithCollective(collectiveId: string): Promise<string | null> {
    return (
      this.sql
        .exec<{ gig_id: string }>(
          `select gig_id from my_gigs where collective_tag_id = ? and lineup_visible = 1
           order by first_start_at desc limit 1`,
          collectiveId,
        )
        .toArray()[0]?.gig_id ?? null
    );
  }

  /** Which of these people I've been on a gig with. */
  async knownAmong(userIds: string[]): Promise<string[]> {
    const known = new Set(
      this.sql
        .exec<{ user_id: string }>(`select distinct user_id from my_gig_people`)
        .toArray()
        .map((r) => r.user_id),
    );
    return userIds.filter((u) => known.has(u));
  }

  /** Which of these gigs I'm on. */
  async onGigs(gigIds: string[]): Promise<string[]> {
    const mine = new Set(
      this.sql
        .exec<{ gig_id: string }>(`select gig_id from my_gigs`)
        .toArray()
        .map((r) => r.gig_id),
    );
    return gigIds.filter((g) => mine.has(g));
  }

  // --- Address book ------------------------------------------------------------------

  /**
   * Links this gig's client, venues and people to my contacts, adding the ones I don't
   * have (inside `apply`'s transaction). Blanks are filled in; what I typed is never
   * overwritten, and contacts I deleted stay deleted.
   */
  private learn(gigId: string, usedAt: string | null, learned: LearnedContact[]) {
    this.sql.exec(`delete from contact_gigs where gig_id = ?`, gigId);
    for (const c of learned) {
      const name = c.name.trim().replace(/\s+/g, " ");
      if (!name) continue;
      const existing = this.matchContact(c.kind, name, c.email ?? null, c.user_id ?? null);
      if (existing?.deleted_at) continue;
      const now = nowIso();
      const system: Actor = { userId: null, source: "system" };
      let id = existing?.id;
      if (!id) {
        id = ulid();
        this.sql.exec(
          `insert into contacts (id, kind, name, name_key, phone, email, city, user_id, last_used_at, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          c.kind,
          name,
          nameKey(name),
          c.phone ?? null,
          c.email ?? null,
          c.city ?? null,
          c.user_id ?? null,
          usedAt,
          now,
          now,
        );
        this.reindex(id);
        audit(this.sql, system, {
          action: "learn_contact",
          entityType: "contact",
          entityId: id,
          after: { ...c, gig_id: gigId },
        });
      } else {
        this.sql.exec(
          `update contacts set phone = coalesce(phone, ?), email = coalesce(email, ?), city = coalesce(city, ?),
             user_id = coalesce(user_id, ?),
             last_used_at = case when last_used_at is null or last_used_at < ? then ? else last_used_at end
           where id = ?`,
          c.phone ?? null,
          c.email ?? null,
          c.city ?? null,
          c.user_id ?? null,
          usedAt,
          usedAt,
          id,
        );
        // Only blanks were filled: record it when something actually changed.
        const after = this.sql.exec<ContactRow>(`select * from contacts where id = ?`, id).one();
        const fields = ["phone", "email", "city", "user_id"] as const;
        if (fields.some((f) => after[f] !== existing![f])) {
          this.reindex(id);
          audit(this.sql, system, {
            action: "learn_contact_details",
            entityType: "contact",
            entityId: id,
            before: Object.fromEntries(fields.map((f) => [f, existing![f]])),
            after: Object.fromEntries(fields.map((f) => [f, after[f]])),
          });
        }
      }
      this.sql.exec(`insert or ignore into contact_gigs (contact_id, gig_id) values (?, ?)`, id, gigId);
    }
  }

  /** The contact this is (people by account, then email, then name; others by name). */
  private matchContact(kind: ContactKind, name: string, email: string | null, userId: string | null) {
    const find = (where: string, value: string) =>
      this.sql
        .exec<ContactRow>(`select * from contacts where kind = ? and ${where} = ? limit 1`, kind, value)
        .toArray()[0];
    if (kind === "person") {
      const byUser = userId ? find("user_id", userId) : undefined;
      if (byUser) return byUser;
      const byEmail = email ? find("email", email.toLowerCase()) : undefined;
      if (byEmail) return byEmail;
    }
    const byName = find("name_key", nameKey(name));
    if (byName) return byName;
    // A contact I renamed is still found by its old name (gigs keep the old one).
    const alias = this.sql
      .exec<{ contact_id: string }>(
        `select contact_id from contact_aliases where kind = ? and name_key = ?`,
        kind,
        nameKey(name),
      )
      .toArray()[0];
    return alias
      ? this.sql.exec<ContactRow>(`select * from contacts where id = ?`, alias.contact_id).toArray()[0]
      : undefined;
  }

  /** Refreshes a contact's search words. */
  private reindex(id: string) {
    this.sql.exec(`delete from contact_words where contact_id = ?`, id);
    const c = this.sql.exec<ContactRow>(`select * from contacts where id = ?`, id).toArray()[0];
    if (!c) return;
    for (const w of contactWords(c))
      this.sql.exec(`insert or ignore into contact_words (word, contact_id) values (?, ?)`, w, id);
  }

  /**
   * My contacts, most recently used first, optionally of one kind or matching a search.
   * Every search word must be the start of one of the contact's words (indexed lookups).
   */
  async contacts(q: { kind?: ContactKind; search?: string; limit?: number } = {}): Promise<ContactView[]> {
    const limit = q.limit ?? 50;
    const select = `select ${CONTACT_COLUMNS}, (select count(*) from contact_gigs g where g.contact_id = c.id) as gigs
       from contacts c`;
    const order = `order by c.last_used_at is null, c.last_used_at desc, c.name_key`;
    const terms = q.search ? searchTerms(q.search) : [];
    if (!terms.length) {
      return this.sql
        .exec<ContactOut>(
          `${select} where c.deleted_at is null and ${q.kind ? "c.kind = ?" : "c.kind in ('client', 'venue', 'person')"}
           ${order} limit ?`,
          ...(q.kind ? [q.kind] : []),
          limit,
        )
        .toArray();
    }
    let ids = null as Set<string> | null;
    for (const t of terms) {
      const found = new Set(
        this.sql
          .exec<{ contact_id: string }>(
            `select contact_id from contact_words where word >= ? and word < ?`,
            t,
            `${t}\uffff`,
          )
          .toArray()
          .map((r) => r.contact_id),
      );
      ids = ids ? new Set([...ids].filter((id: string) => found.has(id))) : found;
      if (!ids.size) return [];
    }
    const list = [...ids!].slice(0, 500);
    return this.sql
      .exec<ContactOut>(
        `${select} where c.id in (${list.map(() => "?").join(", ")}) and c.deleted_at is null
         ${q.kind ? "and c.kind = ?" : ""} ${order} limit ?`,
        ...list,
        ...(q.kind ? [q.kind] : []),
        limit,
      )
      .toArray();
  }

  /** Adds a contact, or brings back one I deleted with the same name (same kind). */
  /** My gig types, in order (the defaults until I change them). */
  async gigTypes(): Promise<GigTypesView> {
    if (getMeta(this.sql, "gig_types_set") !== "1") return { types: [...DEFAULT_GIG_TYPES] };
    return {
      types: this.sql
        .exec<{ name: string }>(`select name from gig_types order by position`)
        .toArray()
        .map((r) => r.name),
    };
  }

  /** Replaces my gig types (already validated: trimmed, unique, at most 30). */
  async setGigTypes(actor: Actor, key: string | null, types: string[]): Promise<GigTypesView> {
    return idempotent(this.ctx.storage, key, await hashOf(["set_gig_types", types]), () => {
      const before = this.sql
        .exec<{ name: string }>(`select name from gig_types order by position`)
        .toArray()
        .map((r) => r.name);
      this.sql.exec(`delete from gig_types`);
      types.forEach((name, i) =>
        this.sql.exec(
          `insert into gig_types (name_key, name, position) values (?, ?, ?)`,
          name.toLowerCase(),
          name,
          i,
        ),
      );
      setMeta(this.sql, "gig_types_set", "1");
      audit(this.sql, actor, {
        action: "set_gig_types",
        entityType: "gig_types",
        entityId: this.userId ?? "",
        before,
        after: types,
      });
      return { types };
    });
  }

  async saveContact(
    actor: Actor,
    key: string | null,
    input: {
      kind: ContactKind;
      name: string;
      phone?: string | null;
      email?: string | null;
      city?: string | null;
      notes?: string | null;
    },
  ): Promise<ContactView> {
    const hash = await hashOf(["save_contact", input]);
    return idempotent(this.ctx.storage, key, hash, () => {
      const name = input.name.trim().replace(/\s+/g, " ");
      const existing = this.matchContact(input.kind, name, input.email ?? null, null);
      if (existing && !existing.deleted_at)
        throw new ObjectError("conflict", `“${existing.name}” is already in your address book`, {
          reason: "duplicate_contact",
          contact_id: existing.id,
        });
      const now = nowIso();
      const id = existing?.id ?? ulid();
      if (existing) {
        this.sql.exec(
          `update contacts set name = ?, name_key = ?, phone = ?, email = ?, city = ?, notes = ?, deleted_at = null,
             updated_at = ? where id = ?`,
          name,
          nameKey(name),
          input.phone ?? null,
          input.email ?? null,
          input.city ?? null,
          input.notes ?? null,
          now,
          id,
        );
      } else {
        this.sql.exec(
          `insert into contacts (id, kind, name, name_key, phone, email, city, notes, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          input.kind,
          name,
          nameKey(name),
          input.phone ?? null,
          input.email ?? null,
          input.city ?? null,
          input.notes ?? null,
          now,
          now,
        );
      }
      this.sql.exec(`delete from contact_aliases where kind = ? and name_key = ?`, input.kind, nameKey(name));
      this.reindex(id);
      const after = this.contact(id);
      audit(this.sql, actor, { action: "save_contact", entityType: "contact", entityId: id, after });
      return after;
    });
  }

  /** Changes a contact's details (only the fields given; null clears one). */
  async updateContact(
    actor: Actor,
    key: string | null,
    input: {
      contact_id: string;
      name?: string;
      phone?: string | null;
      email?: string | null;
      city?: string | null;
      notes?: string | null;
    },
  ): Promise<ContactView> {
    const hash = await hashOf(["update_contact", input]);
    return idempotent(this.ctx.storage, key, hash, () => {
      const before = this.contact(input.contact_id);
      const name = input.name?.trim().replace(/\s+/g, " ");
      if (name && nameKey(name) !== nameKey(before.name)) {
        const clash = this.matchContact(before.kind, name, null, null);
        if (clash && !clash.deleted_at && clash.id !== before.id)
          throw new ObjectError("conflict", `“${clash.name}” is already in your address book`, {
            reason: "duplicate_contact",
            contact_id: clash.id,
          });
      }
      const pick = <K extends "phone" | "email" | "city" | "notes">(k: K) =>
        input[k] === undefined ? before[k] : input[k];
      this.sql.exec(
        `update contacts set name = ?, name_key = ?, phone = ?, email = ?, city = ?, notes = ?, updated_at = ?
         where id = ?`,
        name ?? before.name,
        nameKey(name ?? before.name),
        pick("phone"),
        pick("email"),
        pick("city"),
        pick("notes"),
        nowIso(),
        before.id,
      );
      if (name && nameKey(name) !== nameKey(before.name)) {
        // Gigs that used the old name keep finding this contact.
        this.sql.exec(
          `insert into contact_aliases (kind, name_key, contact_id) values (?, ?, ?)
           on conflict (kind, name_key) do update set contact_id = excluded.contact_id`,
          before.kind,
          nameKey(before.name),
          before.id,
        );
        this.sql.exec(
          `delete from contact_aliases where kind = ? and name_key = ?`,
          before.kind,
          nameKey(name),
        );
      }
      this.reindex(before.id);
      const after = this.contact(before.id);
      audit(this.sql, actor, {
        action: "update_contact",
        entityType: "contact",
        entityId: before.id,
        before,
        after,
      });
      return after;
    });
  }

  /** Removes a contact from the address book (soft delete; gigs keep their own copy). */
  async removeContact(actor: Actor, key: string | null, contactId: string): Promise<{ removed: true }> {
    const hash = await hashOf(["remove_contact", contactId]);
    return idempotent(this.ctx.storage, key, hash, () => {
      const before = this.contact(contactId);
      this.sql.exec(
        `update contacts set deleted_at = ?, updated_at = ? where id = ?`,
        nowIso(),
        nowIso(),
        contactId,
      );
      audit(this.sql, actor, {
        action: "remove_contact",
        entityType: "contact",
        entityId: contactId,
        before,
      });
      return { removed: true as const };
    });
  }

  private contact(id: string): ContactView {
    const row = this.sql
      .exec<ContactOut>(
        `select ${CONTACT_COLUMNS}, (select count(*) from contact_gigs g where g.contact_id = c.id) as gigs
         from contacts c where c.id = ? and c.deleted_at is null`,
        id,
      )
      .toArray()[0];
    if (!row) throw new ObjectError("not_found", "Contact not found");
    return row;
  }

  /** My address book for backups (links to gigs are rebuilt from the gigs themselves). */
  async exportContacts(): Promise<Record<string, SqlStorageValue>[]> {
    return this.sql.exec(`select * from contacts`).toArray();
  }

  /** Restores contacts from a backup; ones that exist are left alone. Returns how many were added. */
  async importContacts(rows: Record<string, SqlStorageValue>[]): Promise<number> {
    const columns = [
      "id",
      "kind",
      "name",
      "name_key",
      "phone",
      "email",
      "city",
      "notes",
      "user_id",
      "last_used_at",
      "created_at",
      "updated_at",
      "deleted_at",
    ];
    let added = 0;
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        const cursor = this.sql.exec(
          `insert or ignore into contacts (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
          ...columns.map((c) => row[c] ?? null),
        );
        if (cursor.rowsWritten > 0) {
          added++;
          this.reindex(String(row.id));
        }
      }
    });
    return added;
  }

  /** My gigs to choose from in a Shortcut: not cancelled, latest first, matching `q`. */
  async pickGigs(q: string | null, limit = 10) {
    const like = q ? `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return this.sql
      .exec<{ gig_id: string; gig_title: string; first_start_at: string }>(
        `select gig_id, gig_title, first_start_at from my_gigs
         where status <> 'cancelled'
           and (? is null or lower(gig_title || ' ' || coalesce(client_name, '')) like ? escape '\\')
         order by first_start_at desc limit ?`,
        like,
        like,
        limit,
      )
      .toArray();
  }

  // --- Calendar feed -------------------------------------------------------------------

  /** My events from `from` on (cancelled ones too, so calendars remove them), soonest first. */
  async calendarEvents(from: string, limit = 500) {
    return this.sql
      .exec<{
        event_id: string;
        gig_id: string;
        gig_title: string;
        event_title: string | null;
        client_name: string | null;
        start_at: string;
        end_at: string | null;
        venue_name: string | null;
        status: string;
        role: "manager" | "player";
        part: string | null;
        collective_name: string | null;
        updated_at: string | null;
      }>(
        `select e.event_id, e.gig_id, e.gig_title, e.event_title, e.client_name, e.start_at, e.end_at,
           e.venue_name, e.status, e.role, e.part, e.collective_name, a.at as updated_at
         from my_events e left join applied a on a.gig_id = e.gig_id
         where e.start_at >= ? order by e.start_at limit ?`,
        from,
        limit,
      )
      .toArray();
  }
}
