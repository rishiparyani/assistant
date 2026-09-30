// Chord charts (docs/design/music.md): reading ChordPro, turning pasted "chords above the
// lyrics" into ChordPro, and transposing chords. Plain functions, used by the web app and
// the server alike.

/** One line of a chart, ready to show. */
export type ChartLine =
  | { type: "lyric"; parts: { chord: string | null; text: string }[] }
  | { type: "section"; text: string }
  | { type: "comment"; text: string }
  | { type: "blank" };

const CHORD =
  /^[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add|M)?[0-9]*(?:(?:maj|sus|add|b|#|\+|-|°|ø)?[0-9]*)*(?:\([^)\s]{1,8}\))?(?:\/[A-G](?:#|b)?)?$/;

/** Whether a word is a chord name (C, Am7, F#m7b5, Dsus4, G/B, Cadd9, E7(#9)). */
export const isChord = (word: string) => word.length <= 14 && CHORD.test(word);

const SECTION_WORDS =
  /^(intro|verse|pre[- ]?chorus|chorus|bridge|interlude|solo|outro|instrumental|tag|refrain|hook|coda|break|breakdown|ending)\b/i;

/** Reads a ChordPro chart into lines. Unknown {directives} are skipped. */
export function parseChart(text: string): ChartLine[] {
  const out: ChartLine[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      out.push({ type: "blank" });
      continue;
    }
    const directive = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(line);
    if (directive) {
      const [, name, value] = directive;
      const n = name!.toLowerCase();
      if (n === "c" || n === "comment" || n === "ci" || n === "comment_italic")
        out.push({ type: "comment", text: value ?? "" });
      else if (n === "soc" || n === "start_of_chorus") out.push({ type: "section", text: value || "Chorus" });
      else if (n === "sov" || n === "start_of_verse") out.push({ type: "section", text: value || "Verse" });
      else if (n === "sob" || n === "start_of_bridge") out.push({ type: "section", text: value || "Bridge" });
      continue; // title, artist, key, end_of_* and others: shown elsewhere or not needed
    }
    // "[Chorus]" or "Verse 2:" on a line of its own is a section label, not a chord.
    const bracketed = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (bracketed && !isChord(bracketed[1]!.trim()) && SECTION_WORDS.test(bracketed[1]!.trim())) {
      out.push({ type: "section", text: bracketed[1]!.trim() });
      continue;
    }
    if (/^\s*[A-Za-z][A-Za-z -]*\d*\s*:\s*$/.test(line) && SECTION_WORDS.test(line.trim())) {
      out.push({ type: "section", text: line.trim().replace(/:$/, "") });
      continue;
    }
    const parts: { chord: string | null; text: string }[] = [];
    let chord: string | null = null;
    let text = "";
    let rest = line;
    for (;;) {
      const m = /\[([^\]]{1,20})\]/.exec(rest);
      if (!m) break;
      text += rest.slice(0, m.index);
      if (chord !== null || text) parts.push({ chord, text });
      chord = m[1]!.trim();
      text = "";
      rest = rest.slice(m.index + m[0].length);
    }
    text += rest;
    parts.push({ chord, text });
    out.push({ type: "lyric", parts });
  }
  // Trim blank lines at both ends.
  while (out[0]?.type === "blank") out.shift();
  while (out.at(-1)?.type === "blank") out.pop();
  return out;
}

/** A line made only of chords (and bar marks): the "chords above the lyrics" style. */
function chordLine(line: string): boolean {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((w) => w && !/^[|/x\d.-]+$/.test(w));
  return words.length > 0 && words.every(isChord);
}

/**
 * Turns charts written with chords on their own line above the lyrics (as on most chord
 * websites) into ChordPro. Lines already in ChordPro, and lines that aren't chords, are kept.
 */
export function chordsOverLyricsToChordPro(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!chordLine(line) || /\[[^\]]+\]/.test(line)) {
      out.push(line);
      continue;
    }
    const chords: { at: number; chord: string }[] = [];
    for (const m of line.matchAll(/\S+/g)) if (isChord(m[0])) chords.push({ at: m.index!, chord: m[0] });
    const next = lines[i + 1];
    if (next === undefined || !next.trim() || chordLine(next)) {
      // Chords with no lyric under them (an intro or a riff).
      out.push(chords.map((c) => `[${c.chord}]`).join(" "));
      continue;
    }
    let lyric = next.padEnd(Math.max(next.length, (chords.at(-1)?.at ?? 0) + 1));
    for (const c of [...chords].reverse()) lyric = `${lyric.slice(0, c.at)}[${c.chord}]${lyric.slice(c.at)}`;
    out.push(lyric.replace(/\s+$/, ""));
    i++;
  }
  return out.join("\n");
}

/** Whether a chart looks like chords above the lyrics (so pasting it offers to convert). */
export function looksLikeChordsOverLyrics(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return !/\[[A-G][^\]]*\]/.test(text) && lines.some(chordLine) && lines.some((l) => !chordLine(l));
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const noteIndex = (n: string) => {
  const i = SHARPS.indexOf(n);
  return i >= 0 ? i : FLATS.indexOf(n);
};
/** Keys usually written with flats (and their minors). */
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);

function moveNote(note: string, steps: number, flats: boolean): string {
  const i = noteIndex(note);
  if (i < 0) return note;
  return (flats ? FLATS : SHARPS)[(((i + steps) % 12) + 12) % 12]!;
}

/** The key `steps` semitones away (keeps minor), e.g. transposeKey("G", 2) = "A". */
export function transposeKey(key: string, steps: number): string {
  const m = /^([A-G][#b]?)(m?)$/.exec(key);
  if (!m) return key;
  const target = moveNote(m[1]!, steps, false);
  const flat = moveNote(m[1]!, steps, true);
  // Prefer the spelling musicians use for that key (Bb, not A#).
  return (FLAT_KEYS.has(flat + m[2]) ? flat : target) + m[2];
}

/** A chord `steps` semitones away, spelled to suit `toKey` (sharps or flats). */
export function transposeChord(chord: string, steps: number, toKey?: string | null): string {
  if (!steps) return chord;
  const flats = toKey ? FLAT_KEYS.has(toKey) : false;
  const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(chord);
  if (!m) return chord;
  const [, root, quality, bass] = m;
  return moveNote(root!, steps, flats) + quality + (bass ? "/" + moveNote(bass, steps, flats) : "");
}

/** Every chord in a parsed chart, transposed. */
export function transposeChart(lines: ChartLine[], steps: number, toKey?: string | null): ChartLine[] {
  if (!steps) return lines;
  return lines.map((l) =>
    l.type === "lyric"
      ? {
          ...l,
          parts: l.parts.map((p) => ({
            ...p,
            chord: p.chord ? transposeChord(p.chord, steps, toKey) : null,
          })),
        }
      : l,
  );
}
