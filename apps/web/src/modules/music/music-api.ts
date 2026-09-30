// Typed calls to the music module's operations (docs/design/music.md). No logic here.
import type { SongSummary, SongView } from "@assistant/shared";
import { request } from "../../core/api.ts";
import { readCache, writeCache } from "../../core/query.svelte.ts";

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

/** The whole library with charts, as saved on the device (null if never saved). */
export const savedLibrary = () => readCache<SongView[]>("songs:all") ?? null;

/** A song from the saved library, for opening it offline. */
export const savedSong = (id: string) => savedLibrary()?.find((s) => s.id === id);

/** Saves the whole library on the device, so songs and charts open offline (stage use). */
export async function saveSongsAhead() {
  const all = await musicApi.all();
  writeCache("songs:all", all);
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
