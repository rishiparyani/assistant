// Builds an iCalendar (.ics) feed (RFC 5545) from events that modules contribute.

export interface CalendarEvent {
  /** Stable across updates, so calendar apps update rather than duplicate. */
  uid: string;
  title: string;
  /** UTC ISO timestamps. */
  start: string;
  end: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  cancelled?: boolean;
  /** Not confirmed yet (e.g. a gig enquiry). */
  tentative?: boolean;
  /** Last change (UTC ISO); calendar apps use it to notice updates. */
  updated?: string | null;
}

/** 2026-12-12T13:30:00.000Z → 20261212T133000Z */
const stamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Text values escape backslash, semicolon, comma and newlines. */
export const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line after a space (UTF-8 safe). */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(name: string, events: CalendarEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gigspree//Gigs//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
    // Ask calendar apps to check hourly (Google and Apple decide for themselves).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(e.updated ?? now.toISOString())}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
    );
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.updated) lines.push(`LAST-MODIFIED:${stamp(e.updated)}`);
    lines.push(`STATUS:${e.cancelled ? "CANCELLED" : e.tentative ? "TENTATIVE" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
