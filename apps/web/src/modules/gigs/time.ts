// Date/time inputs ↔ API. The API reads times without an offset as India time,
// so forms send "YYYY-MM-DDTHH:mm" as typed.
import { isoDateIST } from "@assistant/shared";

const IST_MS = 330 * 60_000;

export const todayIST = () => isoDateIST(new Date().toISOString());

/** "19:00" in India for a UTC ISO time. */
export function timeIST(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + IST_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** The calendar day after "YYYY-MM-DD". */
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" moved by n days (negative goes back). */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export const toApiLocal = (date: string, time: string) => `${date}T${time || "00:00"}`;

/** "7:00 pm" */
export function time12(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + IST_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "October 2026" for grouping lists by month. */
export function monthLabel(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + IST_MS);
  return d.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "7:00 pm – 1:00 am (next day)" for a gig's start and optional end. */
export function timeRange(startIso: string, endIso: string | null): string {
  const start = time12(startIso);
  if (!endIso) return start;
  const nextDay = isoDateIST(endIso) !== isoDateIST(startIso);
  return `${start} – ${time12(endIso)}${nextDay ? " (next day)" : ""}`;
}
