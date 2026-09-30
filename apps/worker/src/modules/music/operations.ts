// The music module's operations: each is a REST route and an AI tool (docs/modules.md).
import { z } from "zod";
import { CreateSongInput, FindSongsInput, SongRef, UpdateSongInput } from "@assistant/shared";
import { defineOperation } from "../../core/operations.ts";
import * as s from "./services/songs.ts";

export const musicOperations = [
  defineOperation({
    id: "music.find_songs",
    tool: "find_songs",
    description:
      "Search my song library by part of the title or artist (all songs if q is left out). Returns title, artist, key and tempo; get_song has the chord chart.",
    kind: "read",
    http: { method: "GET", path: "/songs" },
    input: FindSongsInput,
    handler: (ctx, input) => s.findSongs(ctx, input),
  }),
  defineOperation({
    id: "music.get_song",
    tool: "get_song",
    description: "One song from my library with its notes and chord chart (ChordPro).",
    kind: "read",
    http: { method: "GET", path: "/songs/:song_id" },
    input: SongRef,
    handler: (ctx, input) => s.getSong(ctx, input.song_id),
  }),
  defineOperation({
    id: "music.all_songs",
    tool: "all_songs",
    description: "Every song in my library with its chart (used to save the library for offline use).",
    kind: "read",
    sessionOnly: true,
    http: { method: "GET", path: "/songs-all" },
    input: z.object({}),
    handler: (ctx) => s.allSongs(ctx),
  }),
  defineOperation({
    id: "music.create_song",
    tool: "create_song",
    description:
      "Add a song to my library: title, and optionally artist, key (e.g. G, Bb, Am), tempo, capo, notes and a chord chart in ChordPro ('[G]Hello [C]world').",
    kind: "write",
    http: { method: "POST", path: "/songs", status: 201 },
    input: CreateSongInput,
    handler: (ctx, input) => s.createSong(ctx, input),
  }),
  defineOperation({
    id: "music.update_song",
    tool: "update_song",
    description: "Change a song in my library (only the fields given; empty text clears a field).",
    kind: "write",
    http: { method: "PATCH", path: "/songs/:song_id" },
    input: UpdateSongInput,
    handler: (ctx, input) => s.updateSong(ctx, input),
  }),
  defineOperation({
    id: "music.remove_song",
    tool: "remove_song",
    description: "Remove a song from my library.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/songs/:song_id" },
    input: SongRef,
    handler: (ctx, input) => s.removeSong(ctx, input.song_id),
  }),
];
