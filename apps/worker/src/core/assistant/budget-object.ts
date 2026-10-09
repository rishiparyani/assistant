// The AI budget (docs/design/universal.md §10 "AI cost and limits"): one small object
// ("budget:global") that keeps the monthly cap. Before a paid call the router reserves the
// call's most it could cost; after the call it settles to the real cost. A call is refused
// when spent + reserved would pass the cap less 10% headroom, so spending stays under the
// cap even though Cloudflare's own limits are only eventually consistent. It also counts
// free-route neurons per day and logs every call (ids and numbers only, no message text).
// AI calls are few (hundreds a day), so one writer per call is fine here (design §10).
import { DurableObject } from "cloudflare:workers";
import { migrate, nowIso, type Migrations } from "../objects/storage.ts";

const MIGRATIONS: Migrations = [
  `
  create table spend (
    month text not null,
    user_id text not null,
    spent_paise integer not null default 0,
    reserved_paise integer not null default 0,
    primary key (month, user_id)
  ) without rowid;
  create table reservations (
    id text primary key,
    month text not null,
    user_id text not null,
    paise integer not null,
    created_at text not null
  );
  create index reservations_created_idx on reservations (created_at);
  create table neurons (
    day text primary key,
    used integer not null default 0
  );
  create table calls (
    id integer primary key autoincrement,
    at text not null,
    user_id text not null,
    level integer not null,
    model text not null,
    input_tokens integer not null,
    output_tokens integer not null,
    cost_paise integer not null,
    neurons integer not null,
    ms integer not null,
    outcome text not null
  );
  create index calls_at_idx on calls (at);
  `,
];

/** Months and days in India time (the cap resets on the 1st, IST). */
const IST = 330 * 60_000;
export const monthOf = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 7);
/** Workers AI's free allowance resets at 00:00 UTC. */
export const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export type Reservation = { ok: true; id: string } | { ok: false; reason: "cap" | "person_cap" };

export interface CallLog {
  userId: string;
  level: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costPaise: number;
  neurons: number;
  ms: number;
  outcome: string;
}

export interface BudgetView {
  month: string;
  spent_paise: number;
  reserved_paise: number;
  cap_paise: number;
  neurons_today: number;
  calls_today: number;
}

export class BudgetObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  private totals(month: string, userId?: string) {
    return this.sql
      .exec<{ spent: number; reserved: number }>(
        `select coalesce(sum(spent_paise), 0) as spent, coalesce(sum(reserved_paise), 0) as reserved
         from spend where month = ?${userId ? " and user_id = ?" : ""}`,
        ...(userId ? [month, userId] : [month]),
      )
      .one();
  }

  /** Holds `paise` for one call, if it fits under both caps (less 10% headroom). */
  async reserve(
    userId: string,
    paise: number,
    capPaise: number,
    personCapPaise: number,
  ): Promise<Reservation> {
    this.expireStale();
    const month = monthOf();
    const all = this.totals(month);
    if (all.spent + all.reserved + paise > capPaise * 0.9) return { ok: false, reason: "cap" };
    const mine = this.totals(month, userId);
    if (mine.spent + mine.reserved + paise > personCapPaise * 0.9) return { ok: false, reason: "person_cap" };
    const id = crypto.randomUUID();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `insert into reservations (id, month, user_id, paise, created_at) values (?, ?, ?, ?, ?)`,
        id,
        month,
        userId,
        paise,
        nowIso(),
      );
      this.sql.exec(
        `insert into spend (month, user_id, reserved_paise) values (?, ?, ?)
         on conflict (month, user_id) do update set reserved_paise = reserved_paise + excluded.reserved_paise`,
        month,
        userId,
        paise,
      );
    });
    return { ok: true, id };
  }

  /** Turns a reservation into the real cost (0 if the call failed before it was billed). */
  async settle(reservationId: string, actualPaise: number): Promise<void> {
    this.settleNow(reservationId, actualPaise);
  }

  private settleNow(reservationId: string, actualPaise: number) {
    const r = this.sql
      .exec<{ month: string; user_id: string; paise: number }>(
        `select month, user_id, paise from reservations where id = ?`,
        reservationId,
      )
      .toArray()[0];
    if (!r) return;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`delete from reservations where id = ?`, reservationId);
      this.sql.exec(
        `update spend set reserved_paise = max(0, reserved_paise - ?), spent_paise = spent_paise + ?
         where month = ? and user_id = ?`,
        r.paise,
        actualPaise,
        r.month,
        r.user_id,
      );
    });
  }

  /** Free-route neurons used today; `add` counts a call's. */
  async neurons(add = 0): Promise<number> {
    const day = dayOf();
    if (add > 0)
      this.sql.exec(
        `insert into neurons (day, used) values (?, ?) on conflict (day) do update set used = used + excluded.used`,
        day,
        add,
      );
    return (
      this.sql.exec<{ used: number }>(`select used from neurons where day = ?`, day).toArray()[0]?.used ?? 0
    );
  }

  async log(c: CallLog): Promise<void> {
    this.sql.exec(
      `insert into calls (at, user_id, level, model, input_tokens, output_tokens, cost_paise, neurons, ms, outcome)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nowIso(),
      c.userId,
      c.level,
      c.model,
      c.inputTokens,
      c.outputTokens,
      c.costPaise,
      c.neurons,
      c.ms,
      c.outcome,
    );
    // Keep 90 days of call logs.
    this.sql.exec(`delete from calls where at < ?`, new Date(Date.now() - 90 * 86400_000).toISOString());
  }

  async view(capPaise: number): Promise<BudgetView> {
    const month = monthOf();
    const t = this.totals(month);
    const day = dayOf();
    return {
      month,
      spent_paise: t.spent,
      reserved_paise: t.reserved,
      cap_paise: capPaise,
      neurons_today: await this.neurons(),
      calls_today: this.sql.exec<{ n: number }>(`select count(*) as n from calls where at >= ?`, day).one().n,
    };
  }

  /**
   * A reservation older than 10 minutes belongs to a call that never settled; count it as
   * spent in full (it may have been billed), so the cap stays safe.
   */
  private expireStale() {
    const stale = this.sql
      .exec<{ id: string; paise: number }>(
        `select id, paise from reservations where created_at < ?`,
        new Date(Date.now() - 10 * 60_000).toISOString(),
      )
      .toArray();
    for (const s of stale) this.settleNow(s.id, s.paise);
  }
}
