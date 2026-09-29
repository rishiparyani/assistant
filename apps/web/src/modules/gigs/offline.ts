// Saves the gigs module's screens ahead, so they open offline (docs/design/offline.md):
// Home, the upcoming gigs list, this and next month's calendar, the address book, my gig
// types, and the full page of every gig from 2 days ago to 60 days ahead (up to 40).
// Uses the same cache keys as the screens, so they find it.
import type { BookingView, ContactView, GigTypesView, HomeView, MyEventView, Page } from "@assistant/shared";
import { request } from "../../core/api.ts";
import { writeCache } from "../../core/query.svelte.ts";

const MAX_GIGS = 40;
const DAY = 86_400_000;
const get = <T>(path: string) => request<T>("GET", path, undefined, { quiet: true });
const params = (p: Record<string, string | number>) =>
  `?${new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]))}`;

async function allEvents(from: string, to: string): Promise<MyEventView[]> {
  const items: MyEventView[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await get<Page<MyEventView>>(
      `/api/me/gigs${params({ from, to, order: "asc", limit: 100, ...(cursor ? { cursor } : {}) })}`,
    );
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}

const month = (d: Date, add = 0) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1)).toISOString().slice(0, 7);

export async function saveGigsAhead() {
  const now = new Date();
  writeCache("home", await get<HomeView>("/api/me/overview"));
  writeCache(
    "gigs:upcoming:",
    await get<Page<MyEventView>>(
      `/api/me/gigs${params({ from: now.toISOString(), order: "asc", limit: 30 })}`,
    ),
  );
  for (const add of [0, 1]) {
    const m = month(new Date(now.getTime() + 330 * 60_000), add);
    writeCache(
      `gigs:calendar:${m}`,
      await allEvents(`${m}-01T00:00`, `${month(new Date(`${m}-01T00:00:00Z`), 1)}-01T00:00`),
    );
  }
  writeCache("me:gig-types", await get<GigTypesView>("/api/me/gig-types"));
  writeCache("contacts:all:", await get<ContactView[]>(`/api/me/contacts${params({ limit: 200 })}`));

  // Every gig in the window, a few at a time.
  const events = await allEvents(
    new Date(now.getTime() - 2 * DAY).toISOString(),
    new Date(now.getTime() + 60 * DAY).toISOString(),
  );
  const ids = [...new Set(events.map((e) => e.gig_id))].slice(0, MAX_GIGS);
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(
      ids
        .slice(i, i + 4)
        .map(async (id) => writeCache(`gig:${id}`, await get<BookingView>(`/api/gigs/${id}`))),
    );
  }
}
