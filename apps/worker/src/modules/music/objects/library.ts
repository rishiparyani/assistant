// A person's song library (docs/design/music.md): one small database per person, like
// their gigs index. Only they reach it (the service picks the object from the signed-in
// user), so no other access checks are needed here.
import { DurableObject } from "cloudflare:workers";
import { SONG_LIMITS, ulid, type SongSummary, type SongView } from "@assistant/shared";
import {
  BASE_TABLES,
  audit,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  type Actor,
  type Migrations,
} from "../../../core/objects/storage.ts";
import { ObjectError } from "../../../core/objects/errors.ts";

const MIGRATIONS: Migrations = [
  BASE_TABLES,
  `create table songs (
     id text primary key,
     title text not null,
     title_key text not null,
     artist text,
     key text,
     tempo_bpm integer,
     capo integer,
     notes text,
     chart text,
     created_at text not null,
     updated_at text not null,
     deleted_at text
   );
   create index songs_title_idx on songs (deleted_at, title_key);`,
];

type SongRow = {
  id: string;
  title: string;
  artist: string | null;
  key: string | null;
  tempo_bpm: number | null;
  capo: number | null;
  notes: string | null;
  chart: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SongFields = {
  title: string;
  artist?: string | null;
  key?: string | null;
  tempo_bpm?: number | null;
  capo?: number | null;
  notes?: string | null;
  chart?: string | null;
};

const summary = (r: SongRow): SongSummary => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  key: r.key,
  tempo_bpm: r.tempo_bpm,
  updated_at: r.updated_at,
});
const view = (r: SongRow): SongView => ({
  ...summary(r),
  capo: r.capo,
  notes: r.notes,
  chart: r.chart,
  created_at: r.created_at,
});
/** Title for sorting and search: lower case, leading "the"/"a" ignored. */
const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .trim();

export class LibraryObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  /** My songs by title; `search` matches part of the title or artist. */
  async songs(opts: { search?: string; limit?: number } = {}): Promise<SongSummary[]> {
    const limit = Math.min(opts.limit ?? SONG_LIMITS.songs, SONG_LIMITS.songs);
    const q = opts.search?.trim().toLowerCase();
    const rows = q
      ? this.sql
          .exec<SongRow>(
            `select * from songs where deleted_at is null
               and (title_key like ?1 or lower(title) like ?1 or lower(coalesce(artist, '')) like ?1)
             order by title_key limit ?2`,
            `%${q.replace(/[%_]/g, "")}%`,
            limit,
          )
          .toArray()
      : this.sql
          .exec<SongRow>(`select * from songs where deleted_at is null order by title_key limit ?`, limit)
          .toArray();
    return rows.map(summary);
  }

  async song(id: string): Promise<SongView> {
    return view(this.require(id));
  }

  /** Every song with its chart (saving the library on the device for offline use). */
  async allSongs(): Promise<SongView[]> {
    return this.sql
      .exec<SongRow>(`select * from songs where deleted_at is null order by title_key`)
      .toArray()
      .map(view);
  }

  async createSong(actor: Actor, key: string | null, input: SongFields & { id?: string }): Promise<SongView> {
    return idempotent(this.ctx.storage, key, await hashOf(["create_song", input]), () => {
      const count = this.sql
        .exec<{ n: number }>(`select count(*) as n from songs where deleted_at is null`)
        .toArray()[0]!.n;
      if (count >= SONG_LIMITS.songs)
        throw new ObjectError("validation_failed", `A library can hold at most ${SONG_LIMITS.songs} songs`);
      const id = input.id ?? ulid();
      if (input.id && this.sql.exec(`select 1 from songs where id = ?`, id).toArray().length)
        throw new ObjectError("conflict", "That id is taken", { reason: "id_taken" });
      const now = nowIso();
      this.sql.exec(
        `insert into songs (id, title, title_key, artist, key, tempo_bpm, capo, notes, chart, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.title,
        titleKey(input.title),
        input.artist ?? null,
        input.key ?? null,
        input.tempo_bpm ?? null,
        input.capo ?? null,
        input.notes ?? null,
        input.chart ?? null,
        now,
        now,
      );
      const song = view(this.require(id));
      audit(this.sql, actor, { action: "create_song", entityType: "song", entityId: id, after: song });
      return song;
    });
  }

  async updateSong(
    actor: Actor,
    key: string | null,
    songId: string,
    input: Partial<SongFields>,
  ): Promise<SongView> {
    return idempotent(this.ctx.storage, key, await hashOf(["update_song", songId, input]), () => {
      const before = this.require(songId);
      const next = { ...before };
      for (const f of ["title", "artist", "key", "tempo_bpm", "capo", "notes", "chart"] as const)
        if (input[f] !== undefined) (next as Record<string, unknown>)[f] = input[f];
      this.sql.exec(
        `update songs set title = ?, title_key = ?, artist = ?, key = ?, tempo_bpm = ?, capo = ?, notes = ?, chart = ?,
           updated_at = ? where id = ?`,
        next.title,
        titleKey(next.title),
        next.artist,
        next.key,
        next.tempo_bpm,
        next.capo,
        next.notes,
        next.chart,
        nowIso(),
        songId,
      );
      const song = view(this.require(songId));
      audit(this.sql, actor, {
        action: "update_song",
        entityType: "song",
        entityId: songId,
        before: view(before),
        after: song,
      });
      return song;
    });
  }

  async removeSong(actor: Actor, key: string | null, songId: string): Promise<{ removed: true }> {
    return idempotent(this.ctx.storage, key, await hashOf(["remove_song", songId]), () => {
      const before = this.require(songId);
      this.sql.exec(`update songs set deleted_at = ? where id = ?`, nowIso(), songId);
      audit(this.sql, actor, {
        action: "remove_song",
        entityType: "song",
        entityId: songId,
        before: view(before),
      });
      return { removed: true as const };
    });
  }

  // --- Backups (core/backup): the whole library, and putting it back ---------------------

  async exportAll(): Promise<SongRow[]> {
    return this.sql.exec<SongRow>(`select * from songs`).toArray();
  }

  /** Restores into an empty library only (a restore never overwrites songs). */
  async importAll(rows: SongRow[]): Promise<number> {
    if (this.sql.exec(`select 1 from songs limit 1`).toArray().length) return 0;
    this.ctx.storage.transactionSync(() => {
      for (const r of rows)
        this.sql.exec(
          `insert into songs (id, title, title_key, artist, key, tempo_bpm, capo, notes, chart, created_at, updated_at, deleted_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.id,
          r.title,
          titleKey(r.title),
          r.artist,
          r.key,
          r.tempo_bpm,
          r.capo,
          r.notes,
          r.chart,
          r.created_at,
          r.updated_at,
          r.deleted_at,
        );
    });
    return rows.length;
  }

  private require(id: string): SongRow {
    const row = this.sql
      .exec<SongRow>(`select * from songs where id = ? and deleted_at is null`, id)
      .toArray()[0];
    if (!row) throw new ObjectError("not_found", "No such song");
    return row;
  }
}
