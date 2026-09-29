// How people write guest lists: "Rahul +2", "Priya + 1", "Aman (+3)", one per line.
// A trailing +N becomes plus-ones; bullets and numbering from pasted lists are dropped.
export interface ParsedGuest {
  name: string;
  plus_ones: number;
}

export function parseGuest(line: string): ParsedGuest | null {
  let s = line
    .trim()
    .replace(/^([-*•·]|\d{1,3}[.)])\s*/, "")
    .trim();
  let plus = 0;
  const m = /^(.*?)[\s,]*\(?\s*\+\s*(\d{1,2})\s*\)?$/.exec(s);
  if (m && m[1]!.trim()) {
    s = m[1]!.trim();
    plus = Math.min(20, Number(m[2]));
  }
  s = s.replace(/\s+/g, " ").slice(0, 80);
  return s ? { name: s, plus_ones: plus } : null;
}

export const parseGuests = (text: string): ParsedGuest[] =>
  text
    .split(/\r?\n/)
    .map(parseGuest)
    .filter((g): g is ParsedGuest => !!g)
    .slice(0, 50);
