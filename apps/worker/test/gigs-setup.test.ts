// Gigs as a setup (chat-first step 8; universal.md §7): today's gig behaviour, built from the
// blocks with no gig code: fee, payments and balance; a status flow; "confirmed needs a show";
// players see the gig without its money and only their own payouts. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  CreatedShare,
  RecordView,
  SharedCardView,
  SharedListView,
  WorkflowView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** The Gigs setup, as the assistant would propose it (one card, one write). */
const GIGS_SETUP = {
  name: "Test gigs",
  collections: [
    {
      name: "Gigs",
      fields: [
        { name: "Title", type: "text" },
        { name: "Client", type: "text" },
        { name: "Fee", type: "money" },
        {
          name: "Status",
          type: "choice",
          options: { choices: ["Enquiry", "Confirmed", "Done", "Cancelled"] },
        },
        {
          name: "Shows",
          type: "number",
          options: {
            rollup: { via: "Events", fn: "count", where: [{ field: "Kind", op: "eq", value: "Show" }] },
          },
        },
        { name: "Paid", type: "money", options: { rollup: { via: "Payments", fn: "sum", of: "Amount" } } },
        { name: "Balance", type: "money", options: { formula: "{Fee} - {Paid}" } },
        { name: "Paid out", type: "money", options: { rollup: { via: "Payouts", fn: "sum", of: "Amount" } } },
      ],
    },
    {
      name: "Events",
      fields: [
        { name: "Title", type: "text" },
        { name: "Gig", type: "link", required: true, options: { target: "Gigs", on_delete: "cascade" } },
        { name: "Kind", type: "choice", options: { choices: ["Show", "Rehearsal", "Hold", "Released"] } },
        { name: "Starts", type: "datetime" },
      ],
    },
    {
      name: "Lineup",
      fields: [
        { name: "Role", type: "text" },
        { name: "Gig", type: "link", required: true, options: { target: "Gigs", on_delete: "cascade" } },
        { name: "Player", type: "person", required: true },
        { name: "Share", type: "money" },
      ],
    },
    {
      name: "Payments",
      fields: [
        { name: "Note", type: "text" },
        { name: "Gig", type: "link", required: true, options: { target: "Gigs", on_delete: "block" } },
        { name: "Amount", type: "money", required: true },
      ],
    },
    {
      name: "Payouts",
      fields: [
        { name: "Note", type: "text" },
        { name: "Gig", type: "link", required: true, options: { target: "Gigs", on_delete: "block" } },
        { name: "Player", type: "person", required: true },
        { name: "Amount", type: "money", required: true },
      ],
    },
  ],
  rules: [
    {
      collection: "Gigs",
      kind: "check",
      require: [{ field: "Shows", op: "gte", value: 1 }],
      only_if: [{ field: "Status", op: "in", value: ["Confirmed", "Done"] }],
      message: "A gig needs at least one show to be confirmed",
    },
    {
      collection: "Gigs",
      kind: "flow",
      field: "Status",
      moves: {
        Enquiry: ["Confirmed", "Cancelled"],
        Confirmed: ["Done", "Cancelled"],
        Cancelled: ["Enquiry"],
        Done: [],
      },
    },
  ],
  views: [{ name: "Test payouts", collection: "Payouts" }],
};

describe("gigs from the blocks", () => {
  it("keeps today's gig behaviour: money, statuses, shows, and what players see", async () => {
    const manager = await signUp("Test Manager", undefined, { lists: false });
    const made = await api(manager)("/setups", { body: GIGS_SETUP });
    expect(made.status).toBe(201);
    const add = async (collection: string, values: Record<string, unknown>) =>
      api(manager)(`/collections/${collection}/records`, { body: { values } });
    const get = async (id: string) => json<RecordView>(await api(manager)(`/records/${id}`));
    const set = (id: string, values: Record<string, unknown>) =>
      api(manager)(`/records/${id}`, { method: "PATCH", body: { values } });

    const gig = await json<RecordView>(
      await add("Gigs", { Title: "Test Wedding", Client: "Test Client", Fee: "50000", Status: "Enquiry" }),
    );

    // Confirmed needs a show: a rehearsal isn't one.
    expect((await set(gig.id, { Status: "Confirmed" })).status).toBe(400);
    const rehearsal = await json<RecordView>(
      await add("Events", { Title: "Test rehearsal", Gig: gig.id, Kind: "Rehearsal" }),
    );
    expect((await set(gig.id, { Status: "Confirmed" })).status).toBe(400);
    const show = await json<RecordView>(
      await add("Events", { Title: "Test show", Gig: gig.id, Kind: "Show", Starts: "2026-12-12T19:00" }),
    );
    expect((await get(gig.id)).named.Shows).toBe("1");
    expect((await set(gig.id, { Status: "Confirmed" })).status).toBe(200);
    // ...and keeps it: the only show can't turn into a rehearsal or go away.
    expect((await set(show.id, { Kind: "Rehearsal" })).status).toBe(400);
    expect((await api(manager)(`/records/${show.id}`, { method: "DELETE" })).status).toBe(400);
    expect((await api(manager)(`/records/${rehearsal.id}`, { method: "DELETE" })).status).toBe(200);

    // Statuses move only the allowed ways.
    expect((await set(gig.id, { Status: "Enquiry" })).status).toBe(400);

    // Payments are entries; a mistake is reversed with a negative one. Balance = Fee − Paid.
    expect((await add("Payments", { Note: "Test advance", Gig: gig.id, Amount: "20000" })).status).toBe(201);
    expect((await add("Payments", { Note: "Test typo", Gig: gig.id, Amount: "5000" })).status).toBe(201);
    expect((await add("Payments", { Note: "Test reversal", Gig: gig.id, Amount: "-5000" })).status).toBe(201);
    let now = await get(gig.id);
    expect(now.named.Paid).toBe("₹20,000");
    expect(now.named.Balance).toBe("₹30,000");

    // Players: they join the gig's card, which shows its events but no money.
    const [asha, dev] = [await signUp("Test Asha"), await signUp("Test Dev")];
    const card = await json<CreatedShare>(
      await api(manager)("/shares", {
        body: { record_id: gig.id, include: ["Events"], hide_fields: ["Fee", "Paid", "Balance", "Paid out"] },
      }),
    );
    const payouts = await json<CreatedShare>(
      await api(manager)("/shares", { body: { view: "Test payouts" } }),
    );
    for (const u of [asha, dev])
      for (const s of [card, payouts])
        expect((await api(u)("/cards/join", { body: { token: tokenOf(s.link) } })).status).toBe(200);
    const seen = await json<SharedCardView>(await api(asha)(`/cards/${card.share.id}`));
    expect(seen.record.fields.map((f) => f.name)).toEqual(["Title", "Client", "Status", "Shows"]);
    expect(seen.sections[0]!.records.map((r) => r.title)).toEqual(["Test show"]);
    expect(JSON.stringify(seen)).not.toContain("50000");

    // Each player sees only their own payouts.
    const rule = await api(manager)(`/shares/${payouts.share.id}/rules/*`, {
      method: "PUT",
      body: { filters: [{ field: "Player", op: "eq", value: "me" }] },
    });
    expect(rule.status, await rule.clone().text()).toBe(200);
    for (const [u, amount] of [
      [asha, "8000"],
      [dev, "7000"],
    ] as const)
      expect(
        (await add("Payouts", { Note: `Test ${u.name}`, Gig: gig.id, Player: u.id, Amount: amount })).status,
      ).toBe(201);
    const own = async (u: User) =>
      (await json<SharedListView>(await api(u)(`/cards/${payouts.share.id}`))).records.map((r) => r.title);
    expect(await own(asha)).toEqual(["Test Test Asha"]);
    expect(await own(dev)).toEqual(["Test Test Dev"]);
    now = await get(gig.id);
    expect(now.named["Paid out"]).toBe("₹15,000");

    // Done, and nothing moves after that.
    expect((await set(gig.id, { Status: "Done" })).status).toBe(200);
    expect((await set(gig.id, { Status: "Cancelled" })).status).toBe(400);
  });

  it("tells the lineup when a gig is confirmed and releases the other date holds", async () => {
    const manager = await signUp("Test Manager", undefined, { lists: false });
    expect((await api(manager)("/setups", { body: GIGS_SETUP })).status).toBe(201);
    const add = async (collection: string, values: Record<string, unknown>) =>
      json<RecordView>(await api(manager)(`/collections/${collection}/records`, { body: { values } }));
    const kind = async (id: string) =>
      (await json<RecordView>(await api(manager)(`/records/${id}`))).named.Kind;

    // Two players the manager knows (they joined something of theirs).
    const [asha, dev] = [await signUp("Test Asha"), await signUp("Test Dev")];
    const gig = await add("Gigs", { Title: "Test Sangeet", Fee: "40000", Status: "Enquiry" });
    const card = await json<CreatedShare>(await api(manager)("/shares", { body: { record_id: gig.id } }));
    for (const u of [asha, dev]) await api(u)("/cards/join", { body: { token: tokenOf(card.link) } });
    for (const u of [asha, dev]) await add("Lineup", { Role: "Guitar", Gig: gig.id, Player: u.id });

    // Date options are holds; the client picks one, which becomes the show.
    const [first, second, third] = [
      await add("Events", { Title: "Test option 1", Gig: gig.id, Kind: "Hold", Starts: "2026-12-10T19:00" }),
      await add("Events", { Title: "Test option 2", Gig: gig.id, Kind: "Hold", Starts: "2026-12-11T19:00" }),
      await add("Events", { Title: "Test option 3", Gig: gig.id, Kind: "Hold", Starts: "2026-12-12T19:00" }),
    ];

    const wf = await api(manager)("/workflows", {
      body: {
        name: "Test gig confirmed",
        when: { event: "changed", collection: "Gigs", field: "Status" },
        check: [{ field: "Status", op: "eq", value: "Confirmed" }],
        then: [
          { do: "notify", text: "You're on {Title}", to: ["{Lineup.Player}"] },
          {
            do: "set",
            via: "Events",
            where: [{ field: "Kind", op: "eq", value: "Hold" }],
            field: "Kind",
            value: "Released",
          },
        ],
        enabled: true,
      },
    });
    expect(wf.status).toBe(201);
    // Linked people must be a person field there; filters only fit a set on linked records.
    const bad = (then: unknown[]) =>
      api(manager)("/workflows", {
        body: { name: "Test bad", when: { event: "added", collection: "Gigs" }, then },
      });
    expect((await bad([{ do: "notify", text: "x", to: ["{Lineup.Role}"] }])).status).toBe(400);
    expect((await bad([{ do: "notify", text: "x", to: ["{Nowhere.Player}"] }])).status).toBe(400);
    expect(
      (await bad([{ do: "set", field: "Client", value: "x", where: [{ field: "Status", op: "empty" }] }]))
        .status,
    ).toBe(400);
    const words = (await json<WorkflowView>(wf)).words;
    expect(words).toContain("Tell {Lineup.Player}: “You're on {Title}”");
    expect(words).toContain("Set Kind to Released on its Events where Kind is Hold");

    await api(manager)(`/records/${second.id}`, { method: "PATCH", body: { values: { Kind: "Show" } } });
    expect(
      (
        await api(manager)(`/records/${gig.id}`, {
          method: "PATCH",
          body: { values: { Status: "Confirmed" } },
        })
      ).status,
    ).toBe(200);

    const inbox = async (u: User) =>
      (await json<{ items: { body: string | null }[] }>(await api(u)("/me/notifications"))).items;
    for (const u of [asha, dev])
      expect(await until(async () => (await inbox(u)).some((n) => n.body === "You're on Test Sangeet"))).toBe(
        true,
      );
    expect(
      await until(async () => (await kind(first.id)) === "Released" && (await kind(third.id)) === "Released"),
    ).toBe(true);
    expect(await kind(second.id)).toBe("Show");
    // The manager isn't in the lineup, so isn't told.
    expect((await inbox(manager)).some((n) => n.body === "You're on Test Sangeet")).toBe(false);
  });
});
