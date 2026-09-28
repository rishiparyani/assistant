// One person's own database (docs/design/gig-centric.md §5): summaries of the gigs and
// events they're on, used for Home and reports. Written only by summary deliveries, which
// may repeat or arrive out of order: a delivery replaces the gig's rows only if its
// sequence number isn't older than what's already applied.
import { DurableObject } from "cloudflare:workers";
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
          `insert into my_events (event_id, gig_id, gig_title, event_title, start_at, end_at, venue_name, status, role)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.event_id,
          r.gig_id,
          r.gig_title,
          r.event_title,
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

  /** My events, soonest first, optionally from/to (UTC ISO). */
  async events(range: { from?: string; to?: string } = {}): Promise<PersonEventSummary[]> {
    return this.sql
      .exec<PersonEventSummary>(
        `select gig_id, event_id, gig_title, event_title, start_at, end_at, venue_name, status, role
         from my_events where start_at >= ? and start_at < ? order by start_at, event_id`,
        range.from ?? "",
        range.to ?? "9999",
      )
      .toArray();
  }
}
