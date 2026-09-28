// Private calendar feed (T08). Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, CalendarFeedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";
import { buildIcs, escapeText, fold } from "../src/core/calendar/ics.ts";

type User = Awaited<ReturnType<typeof signUp>>;
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

/** The feed path of a link (the test worker is reached by path). */
const pathOf = (url: string) => new URL(url).pathname;

describe("ics", () => {
  it("escapes text and folds long lines", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = "DESCRIPTION:" + "é".repeat(60);
    const folded = fold(long);
    for (const line of folded.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    const ics = buildIcs("Test", [
      {
        uid: "x@assistant",
        title: "Test",
        start: "2026-12-12T13:30:00.000Z",
        end: "2026-12-12T16:30:00.000Z",
      },
    ]);
    expect(ics).toContain("DTSTART:20261212T133000Z\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("calendar feed", () => {
  it("is off until switched on, lists my gigs, and stops working when reset or off", async () => {
    const me = await signUp("Test Me");
    const mate = await signUp("Test Mate");
    const off = await json<CalendarFeedView>(await as(me)("/me/calendar"));
    expect(off.enabled).toBe(false);

    const key = crypto.randomUUID();
    const on = await json<CalendarFeedView>(await as(me)("/me/calendar", { body: {}, idempotencyKey: key }));
    expect(on.enabled).toBe(true);
    expect(on.url).toMatch(/\/api\/calendar\/cal_[A-Za-z0-9_-]+\.ics$/);
    expect(on.webcal_url!.startsWith("webcal:")).toBe(true);
    // A retry, or switching on again, gives the same link; the settings page shows it again.
    expect(
      (await json<CalendarFeedView>(await as(me)("/me/calendar", { body: {}, idempotencyKey: key }))).url,
    ).toBe(on.url);
    expect((await json<CalendarFeedView>(await as(me)("/me/calendar"))).url).toBe(on.url);

    const res = await as(me)("/gigs", {
      body: {
        title: "Test Wedding",
        status: "confirmed",
        client: { name: "Test Client, Pune" },
        fee: "50000",
        events: [
          { title: "Sangeet", start_at: "2026-12-12T19:00", venue_name: "Test Hall" },
          { start_at: "2026-12-13T19:00", end_at: "2026-12-13T23:00" },
        ],
        people: [{ user_id: mate.id }],
      },
    });
    const gig = await json<BookingView>(res);
    const feed = () => call(pathOf(on.url!)).then((r) => r.text());
    const ics = await waitFor(feed, (t) => t.includes("Test Wedding"));
    expect(ics).toContain("SUMMARY:Test Wedding: Sangeet");
    expect(ics).toContain("DTSTART:20261212T133000Z"); // 19:00 India time
    expect(ics).toContain("DTEND:20261212T163000Z"); // no end: three hours
    expect(ics).toContain("DTEND:20261213T173000Z");
    expect(ics).toContain("LOCATION:Test Hall");
    expect(ics).toContain("Client: Test Client\\, Pune");
    expect(ics).toContain(`UID:${gig.events[0]!.id}@assistant`);
    expect(ics).toContain("STATUS:CONFIRMED");
    // No money in the feed (fee was ₹50,000).
    for (const money of ["₹", "50,000", "50000", "5000000"]) expect(ics).not.toContain(money);
    const r = await call(pathOf(on.url!));
    expect(r.headers.get("content-type")).toContain("text/calendar");

    // The player's own feed has it too (their own link).
    const mateOn = await json<CalendarFeedView>(await as(mate)("/me/calendar", { body: {} }));
    expect(mateOn.url).not.toBe(on.url);
    expect(
      await waitFor(
        () => call(pathOf(mateOn.url!)).then((x) => x.text()),
        (t) => t.includes("Test Wedding"),
      ),
    ).toContain("You're playing");

    // Cancelled gigs stay, marked cancelled, so calendars remove them.
    await as(me)(`/gigs/${gig.id}/status`, { body: { action: "cancel" } });
    expect(await waitFor(feed, (t) => t.includes("STATUS:CANCELLED"))).toContain(
      "SUMMARY:Cancelled: Test Wedding",
    );

    // Reset: new link, old one is gone.
    const reset = await json<CalendarFeedView>(await as(me)("/me/calendar", { body: { reset: true } }));
    expect(reset.url).not.toBe(on.url);
    expect((await call(pathOf(on.url!))).status).toBe(404);
    expect((await call(pathOf(reset.url!))).status).toBe(200);

    // Off: link stops working.
    const offKey = crypto.randomUUID();
    expect((await as(me)("/me/calendar", { method: "DELETE", idempotencyKey: offKey })).status).toBe(200);
    expect((await call(pathOf(reset.url!))).status).toBe(404);
    expect((await json<CalendarFeedView>(await as(me)("/me/calendar"))).enabled).toBe(false);
    // A late repeat of that "off" doesn't switch off a link made since.
    const again = await json<CalendarFeedView>(await as(me)("/me/calendar", { body: {} }));
    await as(me)("/me/calendar", { method: "DELETE", idempotencyKey: offKey });
    expect((await call(pathOf(again.url!))).status).toBe(200);
  });

  it("marks enquiries tentative", async () => {
    const me = await signUp("Test Me");
    const on = await json<CalendarFeedView>(await as(me)("/me/calendar", { body: {} }));
    await as(me)("/gigs", { body: { title: "Test Maybe", events: [{ start_at: "2026-12-20T19:00" }] } });
    const ics = await waitFor(
      () => call(pathOf(on.url!)).then((r) => r.text()),
      (t) => t.includes("Test Maybe"),
    );
    expect(ics).toContain("SUMMARY:Enquiry: Test Maybe");
    expect(ics).toContain("STATUS:TENTATIVE");
  });

  it("answers 404 for made-up links and needs sign-in to manage", async () => {
    expect((await call("/api/calendar/cal_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ics")).status).toBe(
      404,
    );
    expect((await call("/api/calendar/nonsense")).status).toBe(404);
    expect((await call("/api/me/calendar")).status).toBe(401);
  });
});
