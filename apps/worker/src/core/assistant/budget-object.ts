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
  `create index calls_user_at_idx on calls (user_id, at);`,
  // Input tokens the model reused from its prompt cache (part of input_tokens).
  `alter table calls add column cached_tokens integer not null default 0;`,
  // How the assistant is doing (decision 2026-10-14 "We don't read people's data"): one row
  // per request and per signal, counts and names of tools only, never words.
  `
  create table turns (
    id integer primary key autoincrement,
    at text not null,
    user_id text not null,
    level integer not null,
    steps integer not null,
    tools_json text not null,
    errors_json text not null,
    outcome text not null,
    ms integer not null,
    prompt_version text not null
  );
  create index turns_at_idx on turns (at);
  create table signals (
    id integer primary key autoincrement,
    at text not null,
    user_id text not null,
    kind text not null,
    tool text
  );
  create index signals_at_idx on signals (at);
  `,
  // A retried request leaves one signal (its key), not two.
  `alter table signals add column key text;
   create unique index signals_key_idx on signals (key) where key is not null;`,
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
  /** Of inputTokens, how many the model reused from its prompt cache. */
  cachedTokens?: number;
  costPaise: number;
  neurons: number;
  ms: number;
  outcome: string;
}

/** One request to the assistant, as numbers and tool names (never the words). */
export interface TurnLog {
  userId: string;
  level: number;
  /** Model calls it took. */
  steps: number;
  /** Tool name → how many times it ran. */
  tools: Record<string, number>;
  /** "tool:code" → how many times the app refused it (validation_failed, not_found, …). */
  errors: Record<string, number>;
  /** answered · card · no_answer · handover_blocked · stopped */
  outcome: string;
  ms: number;
  promptVersion: string;
}

/** What people did with an answer: confirm or cancel a card, 👍 / 👎. */
export type SignalKind = "card_confirmed" | "card_cancelled" | "good" | "bad";

export interface QualityView {
  days: number;
  requests: number;
  median_ms: number | null;
  p90_ms: number | null;
  outcomes: Record<string, number>;
  signals: Record<string, number>;
  /** Most frequent refusals ("add_record:validation_failed"), most first. */
  top_errors: { key: string; n: number }[];
  /** Cards cancelled, by tool, most first. */
  top_cancelled: { key: string; n: number }[];
  models: {
    model: string;
    calls: number;
    failed: number;
    median_ms: number | null;
    tokens_in: number;
    tokens_out: number;
  }[];
  prompt_versions: { version: string; requests: number; ok: number }[];
}

export interface BudgetView {
  month: string;
  spent_paise: number;
  reserved_paise: number;
  cap_paise: number;
  neurons_today: number;
  calls_today: number;
  /** Cerebras calls today (faster answers; its trial credit has its own daily cap). */
  fast_calls_today: number;
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

  /**
   * Whether one more Cerebras call fits now (decision 2026-10-15): at most `perDay` a day for
   * everyone together, and four a minute (the trial allows five), so its credit lasts the month
   * and a burst never gets the app refused.
   */
  async fastAllowed(modelId: string, perDay: number): Promise<boolean> {
    const n = (since: string) =>
      this.sql
        .exec<{ n: number }>(`select count(*) as n from calls where model = ? and at >= ?`, modelId, since)
        .one().n;
    if (n(dayOf()) >= perDay) return false;
    return n(new Date(Date.now() - 60_000).toISOString()) < 4;
  }

  async log(c: CallLog): Promise<void> {
    this.sql.exec(
      `insert into calls (at, user_id, level, model, input_tokens, output_tokens, cached_tokens, cost_paise, neurons, ms, outcome)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nowIso(),
      c.userId,
      c.level,
      c.model,
      c.inputTokens,
      c.outputTokens,
      c.cachedTokens ?? 0,
      c.costPaise,
      c.neurons,
      c.ms,
      c.outcome,
    );
    // Keep 90 days of call logs.
    this.sql.exec(`delete from calls where at < ?`, new Date(Date.now() - 90 * 86400_000).toISOString());
  }

  async logTurn(t: TurnLog): Promise<void> {
    this.sql.exec(
      `insert into turns (at, user_id, level, steps, tools_json, errors_json, outcome, ms, prompt_version)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nowIso(),
      t.userId,
      t.level,
      t.steps,
      JSON.stringify(t.tools),
      JSON.stringify(t.errors),
      t.outcome,
      t.ms,
      t.promptVersion,
    );
    this.sql.exec(`delete from turns where at < ?`, new Date(Date.now() - 90 * 86400_000).toISOString());
  }

  /** key: the request's, so a retry leaves one signal (none: always counted). */
  async signal(
    userId: string,
    kind: SignalKind,
    tool: string | null = null,
    key: string | null = null,
  ): Promise<void> {
    this.sql.exec(
      `insert or ignore into signals (at, user_id, kind, tool, key) values (?, ?, ?, ?, ?)`,
      nowIso(),
      userId,
      kind,
      tool,
      key,
    );
    this.sql.exec(`delete from signals where at < ?`, new Date(Date.now() - 90 * 86400_000).toISOString());
  }

  /** The last `days` days, added up (for the admin panel). */
  async quality(days: number): Promise<QualityView> {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const turns = this.sql
      .exec<{ ms: number; outcome: string; errors_json: string; prompt_version: string }>(
        `select ms, outcome, errors_json, prompt_version from turns where at >= ?`,
        since,
      )
      .toArray();
    const ms = turns.map((t) => t.ms).sort((a, b) => a - b);
    const at = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]! : null);
    const count = <T extends string>(xs: T[]) =>
      xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
    const errors: Record<string, number> = {};
    for (const t of turns)
      for (const [k, n] of Object.entries(JSON.parse(t.errors_json) as Record<string, number>))
        errors[k] = (errors[k] ?? 0) + n;
    const top = (m: Record<string, number>) =>
      Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, n]) => ({ key, n }));
    const signals = this.sql
      .exec<{ kind: string; tool: string | null }>(`select kind, tool from signals where at >= ?`, since)
      .toArray();
    const calls = this.sql
      .exec<{ model: string; ms: number; outcome: string; input_tokens: number; output_tokens: number }>(
        `select model, ms, outcome, input_tokens, output_tokens from calls where at >= ?`,
        since,
      )
      .toArray();
    const byModel = new Map<string, typeof calls>();
    for (const c of calls) byModel.set(c.model, [...(byModel.get(c.model) ?? []), c]);
    const versions = new Map<string, { requests: number; ok: number }>();
    for (const t of turns) {
      const v = versions.get(t.prompt_version) ?? { requests: 0, ok: 0 };
      v.requests++;
      if (t.outcome === "answered" || t.outcome === "card") v.ok++;
      versions.set(t.prompt_version, v);
    }
    return {
      days,
      requests: turns.length,
      median_ms: at(0.5),
      p90_ms: at(0.9),
      outcomes: count(turns.map((t) => t.outcome)),
      signals: count(signals.map((x) => x.kind)),
      top_errors: top(errors),
      top_cancelled: top(count(signals.filter((x) => x.kind === "card_cancelled").map((x) => x.tool ?? "?"))),
      models: [...byModel.entries()].map(([model, cs]) => {
        const m = cs.map((c) => c.ms).sort((a, b) => a - b);
        return {
          model,
          calls: cs.length,
          failed: cs.filter((c) => c.outcome !== "ok").length,
          median_ms: m.length ? m[Math.floor(m.length / 2)]! : null,
          tokens_in: cs.reduce((n, c) => n + c.input_tokens, 0),
          tokens_out: cs.reduce((n, c) => n + c.output_tokens, 0),
        };
      }),
      prompt_versions: [...versions.entries()].map(([version, v]) => ({ version, ...v })),
    };
  }

  /** One person's model calls since a time, oldest first (the scorecard reads its test users'). */
  async callsFor(userId: string, since: string): Promise<CallLog[]> {
    return this.sql
      .exec<{
        level: number;
        model: string;
        input_tokens: number;
        output_tokens: number;
        cached_tokens: number;
        cost_paise: number;
        neurons: number;
        ms: number;
        outcome: string;
      }>(
        `select level, model, input_tokens, output_tokens, cached_tokens, cost_paise, neurons, ms, outcome
         from calls where user_id = ? and at >= ? order by at`,
        userId,
        since,
      )
      .toArray()
      .map((r) => ({
        userId,
        level: r.level,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cachedTokens: r.cached_tokens,
        costPaise: r.cost_paise,
        neurons: r.neurons,
        ms: r.ms,
        outcome: r.outcome,
      }));
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
      fast_calls_today: this.sql
        .exec<{ n: number }>(`select count(*) as n from calls where at >= ? and model not like '@cf/%'`, day)
        .one().n,
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
