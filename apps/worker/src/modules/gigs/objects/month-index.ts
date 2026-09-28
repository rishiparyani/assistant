// A month's index (docs/design/gig-centric.md §5): one card per event dated that month,
// for duplicate warnings and date lookups, plus the registry of gigs created that month
// (so the rebuild tool can find every gig without a global list). Split by month because
// every question the index answers starts with a date.
import { DurableObject } from "cloudflare:workers";
import { migrate, type Migrations } from "../../../core/objects/storage.ts";
import type { IndexCard } from "./types.ts";

const MIGRATIONS: Migrations = [
  `
  create table cards (
    event_id text primary key,
    gig_id text not null,
    start_at text not null,
    date text not null,
    venue_key text,
    status text not null,
    manager_user_ids text not null
  );
  create index cards_gig_idx on cards (gig_id);
  create index cards_date_idx on cards (date);
  create table applied (gig_id text primary key, seq integer not null);
  create table created (gig_id text primary key);
  `,
  // Step 5: duplicate warnings match on venue or client, and show the venue's name.
  `
  alter table cards add column venue_name text;
  alter table cards add column client_key text;
  `,
];

export class MonthIndexObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  async apply(gigId: string, seq: number, cards: IndexCard[]): Promise<boolean> {
    return this.ctx.storage.transactionSync(() => {
      const current = this.sql
        .exec<{ seq: number }>(`select seq from applied where gig_id = ?`, gigId)
        .toArray()[0]?.seq;
      if (current !== undefined && seq < current) return false;
      this.sql.exec(`delete from cards where gig_id = ?`, gigId);
      for (const c of cards) {
        this.sql.exec(
          `insert into cards (event_id, gig_id, start_at, date, venue_key, status, manager_user_ids, venue_name,
             client_key)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          c.event_id,
          c.gig_id,
          c.start_at,
          c.date,
          c.venue_key,
          c.status,
          JSON.stringify(c.manager_user_ids),
          c.venue_name ?? null,
          c.client_key ?? null,
        );
      }
      this.sql.exec(
        `insert into applied (gig_id, seq) values (?, ?) on conflict (gig_id) do update set seq = excluded.seq`,
        gigId,
        seq,
      );
      return true;
    });
  }

  async onDate(date: string): Promise<IndexCard[]> {
    return this.sql
      .exec<Omit<IndexCard, "manager_user_ids"> & { manager_user_ids: string }>(
        `select gig_id, event_id, start_at, date, venue_key, venue_name, client_key, status, manager_user_ids
         from cards where date = ? order by start_at`,
        date,
      )
      .toArray()
      .map((c) => ({ ...c, manager_user_ids: JSON.parse(c.manager_user_ids) as string[] }));
  }

  async registerCreated(gigId: string): Promise<void> {
    this.sql.exec(`insert or ignore into created (gig_id) values (?)`, gigId);
  }

  async createdCount(): Promise<number> {
    return Number(this.sql.exec(`select count(*) as n from created`).one().n);
  }

  async createdGigs(): Promise<string[]> {
    return this.sql
      .exec<{ gig_id: string }>(`select gig_id from created order by gig_id`)
      .toArray()
      .map((r) => r.gig_id);
  }
}
