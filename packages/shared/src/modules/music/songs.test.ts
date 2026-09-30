import { describe, expect, it } from "vitest";
import { matchesSongSearch, songWords } from "./songs.ts";

describe("song search", () => {
  it("splits titles into lower-case words without accents or punctuation", () => {
    expect(songWords("Don't Stop Me — Café Test (Live)")).toEqual([
      "don",
      "t",
      "stop",
      "me",
      "cafe",
      "test",
      "live",
    ]);
  });
  it("matches when every typed word starts a word of the title or artist", () => {
    const song = { title: "The Test Song", artist: "Test Band" };
    expect(matchesSongSearch(song, "tes ban")).toBe(true);
    expect(matchesSongSearch(song, "SONG")).toBe(true);
    expect(matchesSongSearch(song, "ong")).toBe(false);
    expect(matchesSongSearch(song, "test other")).toBe(false);
    expect(matchesSongSearch(song, "")).toBe(true);
  });
});
