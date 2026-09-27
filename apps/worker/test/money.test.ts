import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { GigMoneyView, GigView, MusicianView, Page, PaymentView, PayoutView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type Api = (path: string, init?: Parameters<typeof call>[1]) => Promise<Response>;

/** A band with an owner and one accepted member (bandmate). */
async function bandWithMember() {
  const owner = await signUp("Test Owner");
  const mate = await signUp("Test Bandmate");
  const ws = await json<{ id: string }>(
    await call("/api/workspaces", { cookie: owner.cookie, body: { name: "Test Band" } }),
  );
  const inv = await json<{ id: string }>(
    await call(`/api/w/${ws.id}/invitations`, { cookie: owner.cookie, body: { email: mate.email } }),
  );
  await call(`/api/invitations/${inv.id}/accept`, { cookie: mate.cookie, body: {} });
  const as =
    (cookie: string): Api =>
    (path, init = {}) =>
      call(`/api/w/${ws.id}${path}`, { cookie, ...init });
  return { ws, owner, mate, api: as(owner.cookie), mateApi: as(mate.cookie) };
}

async function gig(api: Api, fee = "50000") {
  return json<GigView>(
    await api("/gigs", { body: { title: "Test Wedding", start_at: "2026-12-12T19:00", fee } }),
  );
}
const moneyOf = async (api: Api, gigId: string) => json<GigMoneyView>(await api(`/gigs/${gigId}/money`));
const pay = (api: Api, gigId: string, amount: string, extra: object = {}) =>
  api(`/gigs/${gigId}/payments`, { body: { amount, method: "upi", paid_on: "2026-12-01", ...extra } });

describe("client payments", () => {
  it("derives balance and status from payments, including corrections", async () => {
    const { ws, api } = await bandWithMember();
    const g = await gig(api);
    let m = await moneyOf(api, g.id);
    expect(m).toMatchObject({
      payment_status: "unpaid",
      received: { amount_paise: 0 },
      balance: { amount_display: "₹50,000" },
    });

    const first = await json<PaymentView>(await pay(api, g.id, "20000"));
    expect(first).toMatchObject({
      amount: { amount_display: "₹20,000" },
      paid_on_display: "Tue, 1 Dec 2026",
      method: "upi",
    });
    m = await moneyOf(api, g.id);
    expect(m).toMatchObject({ payment_status: "partial", balance: { amount_display: "₹30,000" } });

    await pay(api, g.id, "30000", { method: "cash" });
    expect((await moneyOf(api, g.id)).payment_status).toBe("paid");
    const extra = await json<PaymentView>(await pay(api, g.id, "500"));
    m = await moneyOf(api, g.id);
    expect(m).toMatchObject({
      payment_status: "overpaid",
      balance: { amount_paise: -50_000, amount_display: "-₹500" },
    });

    // The ₹500 was a mistake: reverse it (never edit).
    const reversal = await json<PaymentView>(
      await api(`/payments/${extra.id}/reverse`, { method: "POST", body: {} }),
    );
    expect(reversal).toMatchObject({ amount: { amount_paise: -50_000 }, reverses_payment_id: extra.id });
    m = await moneyOf(api, g.id);
    expect(m.payment_status).toBe("paid");
    expect(m.payments.find((p) => p.id === extra.id)?.reversed_by_payment_id).toBe(reversal.id);
    expect(m.payments).toHaveLength(4);

    expect((await api(`/payments/${extra.id}/reverse`, { method: "POST", body: {} })).status).toBe(409);
    expect((await api(`/payments/${reversal.id}/reverse`, { method: "POST", body: {} })).status).toBe(409);

    const { results } = await env.DB.prepare(
      `select action, count(*) as n from audit_log where workspace_id = ? and entity_type = 'payment' group by action order by action`,
    )
      .bind(ws.id)
      .all<{ action: string; n: number }>();
    expect(results).toEqual([
      { action: "record_payment", n: 3 },
      { action: "reverse_payment", n: 1 },
    ]);
  });

  it("rejects zero, negative or missing amounts and bad dates", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    expect((await pay(api, g.id, "0")).status).toBe(400);
    expect((await pay(api, g.id, "-100")).status).toBe(400);
    expect((await api(`/gigs/${g.id}/payments`, { body: { method: "upi" } })).status).toBe(400);
    expect((await pay(api, g.id, "100", { paid_on: "2026-02-30" })).status).toBe(400);
    expect((await pay(api, g.id, "100", { method: "gold" })).status).toBe(400);
    expect((await moneyOf(api, g.id)).payments).toEqual([]);
  });

  it("records a double-submitted payment once", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    const key = crypto.randomUUID();
    const body = { amount: "10000", method: "cash" };
    await api(`/gigs/${g.id}/payments`, { body, idempotencyKey: key });
    await api(`/gigs/${g.id}/payments`, { body, idempotencyKey: key });
    expect((await moneyOf(api, g.id)).payments).toHaveLength(1);
  });

  it("defaults the date to today in India", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    const p = await json<PaymentView>(
      await api(`/gigs/${g.id}/payments`, { body: { amount: 100, method: "cash" } }),
    );
    const todayIST = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    expect(p.paid_on).toBe(todayIST);
    expect(p.amount.amount_paise).toBe(10_000); // a number is rupees
  });
});

describe("expenses", () => {
  it("records, lists by date and deletes; net includes them", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    await api("/expenses", {
      body: { gig_id: g.id, category: "travel", amount: "2500", spent_on: "2026-12-12" },
    });
    await api("/expenses", { body: { category: "strings", amount: "800", spent_on: "2026-11-02" } });
    const dec = await json<{ items: { category: string }[] }>(
      await api("/expenses?from=2026-12-01&to=2026-12-31"),
    );
    expect(dec.items.map((e) => e.category)).toEqual(["travel"]);
    const m = await moneyOf(api, g.id);
    expect(m).toMatchObject({
      expenses_total: { amount_display: "₹2,500" },
      net: { amount_display: "₹47,500" },
    });
    const expenseId = m.expenses![0]!.id;
    expect((await api(`/expenses/${expenseId}`, { method: "DELETE" })).status).toBe(200);
    expect((await moneyOf(api, g.id)).expenses).toEqual([]);
  });
});

describe("roster, lineup and payouts", () => {
  async function roster(api: Api, names = ["Test Drums", "Test Keys", "Test Bass"]) {
    const out: MusicianView[] = [];
    for (const name of names) out.push(await json<MusicianView>(await api("/musicians", { body: { name } })));
    return out;
  }
  const setLineup = (api: Api, gigId: string, body: object) =>
    api(`/gigs/${gigId}/lineup`, { method: "PUT", body });

  it("splits a fee equally, exactly to the paisa", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    const [a, b, c] = await roster(api);
    const res = await setLineup(api, g.id, {
      split: "equal",
      lineup: [{ musician_id: a!.id, role: "drums" }, { musician_name: "test keys" }, { musician_id: c!.id }],
    });
    expect(res.status).toBe(200);
    const m = await json<GigMoneyView>(res);
    expect(m.lineup.map((l) => [l.musician.name, l.share!.amount_paise])).toEqual([
      ["Test Drums", 1_666_668],
      ["Test Keys", 1_666_666],
      ["Test Bass", 1_666_666],
    ]);
    expect(m).toMatchObject({
      unallocated: { amount_paise: 0 },
      shares_total: { amount_display: "₹50,000" },
    });
    expect(m.lineup[0]!.role).toBe("drums");
    void b;
  });

  it("supports percentages and fixed shares with a kitty left over", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    const [a, b, c] = await roster(api);
    let m = await json<GigMoneyView>(
      await setLineup(api, g.id, {
        lineup: [
          { musician_id: a!.id, percent: 50 },
          { musician_id: b!.id, percent: 25 },
          { musician_id: c!.id, percent: 25 },
        ],
      }),
    );
    expect(m.lineup.map((l) => l.share!.amount_display)).toEqual(["₹25,000", "₹12,500", "₹12,500"]);
    m = await json<GigMoneyView>(
      await setLineup(api, g.id, {
        lineup: [
          { musician_id: a!.id, share: "15000" },
          { musician_id: b!.id, share: "15000" },
        ],
      }),
    );
    expect(m).toMatchObject({
      unallocated: { amount_display: "₹20,000" },
      net: { amount_display: "₹20,000" },
    });
    expect(m.lineup).toHaveLength(2);
  });

  it("rejects duplicates, missing shares and more than 100%", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    const [a, b] = await roster(api);
    const bad = [
      {
        lineup: [
          { musician_id: a!.id, share: "1" },
          { musician_id: a!.id, share: "1" },
        ],
      },
      { lineup: [{ musician_id: a!.id }] },
      {
        lineup: [
          { musician_id: a!.id, percent: 70 },
          { musician_id: b!.id, percent: 40 },
        ],
      },
      { lineup: [{ musician_id: a!.id, percent: 10, share: "100" }] },
      { lineup: [{ musician_name: "Nobody", share: "1" }] },
    ];
    for (const body of bad)
      expect((await setLineup(api, g.id, body)).status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
  });

  it("tracks payouts and what's still owed, with corrections", async () => {
    const { api } = await bandWithMember();
    const g = await gig(api);
    const [a, b, c] = await roster(api);
    await setLineup(api, g.id, {
      lineup: [
        { musician_id: a!.id, share: "10000" },
        { musician_id: b!.id, share: "10000" },
      ],
    });
    const payout = (musician: string, amount: string) =>
      api(`/gigs/${g.id}/payouts`, { body: { musician_name: musician, amount, method: "upi" } });

    const p1 = await json<PayoutView>(await payout("Test Drums", "4000"));
    expect(p1).toMatchObject({ musician: { name: "Test Drums" }, amount: { amount_display: "₹4,000" } });
    await payout("Test Keys", "10000");
    let m = await moneyOf(api, g.id);
    expect(m.lineup.map((l) => [l.musician.name, l.owed!.amount_display, l.payout_status])).toEqual([
      ["Test Drums", "₹6,000", "partial"],
      ["Test Keys", "₹0", "paid"],
    ]);

    // Not in the lineup → can't be paid for this gig.
    expect((await payout("Test Bass", "100")).status).toBe(409);
    void c;

    const rev = await json<PayoutView>(await api(`/payouts/${p1.id}/reverse`, { method: "POST", body: {} }));
    expect(rev.amount.amount_paise).toBe(-400_000);
    m = await moneyOf(api, g.id);
    expect(m.lineup[0]).toMatchObject({ owed: { amount_display: "₹10,000" }, payout_status: "unpaid" });
    expect((await api(`/payouts/${p1.id}/reverse`, { method: "POST", body: {} })).status).toBe(409);

    // Anyone with payout history (even payouts that cancel out) stays in the lineup, so
    // that history remains visible; shares can still change.
    const drop = await setLineup(api, g.id, { lineup: [{ musician_id: b!.id, share: "10000" }] });
    expect(drop.status).toBe(409);
    expect((await json(drop)).error.message).toContain("Test Drums");
    const reshared = await json<GigMoneyView>(
      await setLineup(api, g.id, {
        lineup: [
          { musician_id: a!.id, share: "8000" },
          { musician_id: b!.id, share: "12000" },
        ],
      }),
    );
    expect(
      reshared.lineup.map((l) => [l.musician.name, l.share!.amount_display, l.owed!.amount_display]),
    ).toEqual([
      ["Test Drums", "₹8,000", "₹8,000"],
      ["Test Keys", "₹12,000", "₹2,000"],
    ]);
  });
});

describe("who sees and does what", () => {
  it("lets members record payments but not manage the band's money", async () => {
    const { api, mateApi, owner } = await bandWithMember();
    const g = await gig(api);
    const ownerPayment = await json<PaymentView>(await pay(api, g.id, "1000"));
    const matePayment = await json<PaymentView>(await pay(mateApi, g.id, "2000"));
    expect(matePayment.amount.amount_display).toBe("₹2,000");

    expect((await mateApi(`/payments/${ownerPayment.id}/reverse`, { method: "POST", body: {} })).status).toBe(
      403,
    );
    expect((await mateApi(`/payments/${matePayment.id}/reverse`, { method: "POST", body: {} })).status).toBe(
      201,
    );

    expect((await mateApi("/musicians", { body: { name: "Test X" } })).status).toBe(403);
    expect((await mateApi(`/gigs/${g.id}/lineup`, { method: "PUT", body: { lineup: [] } })).status).toBe(403);
    expect(
      (await mateApi(`/gigs/${g.id}/payouts`, { body: { musician_name: "x", amount: "1", method: "cash" } }))
        .status,
    ).toBe(403);
    expect((await mateApi("/expenses")).status).toBe(403);
    void owner;
  });

  it("shows members the fee side, who plays, and only their own share", async () => {
    const { api, mateApi, mate } = await bandWithMember();
    const g = await gig(api);
    // Joining put the bandmate on the roster, linked to their account.
    const roster = await json<Page<MusicianView>>(await api("/musicians"));
    const me = roster.items.find((m) => m.user_id === mate.id)!;
    expect(me).toBeDefined();
    const other = await json<MusicianView>(await api("/musicians", { body: { name: "Test Other" } }));
    await api(`/gigs/${g.id}/lineup`, {
      method: "PUT",
      body: {
        lineup: [
          { musician_id: me.id, share: "12000" },
          { musician_id: other.id, share: "18000" },
        ],
      },
    });
    await api("/expenses", { body: { gig_id: g.id, category: "travel", amount: "1000" } });
    await pay(api, g.id, "20000");

    const asMate = await moneyOf(mateApi, g.id);
    expect(asMate).toMatchObject({
      visibility: "own_share",
      fee: { amount_display: "₹50,000" },
      received: { amount_display: "₹20,000" },
      payment_status: "partial",
      expenses: null,
      net: null,
      unallocated: null,
    });
    // Members see who plays, but only their own amounts.
    expect(asMate.lineup).toHaveLength(2);
    expect(asMate.lineup.find((l) => l.musician.is_me)).toMatchObject({
      musician: { id: me.id, is_me: true },
      share: { amount_display: "₹12,000" },
    });
    expect(asMate.lineup.find((l) => !l.musician.is_me)).toMatchObject({
      musician: { name: "Test Other" },
      share: null,
      paid: null,
      owed: null,
      payout_status: null,
      payouts: [],
    });

    const asOwner = await moneyOf(api, g.id);
    expect(asOwner.visibility).toBe("full");
    expect(asOwner.lineup).toHaveLength(2);

    // Linking a roster entry to someone outside the workspace is refused.
    const stranger = await signUp();
    expect((await api("/musicians", { body: { name: "Test Y", user_id: stranger.id } })).status).toBe(400);
  });

  it("keeps money out of other workspaces' reach", async () => {
    const a = await bandWithMember();
    const b = await bandWithMember();
    const g = await gig(a.api);
    const p = await json<PaymentView>(await pay(a.api, g.id, "1000"));
    expect((await b.api(`/gigs/${g.id}/money`)).status).toBe(404);
    expect((await pay(b.api, g.id, "1000")).status).toBe(404);
    expect((await b.api(`/payments/${p.id}/reverse`, { method: "POST", body: {} })).status).toBe(404);
    expect((await moneyOf(a.api, g.id)).payments).toHaveLength(1);
  });
});
