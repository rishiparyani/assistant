// Per-collective Gigs settings: who sees the lineup, who sets it, who records payouts. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { GigMoneyView, GigView, GigsSettings, MusicianView, Page, PayoutView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type Api = (path: string, init?: Parameters<typeof call>[1]) => Promise<Response>;

async function setup() {
  const owner = await signUp("Test Owner");
  const mate = await signUp("Test Mate");
  const ws = await json<{ id: string }>(
    await call("/api/workspaces", { cookie: owner.cookie, body: { name: "Test Collective" } }),
  );
  const inv = await json<{ id: string }>(
    await call(`/api/w/${ws.id}/invitations`, { cookie: owner.cookie, body: { email: mate.email } }),
  );
  await call(`/api/invitations/${inv.id}/accept`, { cookie: mate.cookie, body: {} });
  const as =
    (cookie: string): Api =>
    (path, init = {}) =>
      call(`/api/w/${ws.id}${path}`, { cookie, ...init });
  const api = as(owner.cookie);
  const mateApi = as(mate.cookie);
  const roster = (await json<Page<MusicianView>>(await api("/musicians"))).items;
  const mateM = roster.find((m) => m.user_id === mate.id)!;
  const dep = await json<MusicianView>(await api("/musicians", { body: { name: "Test Dep" } }));
  const gig = await json<GigView>(
    await api("/gigs", { body: { title: "Test Gig", start_at: "2026-12-12T19:00", fee: "50000" } }),
  );
  await api(`/gigs/${gig.id}/lineup`, {
    method: "PUT",
    body: {
      lineup: [
        { musician_id: mateM.id, share: "15000" },
        { musician_id: dep.id, share: "10000" },
      ],
    },
  });
  const money = async (a: Api) => json<GigMoneyView>(await a(`/gigs/${gig.id}/money`));
  const settings = (body: Partial<GigsSettings>, a: Api = api) =>
    a("/settings/gigs", { method: "PATCH", body });
  return { ws, api, mateApi, mateM, dep, gig, money, settings };
}

describe("collective settings", () => {
  it("defaults: members see who plays, only owners set lineups and pay", async () => {
    const { mateApi, dep, gig, money } = await setup();
    expect(await json(await mateApi("/settings/gigs"))).toEqual({
      lineup_visible_to_members: true,
      lineup_editors: "owners",
      payout_recorders: "owners",
    });
    const m = await money(mateApi);
    expect(m.permissions).toEqual({
      can_see_lineup: true,
      can_see_lineup_amounts: false,
      can_edit_lineup: false,
      can_record_payouts: false,
    });
    expect(m.lineup.find((l) => l.musician.id === dep.id)).toMatchObject({ share: null });

    expect((await mateApi(`/gigs/${gig.id}/lineup`, { method: "PUT", body: { lineup: [] } })).status).toBe(
      403,
    );
    expect(
      (
        await mateApi(`/gigs/${gig.id}/payouts`, {
          body: { musician_id: dep.id, amount: "100", method: "upi" },
        })
      ).status,
    ).toBe(403);
    expect((await mateApi("/musicians", { body: { name: "Test New" } })).status).toBe(403);
  });

  it("only owners change settings, and changes are audited", async () => {
    const { ws, mateApi, settings } = await setup();
    expect((await settings({ lineup_editors: "everyone" }, mateApi)).status).toBe(403);
    const res = await settings({ lineup_editors: "everyone" });
    expect(await json(res)).toEqual({
      lineup_visible_to_members: true,
      lineup_editors: "everyone",
      payout_recorders: "owners",
    });
    expect((await settings({ payout_recorders: "anyone" as "everyone" })).status).toBe(400);
    const { results } = await env.DB.prepare(
      `select action from audit_log where workspace_id = ? and entity_type = 'settings'`,
    )
      .bind(ws.id)
      .all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(["update_settings"]);
  });

  it("can hide the lineup from members (they still see their own share)", async () => {
    const { mateApi, mateM, money, settings } = await setup();
    await settings({ lineup_visible_to_members: false });
    const m = await money(mateApi);
    expect(m.permissions.can_see_lineup).toBe(false);
    expect(m.lineup.map((l) => l.musician.id)).toEqual([mateM.id]);
    expect(m.lineup[0]).toMatchObject({ share: { amount_display: "₹15,000" } });
  });

  it("lets everyone set lineups when allowed (with amounts, not account links)", async () => {
    const { mateApi, mateM, dep, gig, money, settings } = await setup();
    await settings({ lineup_editors: "everyone" });
    const before = await money(mateApi);
    expect(before.permissions).toMatchObject({ can_edit_lineup: true, can_see_lineup_amounts: true });
    expect(before.lineup.find((l) => l.musician.id === dep.id)).toMatchObject({
      share: { amount_display: "₹10,000" },
    });
    expect(before.expenses).toBeNull();

    const added = await mateApi("/musicians", { body: { name: "Test Sub" } });
    expect(added.status).toBe(201);
    const sub = await json<MusicianView>(added);
    const res = await mateApi(`/gigs/${gig.id}/lineup`, {
      method: "PUT",
      body: {
        lineup: [
          { musician_id: mateM.id, share: "15000" },
          { musician_id: sub.id, share: "12000" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect((await json<GigMoneyView>(res)).lineup.map((l) => l.musician.name)).toContain("Test Sub");
    // Linking accounts and editing the roster stay with owners.
    expect((await mateApi(`/musicians/${sub.id}`, { method: "PATCH", body: { name: "X" } })).status).toBe(
      403,
    );
    // Payouts still need their own permission.
    expect(
      (
        await mateApi(`/gigs/${gig.id}/payouts`, {
          body: { musician_id: sub.id, amount: "100", method: "upi" },
        })
      ).status,
    ).toBe(403);
  });

  it("lets everyone record and correct payouts when allowed", async () => {
    const { mateApi, dep, gig, money, settings } = await setup();
    await settings({ payout_recorders: "everyone" });
    const res = await mateApi(`/gigs/${gig.id}/payouts`, {
      body: { musician_id: dep.id, amount: "4000", method: "cash" },
    });
    expect(res.status).toBe(201);
    const payout = await json<PayoutView>(res);
    expect((await mateApi(`/payouts/${payout.id}/reverse`, { body: {} })).status).toBe(201);
    const m = await money(mateApi);
    expect(m.permissions).toMatchObject({ can_record_payouts: true, can_edit_lineup: false });
    expect(m.lineup.find((l) => l.musician.id === dep.id)).toMatchObject({
      paid: { amount_paise: 0 },
      owed: { amount_display: "₹10,000" },
    });
  });
});
