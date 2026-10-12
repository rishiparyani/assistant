// One search index per person ("search:<user id>", home-first.md §4): full text over the
// records the person can see, filled by the spaces they belong to from their outbox, read on
// a query. It is a disposable copy: the owning objects are the truth and can rebuild it
// (`POST /api/search/rebuild`). Every hit is re-checked against its space before it is shown.
import { DurableObject } from "cloudflare:workers";
import { BASE_TABLES, migrate } from "../objects/storage.ts";

/** What a space sends for one record (the fields the person may see, as readable text). */
export interface SearchDoc {
  /** `${space_id}:${record_id}` */
  id: string;
  space_id: string;
  collection_id: string;
  collection: string;
  record_id: string;
  title: string;
  /** "Field: value" lines. */
  body: string;
  updated_at: string;
}

/** A hit before the space re-checked it. */
export interface SearchHit {
  space_id: string;
  collection_id: string;
  collection: string;
  record_id: string;
  title: string;
  /** The matching part of the body, with the match in [brackets]. */
  snippet: string;
  updated_at: string;
  /** Lower is better (bm25, nudged by recency). */
  rank: number;
}

const MIGRATIONS: string[] = [
  `${BASE_TABLES}
  create table docs (
    id text primary key,
    space_id text not null,
    collection_id text not null,
    collection text not null,
    record_id text not null,
    title text not null,
    body text not null,
    updated_at text not null
  );
  create index docs_space_idx on docs (space_id);
  `,
  // Search by meaning: one embedding per document (float32 blob), compared here.
  `
  create table vecs (
    doc_id text primary key,
    dims integer not null,
    vec blob not null
  );
  `,
];

/** A hit as the SQL returns it (a plain row type, as the SQL binding wants). */
type HitRow = {
  space_id: string;
  collection_id: string;
  collection: string;
  record_id: string;
  title: string;
  updated_at: string;
  body: string;
  snippet: string;
  rank: number;
};

/** How many trigrams a query needs before the typo-tolerant tokenizer is any use. */
const MIN_QUERY = 2;
const MAX_HITS = 30;

export class SearchObject extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Whether the full-text table is trigram (substrings, any case) or plain words. */
  private trigram = true;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql, MIGRATIONS);
      this.ensureFts();
    });
  }

  /** The full-text table: trigram where the runtime has it, plain words otherwise. */
  private ensureFts() {
    const have = this.sql
      .exec<{ name: string }>(`select name from sqlite_master where type = 'table' and name = 'fts'`)
      .toArray()[0];
    const kind = this.sql
      .exec<{ value: string }>(`select value from _meta where key = 'fts'`)
      .toArray()[0]?.value;
    if (have) {
      this.trigram = kind !== "words";
      return;
    }
    try {
      this.sql.exec(
        `create virtual table fts using fts5(doc_id unindexed, title, body, tokenize = 'trigram')`,
      );
      this.sql.exec(
        `insert into _meta (key, value) values ('fts', 'trigram') on conflict (key) do update set value = excluded.value`,
      );
    } catch {
      this.sql.exec(
        `create virtual table fts using fts5(doc_id unindexed, title, body, tokenize = 'unicode61')`,
      );
      this.sql.exec(
        `insert into _meta (key, value) values ('fts', 'words') on conflict (key) do update set value = excluded.value`,
      );
      this.trigram = false;
    }
  }

  /** Adds or replaces documents (a space's changed records). */
  async upsert(docs: SearchDoc[]): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      for (const d of docs) {
        this.sql.exec(`delete from fts where doc_id = ?`, d.id);
        this.sql.exec(
          `insert into docs (id, space_id, collection_id, collection, record_id, title, body, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set space_id = excluded.space_id, collection_id = excluded.collection_id,
             collection = excluded.collection, record_id = excluded.record_id, title = excluded.title,
             body = excluded.body, updated_at = excluded.updated_at`,
          d.id,
          d.space_id,
          d.collection_id,
          d.collection,
          d.record_id,
          d.title,
          d.body,
          d.updated_at,
        );
        this.sql.exec(`insert into fts (doc_id, title, body) values (?, ?, ?)`, d.id, d.title, d.body);
      }
    });
  }

  /** Keeps documents' embeddings (search by meaning); a document without one is found by words only. */
  async upsertVectors(vectors: { doc_id: string; vec: number[] }[]): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      for (const v of vectors) {
        const f = Float32Array.from(v.vec);
        this.sql.exec(
          `insert into vecs (doc_id, dims, vec) values (?, ?, ?)
           on conflict (doc_id) do update set dims = excluded.dims, vec = excluded.vec`,
          v.doc_id,
          f.length,
          f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength),
        );
      }
    });
  }

  /** Drops documents (deleted records). */
  async remove(ids: string[]): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      for (const id of ids) {
        this.sql.exec(`delete from fts where doc_id = ?`, id);
        this.sql.exec(`delete from vecs where doc_id = ?`, id);
        this.sql.exec(`delete from docs where id = ?`, id);
      }
    });
  }

  /** Drops everything from one space (the person left it, or it rebuilds). */
  async removeSpace(spaceId: string): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`delete from fts where doc_id in (select id from docs where space_id = ?)`, spaceId);
      this.sql.exec(`delete from vecs where doc_id in (select id from docs where space_id = ?)`, spaceId);
      this.sql.exec(`delete from docs where space_id = ?`, spaceId);
    });
  }

  /** The documents nearest in meaning to a query vector (cosine), best first. */
  private nearest(query: number[], limit: number): { doc_id: string; score: number }[] {
    const q = Float32Array.from(query);
    let qn = 0;
    for (const x of q) qn += x * x;
    qn = Math.sqrt(qn) || 1;
    const out: { doc_id: string; score: number }[] = [];
    for (const row of this.sql.exec<{ doc_id: string; dims: number; vec: ArrayBuffer }>(
      `select doc_id, dims, vec from vecs where dims = ?`,
      q.length,
    )) {
      const v = new Float32Array(row.vec);
      let dot = 0;
      let vn = 0;
      for (let i = 0; i < v.length; i++) {
        dot += v[i]! * q[i]!;
        vn += v[i]! * v[i]!;
      }
      const score = dot / ((Math.sqrt(vn) || 1) * qn);
      if (score > 0.2) out.push({ doc_id: row.doc_id, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * A rebuild's result under its Idempotency-Key (24 h): a retried request gets the same answer
   * instead of clearing and refilling the index again. `null`: not seen, go ahead (and the key
   * is now taken); "running": the first request is still at it.
   */
  async rebuildClaim(key: string): Promise<{ indexed: number } | "running" | null> {
    const cutoff = new Date(Date.now() - 86_400_000).toISOString();
    this.sql.exec(`delete from _meta where key like 'rebuild:%' and value < ?`, cutoff);
    const row = this.sql
      .exec<{ value: string }>(`select value from _meta where key = ?`, `rebuild:${key}`)
      .toArray()[0];
    if (row) {
      const saved = JSON.parse(row.value.slice(row.value.indexOf("|") + 1)) as { indexed: number } | null;
      return saved ?? "running";
    }
    this.sql.exec(
      `insert into _meta (key, value) values (?, ?)`,
      `rebuild:${key}`,
      `${new Date().toISOString()}|null`,
    );
    return null;
  }

  async rebuildDone(key: string, result: { indexed: number } | null): Promise<void> {
    if (result === null) this.sql.exec(`delete from _meta where key = ?`, `rebuild:${key}`);
    else
      this.sql.exec(
        `update _meta set value = ? where key = ?`,
        `${new Date().toISOString()}|${JSON.stringify(result)}`,
        `rebuild:${key}`,
      );
  }

  /** How many documents the index holds (admin and tests). */
  async count(): Promise<number> {
    return Number(this.sql.exec<{ n: number }>(`select count(*) as n from docs`).one().n);
  }

  /**
   * Hits for a query, best first: by words (full text), and by meaning when a query vector
   * is given, merged with reciprocal rank fusion (an exact word match and a close meaning
   * both count). Empty for a query too short to mean anything.
   */
  async query(text: string, limit = MAX_HITS, vector?: number[]): Promise<SearchHit[]> {
    const words = await this.byWords(text, limit);
    if (!vector?.length) return words;
    const near = this.nearest(vector, limit);
    if (!near.length) return words;
    // Reciprocal rank fusion (k = 60), words first among equals.
    const score = new Map<string, number>();
    words.forEach((h, i) =>
      score.set(
        `${h.space_id}:${h.record_id}`,
        (score.get(`${h.space_id}:${h.record_id}`) ?? 0) + 1 / (60 + i) + 1e-6,
      ),
    );
    near.forEach((n, i) => score.set(n.doc_id, (score.get(n.doc_id) ?? 0) + 1 / (60 + i)));
    const byId = new Map(words.map((h) => [`${h.space_id}:${h.record_id}`, h]));
    const missing = near.map((n) => n.doc_id).filter((id) => !byId.has(id));
    for (const id of missing) {
      const d = this.sql
        .exec<{
          space_id: string;
          collection_id: string;
          collection: string;
          record_id: string;
          title: string;
          updated_at: string;
        }>(
          `select space_id, collection_id, collection, record_id, title, updated_at from docs where id = ?`,
          id,
        )
        .toArray()[0];
      if (d) byId.set(id, { ...d, snippet: "", rank: 0 });
    }
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id]) => (byId.has(id) ? [byId.get(id)!] : []))
      .slice(0, Math.min(limit, MAX_HITS));
  }

  /** Full-text hits for a query, best first. */
  private async byWords(text: string, limit: number): Promise<SearchHit[]> {
    const q = text.trim();
    if (q.length < MIN_QUERY) return [];
    const match = this.trigram
      ? // Trigram: the phrase as typed, any case; a two-letter query falls back to a prefix scan.
        q.length >= 3
        ? `"${q.replace(/"/g, '""')}"`
        : null
      : // Words: every word as a prefix.
        q
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => `"${w.replace(/"/g, '""')}"*`)
          .join(" ");
    const rows = match
      ? this.sql
          .exec<HitRow>(
            `select d.space_id, d.collection_id, d.collection, d.record_id, d.title, d.updated_at, d.body,
                    snippet(fts, 2, '[', ']', '…', 12) as snippet, bm25(fts, 4.0, 1.0) as rank
             from fts join docs d on d.id = fts.doc_id
             where fts match ? order by rank limit ?`,
            match,
            Math.min(limit, MAX_HITS),
          )
          .toArray()
      : this.sql
          .exec<HitRow>(
            `select space_id, collection_id, collection, record_id, title, updated_at, body,
                    substr(body, 1, 80) as snippet, 0 as rank
             from docs where title like ? or body like ? order by updated_at desc limit ?`,
            `%${q}%`,
            `%${q}%`,
            Math.min(limit, MAX_HITS),
          )
          .toArray();
    const now = Date.now();
    const lower = q.toLowerCase();
    return rows
      .map(({ body: _b, ...h }) => ({
        ...h,
        // Recent things first among equals: a month old costs about one rank point.
        rank: h.rank + Math.min(3, Math.max(0, (now - Date.parse(h.updated_at)) / 2_592_000_000)),
        // The title is shown anyway: a snippet only when the match is in the body.
        snippet: h.title.toLowerCase().includes(lower) ? "" : h.snippet,
      }))
      .sort((a, b) => a.rank - b.rank);
  }
}

export const searchOf = (env: Env, userId: string) => env.SEARCH.getByName(`search:${userId}`);
