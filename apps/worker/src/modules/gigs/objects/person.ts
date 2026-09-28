// One person's own database (docs/design/gig-centric.md §5): summaries of the gigs and
// events they're on, used for Home and reports. Written only by summary deliveries, which
// may repeat or arrive out of order: a delivery replaces the gig's rows only if its
// sequence number isn't older than what's already applied.
import { DurableObject } from "cloudflare:workers";
import { ulid } from "@assistant/shared";
import { migrate, type Migrations } from "../../../core/objects/storage.ts";
import type { PersonEventSummary } from "./types.ts";

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
];

export class PersonObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  /** Replaces this gig's rows if `seq` is at least what was applied. Returns whether applied. */
  async apply(gigId: string, seq: number, rows: PersonEventSummary[]): Promise<boolean> {
    return this.ctx.storage.transactionSync(() => {
      const current = this.sql
        .exec<{ seq: number }>(`select seq from applied where gig_id = ?`, gigId)
        .toArray()[0]?.seq;
      if (current !== undefined && seq < current) return false;
      this.sql.exec(`delete from my_events where gig_id = ?`, gigId);
      for (const r of rows) {
        this.sql.exec(
          `insert into my_events (event_id, gig_id, gig_title, event_title, event_type, client_name, start_at, end_at,
             venue_name, status, role)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                status, role
         from my_events
         where start_at >= ? and start_at < ?
           and (? is null or start_at ${cmp} ? or (start_at = ? and event_id ${cmp} ?))
         order by start_at ${desc ? "desc" : "asc"}, event_id ${desc ? "desc" : "asc"}
         limit ?`,
        q.from ?? "",
        q.to ?? "9999",
        after ? 1 : null,
        after?.[0] ?? null,
        after?.[0] ?? null,
        after?.[1] ?? null,
        q.limit ?? 1000,
      )
      .toArray();
  }
}
