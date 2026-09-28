// R1 step 3: money on gig-centric gigs (docs/design/gig-centric.md §2.7, §3). Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { BookingView, MyEventView, Page } from "@assistant/shared";
import { personName } from "../src/modules/gigs/objects/names.ts";
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

/** A gig with a manager (owner), two players with accounts and one without. */
async function setUp(body: Record<string, unknown> = {}) {
  const owner = await signUp("Test Owner");
  const mate = await signUp("Test Mate");
  const other = await signUp("Test Other");
  const res = await as(owner)("/gigs", {
    body: {
      title: "Test Wedding",
      fee: "1,00,000",
      events: [
        { title: "Sangeet", start_at: inDays(10) },
        { title: "Reception", start_at: inDays(11) },
      ],
      people: [{ user_id: mate.id }, { user_id: other.id }, { name: "Test Dep" }],
      ...body,
    },
  });
  expect(res.status).toBe(201);
  const gig = await json<BookingView>(res);
  const person = (name: string) => gig.people.find((p) => p.name === name)!.id;
  return { owner, mate, other, gig, person };
}

describe("client payments", () => {
  it("records payments against the fee, reverses mistakes, and hides the fee from players by default", async () => {
    const { owner, mate, gig } = await setUp();
    expect(gig.money).toMatchObject({
      can_manage: true,
      fee: { amount_paise: 10_000_000, amount_display: "₹1,00,000" },
      balance: { amount_paise: 10_000_000 },
      payment_status: "unpaid",
    });

    const paid = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/payments`, {
        body: { amount: "40000", method: "upi", paid_on: "2026-09-01" },
      }),
    );
    expect(paid.money).toMatchObject({
      received: { amount_display: "₹40,000" },
      balance: { amount_display: "₹60,000" },
      payment_status: "partial",
    });
    expect(paid.version).toBe(gig.version); // money never bumps the version

    const wrong = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/payments`, { body: { amount_paise: 500_000, method: "cash" } }),
    );
    const mistake = wrong.money.payments!.at(-1)!;
    const reverse = () =>
      as(owner)(`/gigs/${gig.id}/payments/${mistake.id}/reverse`, { body: { note: "typo" } });
    const fixed = await json<BookingView>(await reverse());
    expect(fixed.money.received!.amount_display).toBe("₹40,000");
    expect(fixed.money.payments!.find((p) => p.id === mistake.id)!.reversed_by_id).toBeTruthy();
    expect((await reverse()).status).toBe(409); // already reversed

    // Players: no fee side, and no money writes.
    const seen = await json<BookingView>(await as(mate)(`/gigs/${gig.id}`));
    expect(seen.money).toMatchObject({
      can_manage: false,
      fee: null,
      payments: null,
      expenses: null,
      net: null,
    });
    expect(
      (await as(mate)(`/gigs/${gig.id}/payments`, { body: { amount: 100, method: "cash" } })).status,
    ).toBe(403);
    expect(
      (await as(owner)(`/gigs/${gig.id}/payments`, { body: { amount: 0, method: "cash" } })).status,
    ).toBe(400);

    // A manager can let players see the fee.
    await as(owner)(`/gigs/${gig.id}`, {
      method: "PATCH",
      body: { version: gig.version, settings: { players_see_fee: true } },
    });
    const now = await json<BookingView>(await as(mate)(`/gigs/${gig.id}`));
    expect(now.settings).toEqual({
      players_see_lineup: true,
      players_see_fee: true,
      players_see_shares: false,
    });
    expect(now.money.received!.amount_display).toBe("₹40,000");
  });
});

describe("lineup, payouts and expenses", () => {
  it("splits shares, pays people, and shows each player only their own money", async () => {
    const { owner, mate, other, gig, person } = await setUp();
    const [sangeet, reception] = gig.events;
    const lineup = (eventId: string, version: number, body: Record<string, unknown>) =>
      as(owner)(`/gigs/${gig.id}/events/${eventId}/lineup`, { method: "PUT", body: { version, ...body } });

    // Sangeet: equal split of ₹30,000 among three (by name and by id).
    const res = await lineup(sangeet!.id, gig.version, {
      split: "equal",
      split_total: "30000",
      lineup: [
        { person_name: "test mate", part: "drums" },
        { person_id: person("Test Other"), part: "bass" },
        { person_name: "Test Dep", part: "keys" },
      ],
    });
    expect(res.status).toBe(200);
    let view = await json<BookingView>(res);
    expect(view.events[0]!.lineup.map((l) => [l.name, l.part, l.share?.amount_paise])).toEqual([
      ["Test Mate", "drums", 1_000_000],
      ["Test Other", "bass", 1_000_000],
      ["Test Dep", "keys", 1_000_000],
    ]);

    // Reception: per-person amounts; a stale version and an unknown name are refused.
    expect((await lineup(reception!.id, gig.version, { lineup: [] })).status).toBe(409);
    const unknown = await lineup(reception!.id, view.version, { lineup: [{ person_name: "Test" }] });
    expect(unknown.status).toBe(409);
    expect((await json(unknown)).error.code).toBe("ambiguous");
    view = await json<BookingView>(
      await lineup(reception!.id, view.version, {
        lineup: [{ person_id: person("Test Mate"), part: "drums", share: 5000 }],
      }),
    );
    expect(view.money.payees!.map((p) => [p.name, p.share.amount_paise])).toEqual([
      ["Test Mate", 1_500_000],
      ["Test Other", 1_000_000],
      ["Test Dep", 1_000_000],
    ]);

    // Payouts: the mate gets ₹10,000 (then a mistaken ₹1 is reversed).
    await as(owner)(`/gigs/${gig.id}/payouts`, {
      body: { person_name: "Test Mate", amount: "10000", method: "upi", event_id: sangeet!.id },
    });
    const oops = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/payouts`, {
        body: { person_id: person("Test Mate"), amount: 1, method: "cash" },
      }),
    );
    const bad = oops.money.payees!.find((p) => p.name === "Test Mate")!.payouts.at(-1)!;
    view = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/payouts/${bad.id}/reverse`, { body: {} }),
    );
    expect(view.money.payees!.find((p) => p.name === "Test Mate")).toMatchObject({
      share: { amount_display: "₹15,000" },
      paid: { amount_display: "₹10,000" },
      owed: { amount_display: "₹5,000" },
      status: "partial",
    });

    // Expenses and the manager's totals.
    view = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/expenses`, { body: { category: "travel", amount: "2500" } }),
    );
    expect(view.money).toMatchObject({
      shares_total: { amount_display: "₹35,000" },
      expenses_total: { amount_display: "₹2,500" },
      unallocated: { amount_display: "₹65,000" },
      net: { amount_display: "₹62,500" },
    });
    const expense = view.money.expenses![0]!;
    view = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/expenses/${expense.id}`, { method: "DELETE" }),
    );
    expect(view.money.expenses).toEqual([]);

    // The mate sees who plays, but only their own share and payouts.
    const mates = await json<BookingView>(await as(mate)(`/gigs/${gig.id}`));
    expect(mates.money.mine).toMatchObject({
      name: "Test Mate",
      share: { amount_display: "₹15,000" },
      paid: { amount_display: "₹10,000" },
      owed: { amount_display: "₹5,000" },
    });
    expect(mates.money.payees).toBeNull();
    expect(mates.events[0]!.lineup.map((l) => [l.name, l.share?.amount_display ?? null])).toEqual([
      ["Test Mate", "₹10,000"],
      ["Test Other", null],
      ["Test Dep", null],
    ]);

    // Hiding the lineup: players see only their own entry and the managers.
    await as(owner)(`/gigs/${gig.id}`, {
      method: "PATCH",
      body: { version: view.version, settings: { players_see_lineup: false } },
    });
    const hidden = await json<BookingView>(await as(other)(`/gigs/${gig.id}`));
    expect(hidden.events[0]!.lineup.map((l) => l.name)).toEqual(["Test Other"]);
    expect(hidden.people.map((p) => p.name)).toEqual(["Test Owner", "Test Other"]);

    // Someone who's been paid can't be removed until the payouts are reversed.
    const removal = await as(owner)(`/gigs/${gig.id}/people/${person("Test Mate")}`, { method: "DELETE" });
    expect(removal.status).toBe(409);
    expect((await json(removal)).error.details).toMatchObject({ reason: "has_payouts" });
  });

  it("puts each person's own money in their summaries, and the gig's money in managers'", async () => {
    const { owner, mate, gig, person } = await setUp({ title: "Test Summary Gig" });
    await as(owner)(`/gigs/${gig.id}/events/${gig.events[0]!.id}/lineup`, {
      method: "PUT",
      body: {
        version: gig.version,
        lineup: [{ person_id: person("Test Mate"), part: "drums", share: 8000 }],
      },
    });
    await as(owner)(`/gigs/${gig.id}/payouts`, {
      body: { person_id: person("Test Mate"), amount: 3000, method: "cash" },
    });
    await as(owner)(`/gigs/${gig.id}/payments`, { body: { amount: 20000, method: "bank" } });

    const mateGigs = env.PEOPLE.getByName(personName(mate.id));
    const [mine] = await waitFor(
      () => mateGigs.gigs(),
      (g) => g[0]?.paid_paise === 300_000,
    );
    expect(mine).toMatchObject({
      gig_title: "Test Summary Gig",
      role: "player",
      share_paise: 800_000,
      paid_paise: 300_000,
      fee_paise: null,
      received_paise: null,
    });
    const [managed] = await waitFor(
      () => env.PEOPLE.getByName(personName(owner.id)).gigs(),
      (g) => g[0]?.received_paise === 2_000_000,
    );
    expect(managed).toMatchObject({
      fee_paise: 10_000_000,
      received_paise: 2_000_000,
      shares_total_paise: 800_000,
    });

    const events = await json<Page<MyEventView>>(await as(mate)("/me/gigs"));
    expect(events.items.map((e) => [e.event_title, e.part, e.share.amount_display])).toEqual([
      ["Sangeet", "drums", "₹8,000"],
      ["Reception", null, "₹0"],
    ]);
  });
});
