// R1 step 4: Home, reports and search from each person's own summaries. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, HomeView, MyEventView, MyReportView, Page } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const dayOffset = (d: number) =>
  new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
const at = (d: number, hh = "19:00") => `${dayOffset(d)}T${hh}`;
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

/** A gig the owner manages with the mate playing for `share`; `paid` already paid out. */
async function gig(
  owner: User,
  mate: User,
  o: {
    title: string;
    day: number;
    fee: number;
    share: number;
    paid?: number;
    received?: number;
    client?: string;
  },
) {
  const g = await json<BookingView>(
    await as(owner)("/gigs", {
      body: {
        title: o.title,
        fee: o.fee,
        status: "confirmed",
        client: { name: o.client ?? "Test Client" },
        events: [{ start_at: at(o.day), venue_name: "Test Venue" }],
        people: [{ user_id: mate.id }],
      },
    }),
  );
  const mateId = g.people.find((p) => p.user_id === mate.id)!.id;
  await as(owner)(`/gigs/${g.id}/events/${g.events[0]!.id}/lineup`, {
    method: "PUT",
    body: { version: g.version, lineup: [{ person_id: mateId, part: "drums", share: o.share }] },
  });
  if (o.paid)
    await as(owner)(`/gigs/${g.id}/payouts`, { body: { person_id: mateId, amount: o.paid, method: "upi" } });
  if (o.received) await as(owner)(`/gigs/${g.id}/payments`, { body: { amount: o.received, method: "bank" } });
  return g;
}

const home = async (u: User) => json<HomeView>(await as(u)("/me/overview"));

describe("Home and reports", () => {
  it("shows my next events, what's owed to me, and what I still collect and pay as a manager", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    await gig(owner, mate, {
      title: "Test Past",
      day: -3,
      fee: 50000,
      share: 10000,
      paid: 4000,
      received: 20000,
    });
    await gig(owner, mate, { title: "Test Next", day: 5, fee: 30000, share: 8000 });
    const cancelled = await gig(owner, mate, { title: "Test Called Off", day: 6, fee: 1000, share: 500 });
    await as(owner)(`/gigs/${cancelled.id}/status`, { body: { action: "cancel" } });

    const mates = await waitFor(
      () => home(mate),
      (h) => h.owed_to_me.total.amount_paise === 600_000 && h.upcoming.length === 1,
    );
    expect(mates.upcoming.map((e) => [e.gig_title, e.part, e.share.amount_display])).toEqual([
      ["Test Next", "drums", "₹8,000"],
    ]);
    expect(mates.owed_to_me.gigs.map((g) => [g.gig_title, g.amount.amount_display])).toEqual([
      ["Test Past", "₹6,000"],
    ]);
    expect(mates.to_collect.gigs).toEqual([]); // players never see the fee side

    const owners = await waitFor(
      () => home(owner),
      (h) => h.to_pay.total.amount_paise === 600_000,
    );
    expect(owners.to_collect).toMatchObject({ total: { amount_display: "₹30,000" } });
    expect(owners.to_pay.gigs.map((g) => g.gig_title)).toEqual(["Test Past"]);
    expect(owners.owed_to_me.gigs).toEqual([]); // not on the lineup myself
  });

  it("adds up only my own money in reports, by month and gig, with filters", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    await gig(owner, mate, {
      title: "Test A",
      day: -2,
      fee: 40000,
      share: 10000,
      paid: 10000,
      received: 40000,
    });
    await gig(owner, mate, { title: "Test B", day: 2, fee: 20000, share: 5000, client: "Other Client" });
    const range = `?from=${dayOffset(-40)}&to=${dayOffset(40)}`;

    const mine = await waitFor(
      async () => json<MyReportView>(await as(mate)(`/me/report${range}`)),
      (r) => r.gigs.length === 2 && r.mine.paid.amount_paise === 1_000_000,
    );
    expect(mine.mine).toMatchObject({
      gigs: 2,
      share: { amount_display: "₹15,000" },
      paid: { amount_display: "₹10,000" },
      owed: { amount_display: "₹5,000" },
    });
    expect(mine.managed).toBeNull();
    expect(mine.gigs.every((g) => g.fee === null && g.net === null)).toBe(true);
    expect(mine.by_month.reduce((n, m) => n + m.mine.gigs, 0)).toBe(2);

    const managed = await waitFor(
      async () => json<MyReportView>(await as(owner)(`/me/report${range}`)),
      (r) => r.managed?.received.amount_paise === 4_000_000,
    );
    expect(managed.managed).toMatchObject({
      gigs: 2,
      fee: { amount_display: "₹60,000" },
      received: { amount_display: "₹40,000" },
      due: { amount_display: "₹20,000" },
      shares: { amount_display: "₹15,000" },
      paid_out: { amount_display: "₹10,000" },
      net: { amount_display: "₹45,000" },
    });

    const filtered = await json<MyReportView>(await as(owner)(`/me/report${range}&client=other%20client`));
    expect(filtered.gigs.map((g) => g.gig_title)).toEqual(["Test B"]);
    expect((await as(owner)(`/me/report?from=${dayOffset(2)}&to=${dayOffset(1)}`)).status).toBe(400);
  });

  it("searches my gigs by text and status", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    await gig(owner, mate, { title: "Test Sangeet", day: 3, fee: 100, share: 0 });
    await gig(owner, mate, {
      title: "Test Club Night",
      day: 4,
      fee: 100,
      share: 0,
      client: "Test 100% Club",
    });
    const find = async (q: string) => json<Page<MyEventView>>(await as(owner)(`/me/gigs?${q}`));
    await waitFor(
      () => find(""),
      (p) => p.items.length === 2,
    );
    expect((await find("q=sangeet")).items.map((e) => e.gig_title)).toEqual(["Test Sangeet"]);
    expect((await find("q=100%25")).items.map((e) => e.gig_title)).toEqual(["Test Club Night"]);
    expect((await find("q=test%20venue")).items).toHaveLength(2);
    expect((await find("status=enquiry")).items).toHaveLength(0);
  });
});
