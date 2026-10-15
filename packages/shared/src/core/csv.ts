// CSV in and out (decision 2026-10-15 "Toward Excel", 3): a small RFC 4180 reader and
// writer (quotes, commas or tabs, any line ending), a guess at what kind of field a column
// is, and how a cell is read into a field the way people type it in India (12/10/2026,
// ₹1,20,000, Yes). Used by the server (imports and exports) and shown in the app.

/** At most this many rows in one import; more fails ("split the file"). */
export const MAX_IMPORT_ROWS = 5_000;
/** At most this many characters of CSV in one import (about 2 MB). */
export const MAX_IMPORT_CHARS = 2_000_000;
/** At most this many rows in one export. */
export const MAX_EXPORT_ROWS = 5_000;

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
  /** "," or "\t". */
  separator: string;
}

/**
 * Reads CSV text: the first line names the columns. Commas separate cells, or tabs when the
 * first line has tabs and no commas; a cell in double quotes may hold commas, quotes ("")
 * and new lines. A row with fewer cells than columns is padded, one with more is cut.
 */
export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const separator = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    cell = "";
    // A blank line is nothing, not a row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
      i++;
      continue;
    }
    if (c === separator) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      endRow();
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell !== "" || row.length) endRow();
  const header = rows.shift() ?? [];
  const columns = header.map((h, n) => h.trim() || `Column ${n + 1}`);
  return {
    columns,
    rows: rows.map((r) => columns.map((_, n) => (r[n] ?? "").trim())),
    separator,
  };
}

/** Writes rows as CSV (commas, CRLF, cells quoted when they need it), with the columns first. */
export function toCsv(columns: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export type GuessedType =
  "text" | "long_text" | "number" | "money" | "date" | "datetime" | "boolean" | "choice";

const DATE_DMY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const DATE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/;
const MONEY = /^-?\s*(₹|rs\.?|inr)\s*[\d,]+(\.\d{1,2})?$/i;
const NUMBER = /^-?\d+(\.\d+)?$/;
const GROUPED = /^-?\d{1,3}(,\d{2,3})+(\.\d{1,2})?$/;
const YES = new Set(["yes", "y", "true", "haan", "ha", "1"]);
const NO = new Set(["no", "n", "false", "nahi", "0"]);

/** A date typed the Indian way (12/10/2026, 12-10-2026) or the ISO way, as yyyy-mm-dd; or null. */
export function readDate(s: string): string | null {
  const t = s.trim();
  const ymd = DATE_YMD.exec(t);
  if (ymd) return t;
  const dmy = DATE_DMY.exec(t);
  if (!dmy) return null;
  const [, d, m, y] = dmy;
  const day = Number(d);
  const month = Number(m);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** What kind of field a column's values look like (empties ignored). */
export function guessType(values: string[]): GuessedType {
  const vs = values.map((v) => v.trim()).filter((v) => v !== "");
  if (!vs.length) return "text";
  const all = (test: (v: string) => boolean) => vs.every(test);
  if (all((v) => YES.has(v.toLowerCase()) || NO.has(v.toLowerCase()))) return "boolean";
  if (all((v) => NUMBER.test(v))) return "number";
  // Amounts: every cell a number, and at least one written as money (₹, Rs, or 1,20,000).
  if (all((v) => MONEY.test(v) || NUMBER.test(v) || GROUPED.test(v))) return "money";
  if (all((v) => !!readDate(v))) return "date";
  if (all((v) => DATETIME.test(v))) return "datetime";
  const distinct = new Set(vs.map((v) => v.toLowerCase()));
  if (vs.length >= 8 && distinct.size <= 12 && distinct.size < vs.length / 2 && all((v) => v.length <= 40))
    return "choice";
  if (vs.some((v) => v.length > 500)) return "long_text";
  return "text";
}

/**
 * A cell as a field's write would take it: dates the Indian way become yyyy-mm-dd, money
 * loses its ₹ and commas, yes/no words become true/false, "a; b" becomes a list for a
 * multiple choice. Empty is null. Anything else is left for the field to check.
 */
export function readCell(type: string, cell: string): unknown {
  const s = cell.trim();
  if (s === "") return null;
  switch (type) {
    case "date":
      return readDate(s) ?? s;
    case "money":
      return s.replace(/^(-?)\s*(₹|rs\.?|inr)\s*/i, "$1").replace(/,/g, "");
    case "number": {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? n : s;
    }
    case "boolean": {
      const l = s.toLowerCase();
      return YES.has(l) ? true : NO.has(l) ? false : s;
    }
    case "multi_choice":
      return s
        .split(/[;|]/)
        .map((x) => x.trim())
        .filter(Boolean);
    default:
      return s;
  }
}
