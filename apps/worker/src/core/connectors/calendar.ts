// Google Calendar (decision 2026-10-12 "Connectors start with Google Calendar"): the person's
// primary calendar, events only (scope calendar.events). Reading is free; adding an event is
// always a card to tap first (the operation is confirm-first). What comes back is data.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export interface CalendarEvent {
  id: string;
  title: string;
  /** "2026-10-14T19:00:00+05:30" for a timed event, "2026-10-14" for an all-day one. */
  start: string;
  end: string | null;
  all_day: boolean;
  place: string | null;
  link: string | null;
}

export interface NewEvent {
  title: string;
  start: string;
  end?: string | null;
  all_day?: boolean;
  place?: string | null;
  notes?: string | null;
}

export interface CalendarClient {
  /** Who the calendar belongs to (the primary calendar's id is the account's email). */
  account(): Promise<string | null>;
  upcoming(fromIso: string, toIso: string, max: number): Promise<CalendarEvent[]>;
  add(e: NewEvent): Promise<CalendarEvent>;
}

type GEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
};

const toEvent = (g: GEvent): CalendarEvent => ({
  id: g.id,
  title: g.summary ?? "(no title)",
  start: g.start?.dateTime ?? g.start?.date ?? "",
  end: g.end?.dateTime ?? g.end?.date ?? null,
  all_day: !g.start?.dateTime,
  place: g.location ?? null,
  link: g.htmlLink ?? null,
});

const API = "https://www.googleapis.com/calendar/v3/calendars/primary";

export function googleCalendar(token: string, f: typeof fetch = fetch): CalendarClient {
  const auth = { authorization: `Bearer ${token}` };
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`Google Calendar ${what} failed (${res.status})`);
    return res;
  };
  return {
    async account() {
      const r = (await (await check(await f(API, { headers: auth }), "read")).json()) as { id?: string };
      return r.id ?? null;
    },
    async upcoming(fromIso, toIso, max) {
      const q = new URLSearchParams({
        timeMin: fromIso,
        timeMax: toIso,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(max),
        timeZone: "Asia/Kolkata",
      });
      const r = (await (await check(await f(`${API}/events?${q}`, { headers: auth }), "list")).json()) as {
        items?: GEvent[];
      };
      return (r.items ?? []).map(toEvent);
    },
    async add(e) {
      const day = (s: string) => s.slice(0, 10);
      const allDay = !!e.all_day || /^\d{4}-\d{2}-\d{2}$/.test(e.start);
      const endOf = (s: string) => new Date(Date.parse(s) + 60 * 60_000).toISOString();
      const body = {
        summary: e.title,
        location: e.place ?? undefined,
        description: e.notes ?? undefined,
        start: allDay ? { date: day(e.start) } : { dateTime: e.start, timeZone: "Asia/Kolkata" },
        end: allDay
          ? { date: day(e.end ?? e.start) }
          : { dateTime: e.end ?? endOf(e.start), timeZone: "Asia/Kolkata" },
      };
      const res = await check(
        await f(`${API}/events`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        "add",
      );
      return toEvent((await res.json()) as GEvent);
    },
  };
}
