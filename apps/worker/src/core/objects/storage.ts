// Building blocks for our Durable Objects (docs/design/gig-centric.md): each object is its
// own small SQLite database. These helpers keep every object consistent: schema
// migrations run when the object wakes, writes are idempotent and audited, and changes
// that others must hear about go through a one-row outbox.

import { ulid } from "@assistant/shared";
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

/** Who is acting and from where (web, siri, mcp, system, or a shared link such as a venue's). */
export interface Actor {
  userId: string | null;
  source: "web" | "siri" | "mcp" | "system" | "link";
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Writes one audit entry and returns its id (a ULID; "what changed" and Undo use it). */
export function audit(sql: SqlStorage, actor: Actor, entry: AuditEntry): string {
  const id = ulid();
  sql.exec(
    `insert into _audit (change_id, at, actor_user_id, source, action, entity_type, entity_id, before_json, after_json)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    nowIso(),
    actor.userId,
    actor.source,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  );
  return id;
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

// --- Backups (docs/decisions.md 2026-09-28, "Backups to Google Drive") ----------------

export type TableDump = Record<string, Record<string, SqlStorageValue>[]>;
export interface ObjectDump {
  /** The object's schema version (`_schema`); imports need the same version. */
  version: number;
  tables: TableDump;
}

/**
 * The tables worth keeping in a backup: everything the object made, plus its meta and audit
 * history; not idempotency records, the outbox or the schema row (made again on restore).
 */
export function backupTables(sql: SqlStorage): string[] {
  return sql
    .exec<{ name: string }>(
      `select name from sqlite_master where type = 'table' and name not like 'sqlite_%'
       and substr(name, 1, 4) != '_cf_' and name not in ('_idempotency', '_outbox', '_schema')
       order by name`,
    )
    .toArray()
    .map((r) => r.name);
}

/** Every row of the given tables, with the object's schema version. */
export function exportTables(sql: SqlStorage, tables: readonly string[]): ObjectDump {
  const version = Number(sql.exec(`select version from _schema`).one().version);
  const out: TableDump = {};
  for (const t of tables) out[t] = sql.exec(`select * from ${t}`).toArray();
  return { version, tables: out };
}

/**
 * Puts a dump back into an empty object. Rows are inserted as-is, inside one transaction;
 * nothing is overwritten. A dump from an older schema version is put into that version's
 * tables and then brought up to date by the later migrations, as if it had been there all
 * along; a dump from a newer version is refused.
 */
export function importTables(
  storage: DurableObjectStorage,
  dump: ObjectDump,
  tables: readonly string[],
  migrations: Migrations,
) {
  const sql = storage.sql;
  const version = Number(sql.exec(`select version from _schema`).one().version);
  if (dump.version > version || dump.version < 1)
    throw new ObjectError(
      "validation_failed",
      `Backup is from schema version ${dump.version}; this object is at ${version}`,
    );
  storage.transactionSync(() => {
    if (dump.version < version) {
      // Start again from nothing (the object is empty), up to the backup's version.
      const own = sql
        .exec<{ name: string }>(
          `select name from sqlite_master where type = 'table' and name not like 'sqlite_%'
           and substr(name, 1, 4) != '_cf_' and name != '_schema'`,
        )
        .toArray()
        .map((r) => r.name);
      for (const t of own) sql.exec(`drop table if exists ${t}`);
      sql.exec(`update _schema set version = 0`);
      migrate(sql, migrations.slice(0, dump.version));
    }
    for (const t of tables) {
      for (const row of dump.tables[t] ?? []) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        sql.exec(
          `insert or ignore into ${t} (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`,
          ...cols.map((c) => row[c] ?? null),
        );
      }
    }
    migrate(sql, migrations);
  });
}

/** Whether an object holds anything worth keeping (any row in the tables a backup takes). */
export function hasData(sql: SqlStorage): boolean {
  return backupTables(sql).some((t) => sql.exec(`select 1 from ${t} limit 1`).toArray().length > 0);
}

/**
 * Erases everything an object holds (the test-phase reset, decision 2026-10-16 "Start over
 * from a GitHub job, never from the app"): its alarm, its tables, its key-value data. The
 * instance is then thrown away (after this call answers), so nothing it kept in memory, such
 * as "tables are made", outlives the data; the next request starts it fresh and empty.
 */
export async function wipeStorage(ctx: DurableObjectState): Promise<void> {
  await ctx.storage.deleteAlarm();
  await ctx.storage.deleteAll();
  // Durable before anything else: thrown away right after a write, an object can lose the
  // write (the first real "Start over" found every erase undone, 2026-10-16).
  await ctx.storage.sync();
  // Then thrown away at once, so its next use starts fresh (its tables made again) instead of
  // from what it held in memory. The erase is already on disk, even if the answer is lost.
  setTimeout(() => {
    try {
      ctx.abort("reset");
    } catch {
      // Already gone.
    }
  }, 0);
}
