// A gig's history in plain words: who changed what, from where, before → after. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, GigHistoryView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const inDays = (d: number, hh = "19:00") =>
  `${new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10)}T${hh}`;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("gig history", () => {
  it("tells managers who changed what, in plain words, newest first; players can't see it", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    let gig = await json<BookingView>(
      await as(owner)("/gigs", {
        body: {
          title: "Test Wedding",
          fee: "15000",
          events: [{ title: "Sangeet", start_at: inDays(10), venue_name: "Test Lawns" }],
          people: [{ user_id: mate.id }],
        },
      }),
    );
    gig = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}`, {
        method: "PATCH",
        body: { version: gig.version, fee: "20000", settings: { players_see_fee: true } },
      }),
    );
    gig = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/events/${gig.events[0]!.id}`, {
        method: "PATCH",
        body: { version: gig.version, venue_name: "Test Hall" },
      }),
    );
    await as(owner)(`/gigs/${gig.id}/payments`, {
      body: { amount: "5000", method: "upi", paid_on: "2026-09-01" },
    });
    await as(mate)(`/gigs/${gig.id}/notes`, { body: { body: "Test note: sound check at 6" } });

    const h = await json<GigHistoryView>(await as(owner)(`/gigs/${gig.id}/history`));
    const lines = h.items.map((e) => [e.who, e.summary, e.source_label]);
    expect(lines).toEqual([
      ["Test Mate", "Posted a note", "app"],
      ["Test Owner", "Recorded a client payment of ₹5,000", "app"],
      ["Test Owner", "Changed Sangeet (" + h.items[2]!.summary.split("(")[1], "app"],
      ["Test Owner", "Changed the gig's details", "app"],
      ["Test Owner", "Created the gig", "app"],
    ]);
    expect(h.items[0]!.details).toEqual(["Test note: sound check at 6"]);
    expect(h.items[1]!.details[0]).toContain("UPI");
    expect(h.items[2]!.details).toEqual(["Venue: Test Lawns → Test Hall"]);
    expect(h.items[3]!.details).toEqual(["Fee: ₹15,000 → ₹20,000", "Players see the fee: on"]);
    expect(h.items[4]!.is_me).toBe(true);
    expect(h.items[0]!.is_me).toBe(false);
    expect(h.next_before).toBeNull();

    // Older entries a page at a time.
    const page = await json<GigHistoryView>(
      await as(owner)(`/gigs/${gig.id}/history?before=${h.items[2]!.id}`),
    );
    expect(page.items.map((e) => e.summary)).toEqual(["Changed the gig's details", "Created the gig"]);

    // Players don't see it (it includes money).
    expect((await as(mate)(`/gigs/${gig.id}/history`)).status).toBe(403);
  });
});
