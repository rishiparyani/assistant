// The Me Home and roster linking (decision 2026-09-27). Fake data only.
import { describe, expect, it } from "vitest";
import type { GigView, MeResponse, MusicianView, MyHomeView, Page, WorkspaceDetail } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

async function collective(owner: User, name = "Test Collective") {
  const ws = await json<{ id: string }>(
    await call("/api/workspaces", { cookie: owner.cookie, body: { name } }),
  );
  const api =
    (user: User) =>
    (path: string, init: Parameters<typeof call>[1] = {}) =>
      call(`/api/w/${ws.id}${path}`, { cookie: user.cookie, ...init });
  return { ws, api };
}

async function join(owner: User, wsId: string, mate: User) {
  const inv = await json<{ id: string }>(
    await call(`/api/w/${wsId}/invitations`, { cookie: owner.cookie, body: { email: mate.email } }),
  );
  expect((await call(`/api/invitations/${inv.id}/accept`, { cookie: mate.cookie, body: {} })).status).toBe(
    200,
  );
}

const home = async (user: User) => json<MyHomeView>(await call("/api/me/home", { cookie: user.cookie }));
const rosterOf = async (api: (p: string) => Promise<Response>) =>
  (await json<Page<MusicianView>>(await api("/musicians"))).items;

describe("roster linking", () => {
  it("puts the creator and people who join on the roster, linked to their accounts", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const dep = await signUp("Test Dep");
    const { ws, api } = await collective(owner);
    const asOwner = api(owner);

    let roster = await rosterOf(asOwner);
    expect(roster).toMatchObject([{ name: "Test Owner", user_id: owner.id }]);

    // An entry the owner already made with the same email gets linked, not duplicated.
    await asOwner("/musicians", { body: { name: "Test Mate (drums)", email: mate.email.toUpperCase() } });
    await join(owner, ws.id, mate);
    await join(owner, ws.id, dep);
    roster = await rosterOf(asOwner);
    // The same account can't be linked twice.
    const dup = await asOwner("/musicians", { body: { name: "Test Mate again", user_id: mate.id } });
    expect(dup.status).toBe(409);
    expect(roster.map((m) => [m.name, m.user_id]).sort()).toEqual(
      [
        ["Test Dep", dep.id],
        ["Test Mate (drums)", mate.id],
        ["Test Owner", owner.id],
      ].sort(),
    );
  });
});

describe("Me Home", () => {
  it("shows only my own gigs and amounts across collectives and my personal workspace", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const { ws, api } = await collective(owner);
    const asOwner = api(owner);
    await join(owner, ws.id, mate);
    const roster = await rosterOf(asOwner);
    const ownerM = roster.find((m) => m.user_id === owner.id)!;
    const mateM = roster.find((m) => m.user_id === mate.id)!;
    const depM = await json<MusicianView>(await asOwner("/musicians", { body: { name: "Test Dep" } }));

    const newGig = async (title: string, start: string, fee = "50000", status = "confirmed") =>
      json<GigView>(await asOwner("/gigs", { body: { title, start_at: start, fee, status } }));
    const lineup = (gigId: string, entries: [string, string][]) =>
      asOwner(`/gigs/${gigId}/lineup`, {
        method: "PUT",
        body: { lineup: entries.map(([musician_id, share]) => ({ musician_id, share })) },
      });

    const played = await newGig("Test Played", at(-1));
    await lineup(played.id, [
      [ownerM.id, "20000"],
      [mateM.id, "15000"],
      [depM.id, "10000"],
    ]);
    await asOwner(`/gigs/${played.id}/payouts`, {
      body: { musician_id: mateM.id, amount: "5000", method: "upi" },
    });

    const next = await newGig("Test Next", at(3 * 24 * 60));
    await lineup(next.id, [
      [ownerM.id, "25000"],
      [mateM.id, "25000"],
    ]);
    await newGig("Test No Lineup", at(5 * 24 * 60));
    const notMine = await newGig("Test Dep Only", at(6 * 24 * 60));
    await lineup(notMine.id, [[depM.id, "5000"]]);
    const enquiry = await newGig("Test Old Enquiry", at(-2), "90000", "enquiry");
    await lineup(enquiry.id, [[mateM.id, "90000"]]);

    // The mate's own solo gig in their personal workspace.
    const me = await json<MeResponse>(await call("/api/me", { cookie: mate.cookie }));
    const personal = me.workspaces.find((w) => w.kind === "personal")!;
    const solo = await json<GigView>(
      await call(`/api/w/${personal.id}/gigs`, {
        cookie: mate.cookie,
        body: { title: "Test Solo", start_at: at(-1), fee: "8000", status: "confirmed" },
      }),
    );
    await call(`/api/w/${personal.id}/gigs/${solo.id}/payments`, {
      cookie: mate.cookie,
      body: { amount: "3000", method: "cash" },
    });

    const mateHome = await home(mate);
    expect(
      mateHome.upcoming.map((u) => [u.gig.title, u.involvement, u.my_amount?.amount_display ?? null]),
    ).toEqual([
      ["Test Next", "playing", "₹25,000"],
      ["Test No Lineup", "lineup_not_set", null],
    ]);
    expect(mateHome.upcoming[0]!.workspace).toMatchObject({
      id: ws.id,
      name: "Test Collective",
      kind: "band",
    });
    expect(mateHome.this_month).toMatchObject({
      earned: { amount_display: "₹23,000" }, // 15,000 share + 8,000 solo (the enquiry doesn't count)
      received: { amount_display: "₹8,000" }, // 5,000 payout + 3,000 client payment
      gigs: 2,
    });
    expect(mateHome.owed_to_me.total.amount_display).toBe("₹15,000");
    expect(
      mateHome.owed_to_me.by_workspace.map((w) => [w.workspace.id, w.amount.amount_display, w.count]),
    ).toEqual([
      [ws.id, "₹10,000", 1],
      [personal.id, "₹5,000", 1],
    ]);
    expect(mateHome.i_owe).toEqual({ total: { amount_paise: 0, amount_display: "₹0" }, by_workspace: [] });
    expect(mateHome.not_on_roster).toEqual([]);
    // Nothing about other people's shares anywhere in the response.
    expect(JSON.stringify(mateHome)).not.toContain("20,000");

    const ownerHome = await home(owner);
    expect(ownerHome.owed_to_me.total.amount_display).toBe("₹20,000");
    expect(ownerHome.i_owe.by_workspace).toMatchObject([
      { workspace: { id: ws.id }, amount: { amount_display: "₹20,000" }, count: 2 },
    ]);
    expect(ownerHome.upcoming.map((u) => u.gig.title)).toEqual(["Test Next", "Test No Lineup"]);

    // Once removed, the collective drops out of the mate's Home.
    const detail = await json<WorkspaceDetail>(await asOwner(""));
    const mateMember = detail.members.find((m) => m.user_id === mate.id)!;
    expect((await asOwner(`/members/${mateMember.id}`, { method: "DELETE" })).status).toBe(200);
    const after = await home(mate);
    expect(after.upcoming).toEqual([]);
    expect(after.owed_to_me.by_workspace.map((w) => w.workspace.id)).toEqual([personal.id]);
  });

  it("flags collectives where I'm not on the roster", async () => {
    const owner = await signUp("Test Owner");
    const { ws, api } = await collective(owner);
    const [entry] = await rosterOf(api(owner));
    await api(owner)(`/musicians/${entry!.id}`, { method: "DELETE" });
    expect((await home(owner)).not_on_roster).toEqual([
      { id: ws.id, name: "Test Collective", kind: "band", can_fix: true },
    ]);
  });

  it("is empty for a stranger and needs sign-in", async () => {
    const stranger = await signUp();
    const h = await home(stranger);
    expect(h).toMatchObject({
      upcoming: [],
      owed_to_me: { by_workspace: [] },
      i_owe: { by_workspace: [] },
      not_on_roster: [],
    });
    expect((await call("/api/me/home")).status).toBe(401);
  });
});
