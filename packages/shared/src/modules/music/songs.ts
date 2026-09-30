// The music module (docs/design/music.md): each person's own song library. A song has its
// details and a chord chart in ChordPro ("[G]Lyrics with [C]chords", {c: comments}).
import { z } from "zod";
import { clientId, id, optionalText } from "../../core/fields.ts";

/** A key like C, F#, Bb, or a minor key like Am, C#m. */
export const songKey = z
  .string()
  .trim()
  .max(4)
  .nullish()
  .transform((v) => (v ? v : v === undefined ? undefined : null))
  .refine((v) => !v || /^[A-G][#b]?m?$/.test(v), "A key like C, F#, Bb or Am")
  .describe("Key, e.g. G, F#, Bb or Am");

const songFields = {
  title: z.string().trim().min(1).max(160),
  artist: optionalText(120),
  key: songKey,
  tempo_bpm: z.number().int().min(20).max(400).nullish().describe("Tempo in beats per minute"),
  capo: z.number().int().min(0).max(11).nullish().describe("Capo fret (0 or empty for none)"),
  notes: optionalText(4000).describe("Free notes: form, cues, who sings"),
  chart: optionalText(40000).describe(
    "Chord chart in ChordPro: chords in brackets before the syllable, e.g. '[G]Hello [C]world'; " +
      "{c: Chorus} for section labels. Chords written above the lyrics are also accepted.",
  ),
};

export const CreateSongInput = z.object({ id: clientId, ...songFields });

export const UpdateSongInput = z.object({
  song_id: id("Song"),
  title: songFields.title.optional(),
  artist: songFields.artist,
  key: songFields.key,
  tempo_bpm: songFields.tempo_bpm,
  capo: songFields.capo,
  notes: songFields.notes,
  chart: songFields.chart,
});

export const SongRef = z.object({ song_id: id("Song") });

export const FindSongsInput = z.object({
  q: z.string().trim().max(100).optional().describe("Part of the title or artist"),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** A song in lists (no chart). */
export interface SongSummary {
  id: string;
  title: string;
  artist: string | null;
  key: string | null;
  tempo_bpm: number | null;
  updated_at: string;
  /** Waiting to reach the server (made or changed offline). */
  pending?: boolean;
}

export interface SongView extends SongSummary {
  capo: number | null;
  notes: string | null;
  chart: string | null;
  created_at: string;
}

export const SONG_LIMITS = { songs: 2000 } as const;
