// Date options on enquiries (soft blocks): held dates until the client picks; confirming
// keeps the pick and releases the rest. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, GigHistoryView, MyEventView, Page } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const inDays = (d: number, hh = "19:00") =>
  `${new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10)}T${hh}`;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("date options (holds)", () => {
  it("holds dates on an enquiry, shows them as holds, and confirming keeps the client's pick", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const res = await as(owner)("/gigs", {
      body: {
        title: "Test Corporate",
        status: "enquiry",
        events: [
          { hold: true, start_at: inDays(20), venue_name: "Test Hotel" },
          { hold: true, start_at: inDays(27), venue_name: "Test Hotel" },
        ],
        people: [{ user_id: mate.id }],
      },
    });
    expect(res.status).toBe(201);
    let gig = await json<BookingView>(res);
    expect(gig.events.map((e) => e.hold)).toEqual([true, true]);
    // One more option later; no lineup on an option.
    gig = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/events`, { body: { hold: true, start_at: inDays(34) } }),
    );
    expect(gig.events.filter((e) => e.hold)).toHaveLength(3);
    const lineup = await as(owner)(`/gigs/${gig.id}/events/${gig.events[0]!.id}/lineup`, {
      method: "PUT",
      body: { version: gig.version, lineup: [] },
    });
    expect(lineup.status).toBe(400);

    // Bandmates see the holds (so they keep the dates free).
    const mine = await waitFor(
      () => as(mate)("/me/gigs").then((r) => json<Page<MyEventView>>(r)),
      (p) => p.items.length === 3,
    );
    expect(mine.items.every((e) => e.hold && e.status === "enquiry")).toBe(true);

    // Confirming needs the pick; playing it before that is refused.
    expect((await as(owner)(`/gigs/${gig.id}/status`, { body: { action: "confirm" } })).status).toBe(400);
    expect((await as(owner)(`/gigs/${gig.id}/status`, { body: { action: "complete" } })).status).toBe(409);
    const picked = gig.events[1]!;
    const confirmed = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/status`, {
        body: { action: "confirm", keep_event_ids: [picked.id] },
      }),
    );
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.events.map((e) => [e.id, e.hold])).toEqual([[picked.id, false]]);
    const after = await waitFor(
      () => as(mate)("/me/gigs").then((r) => json<Page<MyEventView>>(r)),
      (p) => p.items.length === 1,
    );
    expect(after.items[0]).toMatchObject({ event_id: picked.id, hold: false, status: "confirmed" });

    // A confirmed gig takes no new options; the history says what was picked.
    expect(
      (await as(owner)(`/gigs/${gig.id}/events`, { body: { hold: true, start_at: inDays(40) } })).status,
    ).toBe(400);
    const h = await json<GigHistoryView>(await as(owner)(`/gigs/${gig.id}/history`));
    expect(h.items[0]!.summary).toBe("Confirmed the gig");
    expect(h.items[0]!.details[0]).toMatch(/^Client picked /);
    expect(h.items[0]!.details[1]).toMatch(/^Released .+, .+/);
  });

  it("refuses options on a confirmed gig", async () => {
    const owner = await signUp("Test Owner");
    const res = await as(owner)("/gigs", {
      body: { title: "Test Gig", status: "confirmed", events: [{ hold: true, start_at: inDays(5) }] },
    });
    expect(res.status).toBe(400);
  });
});
