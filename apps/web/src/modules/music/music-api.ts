// Typed calls to the music module's operations (docs/design/music.md). No logic here.
import type { SongSummary, SongView } from "@assistant/shared";
import { request } from "../../core/api.ts";
import { getOne, replaceAll } from "../../core/device-db.ts";
import { writeCache } from "../../core/query.svelte.ts";
import { session } from "../../core/session.svelte.ts";

export interface SongFields {
  title: string;
  artist?: string | null;
  key?: string | null;
  tempo_bpm?: number | null;
  capo?: number | null;
  notes?: string | null;
  chart?: string | null;
}

const base = (id: string) => `/api/songs/${encodeURIComponent(id)}`;

export const musicApi = {
  songs: (q?: string) => request<SongSummary[]>("GET", `/api/songs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  song: (id: string) => request<SongView>("GET", base(id)),
  all: () => request<SongView[]>("GET", "/api/songs-all", undefined, { quiet: true }),
  // online-only: the library is edited at home; reading it works offline (saved ahead).
  create: (s: SongFields) => request<SongView>("POST", "/api/songs", s),
  // online-only: the library is edited at home; reading it works offline (saved ahead).
  update: (id: string, s: Partial<SongFields>) => request<SongView>("PATCH", base(id), s),
  // online-only: removing needs the server.
  remove: (id: string) => request<{ removed: true }>("DELETE", base(id)),
};

// The whole library with charts is kept in IndexedDB (it can be large); the list without
// charts goes in the ordinary cache.
const scope = () => `library:${session.me?.user.id ?? ""}`;

/** A song from the library saved on this device (undefined if not saved), for offline and stage use. */
export const savedSong = (id: string) => getOne<SongView>(scope(), id);

/** Saves the whole library on the device, so songs and charts open offline (stage use). */
export async function saveSongsAhead() {
  if (!session.me) return;
  const all = await musicApi.all();
  await replaceAll(scope(), all);
  writeCache(
    "songs:list:",
    all.map(({ id, title, artist, key, tempo_bpm, updated_at }) => ({
      id,
      title,
      artist,
      key,
      tempo_bpm,
      updated_at,
    })),
  );
}

/** "G · 96 bpm · capo 2" */
export const songFacts = (s: { key: string | null; tempo_bpm: number | null; capo?: number | null }) =>
  [s.key, s.tempo_bpm ? `${s.tempo_bpm} bpm` : null, s.capo ? `capo ${s.capo}` : null]
    .filter(Boolean)
    .join(" · ");

/** A song as stage mode shows it (`steps` transposes). */
export interface StageSong {
  title: string;
  key: string | null;
  tempo_bpm: number | null;
  capo?: number | null;
  chart: string | null;
  steps?: number;
}
