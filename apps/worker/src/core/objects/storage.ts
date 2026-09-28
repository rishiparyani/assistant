// Building blocks for our Durable Objects (docs/design/gig-centric.md): each object is its
// own small SQLite database. These helpers keep every object consistent: schema
// migrations run when the object wakes, writes are idempotent and audited, and changes
// that others must hear about go through a one-row outbox.

import { ObjectError } from "./errors.ts";

/** Ordered schema migrations; index + 1 is the version. Never edit one that has shipped. */
export type Migrations = readonly string[];

/** Brings this object's schema up to date. Call inside `blockConcurrencyWhile` on wake. */
export function migrate(sql: SqlStorage, migrations: Migrations) {
  sql.exec(`create table if not exists _schema (version integer not null)`);
  const row = sql.exec<{ version: number }>(`select version from _schema limit 1`).toArray()[0];
  let version = row?.version ?? 0;
  if (!row) sql.exec(`insert into _schema (version) values (0)`);
  for (; version < migrations.length; version++) {
    sql.exec(migrations[version]!);
    sql.exec(`update _schema set version = ?`, version + 1);
  }
}

/** Tables every writing object has. Include as the first migration. */
export const BASE_TABLES = `
  create table _meta (key text primary key, value text not null);
  create table _audit (
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
  create table _idempotency (
    key text primary key,
    request_hash text not null,
    response_json text not null,
    created_at text not null
  );
  create index _idempotency_created_idx on _idempotency (created_at);
  create table _outbox (
    id integer primary key check (id = 1),
    seq integer not null,
    created_at text not null,
    attempts integer not null default 0
  );
`;

export const nowIso = () => new Date().toISOString();

export function getMeta(sql: SqlStorage, key: string): string | null {
  return (
    sql.exec<{ value: string }>(`select value from _meta where key = ?`, key).toArray()[0]?.value ?? null
  );
}
export function setMeta(sql: SqlStorage, key: string, value: string) {
  sql.exec(
    `insert into _meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value`,
    key,
    value,
  );
}

/** Who is acting and from where (web, siri, mcp, system). */
export interface Actor {
  userId: string | null;
  source: "web" | "siri" | "mcp" | "system";
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export function audit(sql: SqlStorage, actor: Actor, entry: AuditEntry) {
  sql.exec(
    `insert into _audit (at, actor_user_id, source, action, entity_type, entity_id, before_json, after_json)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    nowIso(),
    actor.userId,
    actor.source,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  );
}

// --- Idempotency (architecture rule 8), stored with the data it protects -------------

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

/**
 * Runs `write` once per key, atomically with its own writes: a repeat with the same key
 * returns the stored result without running again. Must be called with synchronous work
 * only (it runs inside one SQLite transaction).
 */
export function idempotent<T>(
  storage: DurableObjectStorage,
  key: string | null,
  requestHash: string,
  write: () => T,
): T {
  return storage.transactionSync(() => {
    const sql = storage.sql;
    if (key) {
      const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
      sql.exec(`delete from _idempotency where created_at < ?`, cutoff);
      const row = sql
        .exec<{ request_hash: string; response_json: string }>(
          `select request_hash, response_json from _idempotency where key = ?`,
          key,
        )
        .toArray()[0];
      if (row) {
        if (row.request_hash !== requestHash)
          throw new ObjectError("conflict", "This Idempotency-Key was already used for a different request", {
            reason: "idempotency_key_reused",
          });
        return JSON.parse(row.response_json) as T;
      }
    }
    const result = write();
    if (key) {
      sql.exec(
        `insert into _idempotency (key, request_hash, response_json, created_at) values (?, ?, ?, ?)`,
        key,
        requestHash,
        JSON.stringify(result ?? null),
        nowIso(),
      );
    }
    return result;
  });
}

// --- Outbox (transactional outbox, docs/learn/scale.md) ------------------------------

/**
 * Bumps the object's sequence number and records (or merges into) its single outbox note.
 * Call inside the same transaction as the change it announces. Returns the new sequence.
 */
export function bumpAndNote(sql: SqlStorage): number {
  const seq = Number(getMeta(sql, "seq") ?? "0") + 1;
  setMeta(sql, "seq", String(seq));
  sql.exec(
    `insert into _outbox (id, seq, created_at, attempts) values (1, ?, ?, 0)
     on conflict (id) do update set seq = excluded.seq`,
    seq,
    nowIso(),
  );
  return seq;
}

export function currentSeq(sql: SqlStorage): number {
  return Number(getMeta(sql, "seq") ?? "0");
}

export type OutboxNote = {
  seq: number;
  created_at: string;
  attempts: number;
};

export function outboxNote(sql: SqlStorage): OutboxNote | null {
  return (
    sql.exec<OutboxNote>(`select seq, created_at, attempts from _outbox where id = 1`).toArray()[0] ?? null
  );
}

/** The note was handed over: remove it unless a newer change merged into it meanwhile. */
export function clearOutbox(sql: SqlStorage, sentSeq: number): boolean {
  sql.exec(`delete from _outbox where id = 1 and seq = ?`, sentSeq);
  return outboxNote(sql) === null;
}

/** Records a failed hand-over and returns how long to wait before the next try. */
export function outboxFailed(sql: SqlStorage): number {
  sql.exec(`update _outbox set attempts = attempts + 1 where id = 1`);
  const attempts = outboxNote(sql)?.attempts ?? 1;
  return retryDelayMs(attempts);
}

/** 2 s, 4 s, 8 s … capped at 1 hour. Never gives up. */
export function retryDelayMs(attempts: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempts - 1), 3600_000);
}

/** SHA-256 hex of a JSON value, for idempotency request hashes. */
export async function hashOf(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
