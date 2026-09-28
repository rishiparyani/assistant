// One person's own database (docs/design/gig-centric.md §5): summaries of the gigs and
// events they're on, used for Home and reports. Written only by summary deliveries, which
// may repeat or arrive out of order: a delivery replaces the gig's rows only if its
// sequence number isn't older than what's already applied.
import { DurableObject } from "cloudflare:workers";
import { ulid } from "@assistant/shared";
import type { ContactKind, ContactView } from "@assistant/shared";
import { ObjectError } from "../../../core/objects/errors.ts";
import {
  audit,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  type Actor,
  type Migrations,
} from "../../../core/objects/storage.ts";
import type { LearnedContact, PersonEventSummary, PersonGigSummary } from "./types.ts";

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
];

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
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
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

  /** Replaces this gig's rows if `seq` is at least what was applied. Returns whether applied. */
  async apply(
    gigId: string,
    seq: number,
    rows: PersonEventSummary[],
    gig: PersonGigSummary | null = null,
  ): Promise<boolean> {
    const applied = this.ctx.storage.transactionSync(() => {
      const current = this.sql
        .exec<{ seq: number }>(`select seq from applied where gig_id = ?`, gigId)
        .toArray()[0]?.seq;
      if (current !== undefined && seq < current) return false;
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
    return find("name_key", nameKey(name));
  }

  /** My contacts, most recently used first, optionally of one kind or matching a search. */
  async contacts(q: { kind?: ContactKind; search?: string; limit?: number } = {}): Promise<ContactView[]> {
    const like = q.search ? `%${q.search.toLowerCase()}%` : null;
    return this.sql
      .exec<ContactOut>(
        `select ${CONTACT_COLUMNS}, (select count(*) from contact_gigs g where g.contact_id = c.id) as gigs
         from contacts c
         where c.deleted_at is null and (? is null or c.kind = ?)
           and (? is null or c.name_key like ? or lower(coalesce(c.email, '')) like ?
                or coalesce(c.phone, '') like ? or lower(coalesce(c.city, '')) like ?)
         order by c.last_used_at is null, c.last_used_at desc, c.name_key
         limit ?`,
        q.kind ?? null,
        q.kind ?? null,
        like,
        like,
        like,
        like,
        like,
        q.limit ?? 50,
      )
      .toArray();
  }

  /** Adds a contact, or brings back one I deleted with the same name (same kind). */
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
        added += cursor.rowsWritten > 0 ? 1 : 0;
      }
    });
    return added;
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
