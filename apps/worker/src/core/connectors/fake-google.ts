// TESTS ONLY (CONNECTORS_FAKE=1 in the test config): a stand-in for Google, so connector
// tests never reach it. A code "fake-code-<x>" gives the refresh token "fake-refresh-<x>";
// each refresh token has its own calendar, kept in memory for the test run.
import type { GoogleApp } from "./google-app.ts";
import type { CalendarClient, CalendarEvent } from "./calendar.ts";

const calendars = new Map<string, CalendarEvent[]>();
export const revoked = new Set<string>();

export const fakeGoogle: GoogleApp = {
  configured: true,
  fake: true,
  authUrl: (o) =>
    `https://accounts.google.test/consent?${new URLSearchParams({ state: o.state, scope: o.scope })}`,
  exchange: async (code) => {
    if (!code.startsWith("fake-code-")) throw new Error("Google token request failed (400 invalid_grant)");
    return `fake-refresh-${code.slice("fake-code-".length)}`;
  },
  access: async (refresh) => {
    if (revoked.has(refresh)) throw new Error("Google token request failed (400 invalid_grant)");
    return `fake-access:${refresh}`;
  },
  revoke: async (token) => {
    revoked.add(token);
  },
};

export function fakeCalendar(access: string): CalendarClient {
  const refresh = access.replace(/^fake-access:/, "");
  const events = calendars.get(refresh) ?? [];
  calendars.set(refresh, events);
  return {
    account: async () => `${refresh.replace("fake-refresh-", "")}@example.com`,
    upcoming: async (from, to, max) =>
      events
        .filter((e) => Date.parse(e.start) >= Date.parse(from) && Date.parse(e.start) < Date.parse(to))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .slice(0, max),
    add: async (e) => {
      const ev: CalendarEvent = {
        id: `ev${events.length + 1}`,
        title: e.title,
        start: e.start,
        end: e.end ?? null,
        all_day: !!e.all_day,
        place: e.place ?? null,
        link: null,
      };
      events.push(ev);
      return ev;
    },
  };
}
