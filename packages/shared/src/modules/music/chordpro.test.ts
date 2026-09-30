import { describe, expect, it } from "vitest";
import {
  chordsOverLyricsToChordPro,
  isChord,
  looksLikeChordsOverLyrics,
  parseChart,
  transposeChart,
  transposeChord,
  transposeKey,
} from "./chordpro.ts";

describe("chords", () => {
  it("recognises chord names and not words", () => {
    for (const c of ["C", "Am", "F#m7b5", "Dsus4", "G/B", "Cadd9", "Bbmaj7", "E7(#9)", "C#m", "Ab"])
      expect(isChord(c), c).toBe(true);
    for (const w of ["Hello", "and", "Chorus", "I", "the", "Amazing"]) expect(isChord(w), w).toBe(false);
  });

  it("transposes chords, bass notes and keys, spelling flats in flat keys", () => {
    expect(transposeChord("G", 2)).toBe("A");
    expect(transposeChord("Em7", 2)).toBe("F#m7");
    expect(transposeChord("D/F#", 2)).toBe("E/G#");
    expect(transposeChord("C", -2, "Bb")).toBe("Bb");
    expect(transposeChord("F", 1, "F#")).toBe("F#");
    expect(transposeChord("Am", 12)).toBe("Am");
    expect(transposeKey("G", 3)).toBe("Bb");
    expect(transposeKey("Am", 1)).toBe("Bbm");
    expect(transposeKey("E", -1)).toBe("Eb");
    expect(transposeKey("C", 1)).toBe("Db");
    expect(transposeKey("C", 6)).toBe("F#");
  });
});

describe("parseChart", () => {
  it("reads chords in brackets, sections and comments", () => {
    const lines = parseChart(
      "{title: Test}\n{c: Intro}\n[G]Hello [C]wor[D]ld\n\n[Chorus]\nVerse 2:\nno chords\n{soc}\n",
    );
    expect(lines).toEqual([
      { type: "comment", text: "Intro" },
      {
        type: "lyric",
        parts: [
          { chord: "G", text: "Hello " },
          { chord: "C", text: "wor" },
          { chord: "D", text: "ld" },
        ],
      },
      { type: "blank" },
      { type: "section", text: "Chorus" },
      { type: "section", text: "Verse 2" },
      { type: "lyric", parts: [{ chord: null, text: "no chords" }] },
      { type: "section", text: "Chorus" },
    ]);
  });

  it("keeps text before the first chord and chords with no lyric", () => {
    expect(parseChart("Oh [Am]yes [F] [G]")[0]).toEqual({
      type: "lyric",
      parts: [
        { chord: null, text: "Oh " },
        { chord: "Am", text: "yes " },
        { chord: "F", text: " " },
        { chord: "G", text: "" },
      ],
    });
  });

  it("transposes a whole chart", () => {
    const [line] = transposeChart(parseChart("[G]Hi [D/F#]there"), 2);
    expect(line).toEqual({
      type: "lyric",
      parts: [
        { chord: "A", text: "Hi " },
        { chord: "E/G#", text: "there" },
      ],
    });
  });
});

describe("chords above the lyrics", () => {
  const pasted = [
    "Verse 1:",
    "G        C       D",
    "Test line one here",
    "",
    "Em   C",
    "",
    "Am7      D/F#",
    "Second test line",
  ].join("\n");

  it("is recognised", () => {
    expect(looksLikeChordsOverLyrics(pasted)).toBe(true);
    expect(looksLikeChordsOverLyrics("[G]Already chordpro")).toBe(false);
    expect(looksLikeChordsOverLyrics("Just lyrics\nno chords")).toBe(false);
  });

  it("turns into ChordPro at the right syllables", () => {
    expect(chordsOverLyricsToChordPro(pasted)).toBe(
      ["Verse 1:", "[G]Test line[C] one her[D]e", "", "[Em] [C]", "", "[Am7]Second te[D/F#]st line"].join(
        "\n",
      ),
    );
  });

  it("pads short lyric lines so late chords aren't lost", () => {
    expect(chordsOverLyricsToChordPro("C          G\nShort")).toBe("[C]Short      [G]");
  });
});
