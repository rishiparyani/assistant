// Time rules (docs/conventions.md): store UTC ISO strings, show Asia/Kolkata.
// India has no daylight saving, so IST is always UTC+05:30.
const IST_OFFSET_MIN = 330;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parses a date-time into a UTC ISO string. Accepts ISO 8601 with an offset
 * ("2026-12-12T13:30:00Z", "…+05:30") or a local IST time without one
 * ("2026-12-12T19:00", "2026-12-12 19:00", or a date alone = midnight IST).
 */
export function toUtcIso(input: string): string {
  const s = input.trim();
  const local = LOCAL_RE.exec(s);
  if (local) {
    const [, y, mo, d, h = "00", mi = "00", sec = "00"] = local;
    if (!isDateOnly(`${y}-${mo}-${d}`) || +h > 23 || +mi > 59 || +sec > 59) {
      throw new RangeError(`Invalid date: "${input}"`);
    }
    const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +sec) - IST_OFFSET_MIN * 60_000);
    return date.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    throw new RangeError(
      `Invalid date-time: "${input}". Use e.g. 2026-12-12T19:00 (IST) or an ISO time with offset.`,
    );
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid date-time: "${input}"`);
  return new Date(ms).toISOString();
}

/** "2026-12-12" in IST for a UTC ISO time. */
export function isoDateIST(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + IST_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 10);
}

/** Validates a date-only string (YYYY-MM-DD, a real calendar date). */
export function isDateOnly(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === value;
}

// Hand-rolled (not Intl) so every runtime prints exactly the same thing.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istParts(utcIso: string) {
  const d = new Date(Date.parse(utcIso) + IST_OFFSET_MIN * 60_000);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: "${utcIso}"`);
  return {
    day: DAYS[d.getUTCDay()]!,
    date: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()]!,
    year: d.getUTCFullYear(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** "Sat, 12 Dec 2026, 7:00 pm IST". */
export function formatDateTimeIST(utcIso: string): string {
  const p = istParts(utcIso);
  const h12 = p.hour % 12 || 12;
  const ampm = p.hour < 12 ? "am" : "pm";
  return `${p.day}, ${p.date} ${p.month} ${p.year}, ${h12}:${String(p.minute).padStart(2, "0")} ${ampm} IST`;
}

/** "Sat, 12 Dec 2026" for a calendar date (YYYY-MM-DD) or a UTC time (its IST date). */
export function formatDateIST(value: string): string {
  const p = istParts(isDateOnly(value) ? `${value}T00:00:00.000Z` : value);
  // A calendar date must not shift: read it as-is rather than converting to IST.
  if (isDateOnly(value)) {
    const d = new Date(`${value}T00:00:00.000Z`);
    return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  return `${p.day}, ${p.date} ${p.month} ${p.year}`;
}
