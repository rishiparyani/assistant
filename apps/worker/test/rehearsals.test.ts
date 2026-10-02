// Rehearsals (docs/design/rehearsals.md): a gig's rehearsals, who's coming, and rehearsals
// that aren't for any gig. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  BookingView,
  HomeView,
  MyEventView,
  MyReportView,
  NotificationsView,
  Page,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const inDays = (d: number, hh = "19:00") => {
  const t = new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
  return `${t}T${hh}`;
};
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

async function setUp() {
  const owner = await signUp("Test Owner");
  const mate = await signUp("Test Mate");
  const gig = await json<BookingView>(
    await as(owner)("/gigs", {
      body: {
        title: "Test Wedding",
        status: "confirmed",
        fee: "50000",
        events: [{ start_at: inDays(10), venue_name: "Test Lawns" }],
        people: [{ user_id: mate.id }],
      },
    }),
  );
  return { owner, mate, gig };
}

describe("rehearsals for a gig", () => {
  it("adds a rehearsal to a gig; people say if they're coming; it shows on Home and in my gigs", async () => {
    const { owner, mate, gig } = await setUp();
    // The mate has the gig before the rehearsal is added (so the rehearsal is news).
    await waitFor(
      () => as(mate)("/me/gigs").then((r) => json<Page<MyEventView>>(r)),
      (p) => p.items.length === 1,
    );
    const res = await as(owner)(`/gigs/${gig.id}/events`, {
      body: { kind: "rehearsal", start_at: inDays(7, "18:00"), venue_name: "Test Studio" },
    });
    expect(res.status).toBe(201);
    const withRehearsal = await json<BookingView>(res);
    const rehearsal = withRehearsal.events.find((e) => e.kind === "rehearsal")!;
    expect(rehearsal).toMatchObject({
      venue_name: "Test Studio",
      attendance: [],
      my_going: null,
      lineup: [],
    });
    expect(withRehearsal.events.map((e) => e.kind)).toEqual(["rehearsal", "show"]);

    // The mate hears about it, and says they're coming.
    const notes = await waitFor(
      () => as(mate)("/me/notifications").then((r) => json<NotificationsView>(r)),
      (n) => n.items.some((i) => i.title === "Rehearsal for “Test Wedding”"),
    );
    expect(notes.items.find((i) => i.title === "Rehearsal for “Test Wedding”")!.body).toContain(
      "Test Studio",
    );
    const answer = (u: User, going: boolean, person_id?: string) =>
      as(u)(`/gigs/${gig.id}/events/${rehearsal.id}/attendance`, {
        method: "PUT",
        body: { going, person_id },
      });
    const mateView = await json<BookingView>(await answer(mate, true));
    const r1 = mateView.events.find((e) => e.id === rehearsal.id)!;
    expect(r1.my_going).toBe(true);
    expect(r1.attendance).toEqual([expect.objectContaining({ name: "Test Mate", going: true, is_me: true })]);
    expect(mateView.version).toBe(withRehearsal.version); // answering never blocks an edit

    // A player can't answer for someone else; a manager can.
    const ownerPerson = mateView.people.find((p) => p.name === "Test Owner")!.id;
    expect((await answer(mate, false, ownerPerson)).status).toBe(403);
    const ownerView = await json<BookingView>(await answer(owner, false));
    expect(
      ownerView.events.find((e) => e.id === rehearsal.id)!.attendance.map((a) => [a.name, a.going]),
    ).toEqual([
      ["Test Owner", false],
      ["Test Mate", true],
    ]);

    // Shows don't ask; rehearsals have no lineup.
    const show = ownerView.events.find((e) => e.kind === "show")!;
    expect(
      (
        await as(owner)(`/gigs/${gig.id}/events/${show.id}/attendance`, {
          method: "PUT",
          body: { going: true },
        })
      ).status,
    ).toBe(400);
    const lineup = await as(owner)(`/gigs/${gig.id}/events/${rehearsal.id}/lineup`, {
      method: "PUT",
      body: { version: ownerView.version, lineup: [{ person_id: ownerPerson, share: "1000" }] },
    });
    expect(lineup.status).toBe(400);

    // The mate's own lists: the rehearsal first, with their answer; Home has it too.
    const mine = await waitFor(
      () => as(mate)("/me/gigs").then((r) => json<Page<MyEventView>>(r)),
      (p) => p.items.some((e) => e.kind === "rehearsal" && e.going === true),
    );
    expect(mine.items.map((e) => [e.kind, e.going])).toEqual([
      ["rehearsal", true],
      ["show", null],
    ]);
    const onlyRehearsals = await json<Page<MyEventView>>(await as(mate)("/me/gigs?kind=rehearsal"));
    expect(onlyRehearsals.items).toHaveLength(1);
    const home = await json<HomeView>(await as(mate)("/me/overview"));
    expect(home.upcoming[0]).toMatchObject({ kind: "rehearsal", going: true, gig_title: "Test Wedding" });

    // The gig's date is still its show's (a rehearsal before it doesn't move it).
    const report = await json<MyReportView>(
      await as(owner)(`/me/report?from=${inDays(-1).slice(0, 10)}&to=${inDays(30).slice(0, 10)}`),
    );
    expect(report.gigs.map((g) => g.first_start_at.slice(0, 10))).toEqual([
      new Date(Date.parse(`${inDays(10)}:00+05:30`)).toISOString().slice(0, 10),
    ]);

    // The last show can't be removed (the gig would be only rehearsals); the rehearsal can.
    expect((await as(owner)(`/gigs/${gig.id}/events/${show.id}`, { method: "DELETE" })).status).toBe(409);
    const removed = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/events/${rehearsal.id}`, { method: "DELETE" }),
    );
    expect(removed.events.map((e) => e.kind)).toEqual(["show"]);
  });

  it("refuses a gig made of rehearsals only", async () => {
    const owner = await signUp("Test Owner");
    const res = await as(owner)("/gigs", {
      body: { title: "Test Gig", events: [{ kind: "rehearsal", start_at: inDays(3) }] },
    });
    expect(res.status).toBe(400);
  });
});

describe("rehearsals not for a gig", () => {
  it("makes a rehearsal of its own: on, no money, only rehearsals, left out of reports", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const res = await as(owner)("/gigs", {
      body: {
        kind: "rehearsal",
        title: "Test Band jam",
        collective: "Test Band",
        events: [{ start_at: inDays(2, "17:00"), venue_name: "Test Studio" }],
        people: [{ user_id: mate.id }],
      },
    });
    expect(res.status).toBe(201);
    const r = await json<BookingView>(res);
    expect(r).toMatchObject({ kind: "rehearsal", status: "confirmed", client: null });
    expect(r.events.map((e) => e.kind)).toEqual(["rehearsal"]);
    // Another date is a rehearsal too, even if asked for a show.
    const more = await json<BookingView>(
      await as(owner)(`/gigs/${r.id}/events`, { body: { start_at: inDays(9, "17:00") } }),
    );
    expect(more.events.map((e) => e.kind)).toEqual(["rehearsal", "rehearsal"]);
    // No client or fee.
    const fee = await as(owner)(`/gigs/${r.id}`, {
      method: "PATCH",
      body: { version: more.version, fee: "1000" },
    });
    expect(fee.status).toBe(400);
    expect(
      (
        await as(owner)("/gigs", {
          body: { kind: "rehearsal", title: "Paid?", fee: "10", events: [{ start_at: inDays(3) }] },
        })
      ).status,
    ).toBe(400);

    // No money at all, and it's never "played" (cancel and reopen work).
    for (const [path, body] of [
      ["payments", { amount: "100", method: "cash" }],
      ["expenses", { category: "Rehearsal", amount: "100", spent_on: inDays(0).slice(0, 10) }],
      ["payouts", { person_id: r.people[0]!.id, amount: "100", method: "cash" }],
    ] as const)
      expect((await as(owner)(`/gigs/${r.id}/${path}`, { body })).status).toBe(400);
    expect((await as(owner)(`/gigs/${r.id}/status`, { body: { action: "complete" } })).status).toBe(409);
    const cancelled = await json<BookingView>(
      await as(owner)(`/gigs/${r.id}/status`, { body: { action: "cancel" } }),
    );
    expect(cancelled.status).toBe("cancelled");
    const reopened = await json<BookingView>(
      await as(owner)(`/gigs/${r.id}/status`, { body: { action: "reopen" } }),
    );
    expect(reopened.status).toBe("confirmed");

    const home = await waitFor(
      () => as(mate)("/me/overview").then((x) => json<HomeView>(x)),
      (h) => h.upcoming.length === 2,
    );
    expect(home.upcoming.map((e) => e.kind)).toEqual(["rehearsal", "rehearsal"]);
    expect(home.this_month.gigs).toBe(0);
    const report = await json<MyReportView>(
      await as(owner)(`/me/report?from=${inDays(-1).slice(0, 10)}&to=${inDays(30).slice(0, 10)}`),
    );
    expect(report.gigs).toHaveLength(0);
  });
});
