// A whole setup in one write (chat-first step 6): lists, links between them, rollups,
// rules and views made together, or nothing at all. Fake data only.
import { describe, expect, it } from "vitest";
import type { CollectionView, RecordView, SetupResult } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

const famJam = {
  name: "Test fam jam sign-ups",
  collections: [
    {
      name: "Sign-ups",
      fields: [
        { name: "Song", type: "link", options: { target: "Songs" } },
        { name: "Who", type: "text" },
        { name: "Instrument", type: "choice", options: { choices: ["Guitar", "Keys", "Vocals"] } },
        {
          name: "Status",
          type: "choice",
          options: { choices: ["Requested", "Selected", "Not this time"] },
        },
      ],
    },
    {
      name: "Songs",
      fields: [
        { name: "Title", type: "text" },
        { name: "Artist", type: "text" },
        { name: "Asks", type: "number", options: { rollup: { via: "Sign-ups", fn: "count" } } },
      ],
    },
  ],
  rules: [
    {
      collection: "Sign-ups",
      kind: "unique",
      fields: ["Song", "Instrument"],
      only_if: [{ field: "Status", op: "eq", value: "Selected" }],
    },
    {
      collection: "Sign-ups",
      kind: "flow",
      field: "Status",
      moves: { Requested: ["Selected", "Not this time"], Selected: ["Requested"] },
    },
  ],
  views: [
    {
      name: "Test selected",
      collection: "Sign-ups",
      filters: [{ field: "Status", op: "eq", value: "Selected" }],
    },
  ],
};

describe("setups", () => {
  it("makes lists that link to each other, with rollups, rules and views, in one go", async () => {
    const me = await signUp("Test Organizer");
    const res = await api(me)("/setups", { body: famJam, idempotencyKey: "setup-1" });
    expect(res.status).toBe(201);
    const made = await json<SetupResult>(res);
    expect(made.collections.map((c) => c.name)).toEqual(["Sign-ups", "Songs"]);
    // Fields keep the order the setup gave (Sign-ups had no plain text first, so Who is the title).
    const signups = made.collections[0]!;
    expect(signups.fields.map((f) => f.name)).toEqual(["Song", "Who", "Instrument", "Status"]);
    expect(made.rules.map((r) => r.words)).toEqual([
      "In Sign-ups, only one record when Status is Selected per Song and Instrument",
      "Status in Sign-ups moves only Requested → Selected or Not this time; Selected → Requested; Not this time → nothing",
    ]);
    expect(made.views.map((v) => v.name)).toEqual(["Test selected"]);
    // A repeat with the same key makes nothing new.
    expect((await api(me)("/setups", { body: famJam, idempotencyKey: "setup-1" })).status).toBe(201);
    const cols = await json<CollectionView[]>(await api(me)("/collections"));
    expect(cols.filter((c) => c.name === "Songs")).toHaveLength(1);

    // The link and the rollup work.
    const song = await json<RecordView>(
      await api(me)("/collections/Songs/records", { body: { values: { Title: "Test Song A" } } }),
    );
    for (const who of ["Test Dev", "Test Asha"])
      expect(
        (
          await api(me)("/collections/Sign-ups/records", {
            body: { values: { Who: who, Song: song.id, Instrument: "Guitar", Status: "Requested" } },
          })
        ).status,
      ).toBe(201);
    const again = await json<RecordView>(await api(me)(`/records/${song.id}`));
    expect(again.named).toMatchObject({ Asks: "2" });
  });

  it("makes nothing when any part is wrong", async () => {
    const me = await signUp("Test Organizer");
    const bad = {
      ...famJam,
      rules: [{ collection: "Sign-ups", kind: "unique", fields: ["Nope"] }],
    };
    const res = await api(me)("/setups", { body: bad });
    expect(res.status).toBe(400);
    const cols = await json<CollectionView[]>(await api(me)("/collections"));
    expect(cols.map((c) => c.name)).not.toContain("Songs");
    expect(cols.map((c) => c.name)).not.toContain("Sign-ups");
  });

  it("adds calculated fields in the order their parts exist", async () => {
    const me = await signUp("Test Owner");
    // A rollup of a formula on another list (invoice total of line totals).
    const res = await api(me)("/setups", {
      body: {
        name: "Test invoices",
        collections: [
          {
            name: "Invoices",
            fields: [
              { name: "Title", type: "text" },
              {
                name: "Total",
                type: "money",
                options: { rollup: { via: "Line items", fn: "sum", of: "Line total" } },
              },
            ],
          },
          {
            name: "Line items",
            fields: [
              { name: "What", type: "text" },
              { name: "Price", type: "money" },
              { name: "Qty", type: "number" },
              { name: "Line total", type: "money", options: { formula: "{Price} * {Qty}" } },
              { name: "Invoice", type: "link", options: { target: "Invoices" } },
            ],
          },
        ],
      },
    });
    expect(res.status).toBe(201);
    const inv = await json<RecordView>(
      await api(me)("/collections/Invoices/records", { body: { values: { Title: "Test invoice" } } }),
    );
    await api(me)("/collections/Line items/records", {
      body: { values: { What: "Test strings", Price: "500", Qty: 3, Invoice: inv.id } },
    });
    expect((await json<RecordView>(await api(me)(`/records/${inv.id}`))).named).toMatchObject({
      Total: "₹1,500",
    });
  });

  // One card for the whole plan (decision 2026-11-10 "A setup is one plan"): the space, the
  // lists and the workflows on them, made by one write.
  const visitors = {
    name: "Test visitor book",
    new_space: "Test front desk",
    collections: [
      {
        name: "Visitors",
        fields: [
          { name: "Who", type: "text" },
          { name: "Flat", type: "text" },
          { name: "Status", type: "choice", options: { choices: ["Waiting", "In", "Turned away"] } },
        ],
      },
    ],
    workflows: [
      {
        name: "Tell me about visitors",
        when: { event: "added", collection: "Visitors" },
        then: [{ do: "notify", text: "{Who} is at the desk for {Flat}", to: ["me"] }],
      },
    ],
  };
  type Space = { id: string; name: string };
  const spaces = async (u: User) => json<Space[]>(await api(u)("/spaces"));

  it("makes a new space, its lists and its workflows from one card, the workflow off", async () => {
    const me = await signUp("Test Desk Owner");
    const res = await api(me)("/setups", { body: visitors, idempotencyKey: "plan-1" });
    expect(res.status).toBe(201);
    const made = await json<SetupResult>(res);
    expect(made.space?.name).toBe("Test front desk");
    expect(made.workflows?.map((w) => [w.name, w.enabled])).toEqual([["Tell me about visitors", false]]);
    const desk = (await spaces(me)).find((s) => s.name === "Test front desk");
    expect(desk?.id).toBe(made.space?.id);
    // It lives in the new space, not in Personal.
    const there = await json<CollectionView[]>(await api(me)(`/collections?space=${desk!.id}`));
    expect(there.map((c) => c.name)).toContain("Visitors");
    const personal = await json<CollectionView[]>(await api(me)("/collections"));
    expect(personal.map((c) => c.name)).not.toContain("Visitors");
    const flows = await json<{ name: string }[]>(await api(me)(`/workflows?space=${desk!.id}`));
    expect(flows.map((w) => w.name)).toEqual(["Tell me about visitors"]);
  });

  it("a retry with the same key finishes in the same space instead of failing on its own name", async () => {
    const me = await signUp("Test Desk Retry");
    const first = await json<SetupResult>(
      await api(me)("/setups", { body: visitors, idempotencyKey: "plan-2" }),
    );
    const again = await api(me)("/setups", { body: visitors, idempotencyKey: "plan-2" });
    expect(again.status).toBe(201);
    expect((await json<SetupResult>(again)).space?.id).toBe(first.space?.id);
    expect((await spaces(me)).filter((s) => s.name === "Test front desk")).toHaveLength(1);
    const there = await json<CollectionView[]>(await api(me)(`/collections?space=${first.space!.id}`));
    expect(there.filter((c) => c.name === "Visitors")).toHaveLength(1);
    // A different write with the same name is told the name is taken, and makes nothing.
    const other = await api(me)("/setups", { body: visitors, idempotencyKey: "plan-3" });
    expect(other.status).toBe(409);
    expect((await spaces(me)).filter((s) => s.name === "Test front desk")).toHaveLength(1);
  });

  it("a plan with a part that can't work makes nothing, not even the space", async () => {
    const me = await signUp("Test Desk Broken");
    const before = (await spaces(me)).length;
    const res = await api(me)("/setups", {
      idempotencyKey: "plan-4",
      body: {
        ...visitors,
        workflows: [
          {
            name: "Test broken",
            when: { event: "changed", collection: "Visitors", field: "No such field" },
            then: [{ do: "notify", text: "x", to: ["me"] }],
          },
        ],
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await spaces(me)).toHaveLength(before);
    // The same key, fixed: it goes through (the space the first try took back is made again).
    const fixed = await api(me)("/setups", { body: visitors, idempotencyKey: "plan-5" });
    expect(fixed.status).toBe(201);
  });

  it("a workflow in a setup that names a list in the same setup works in a space that exists", async () => {
    const me = await signUp("Test Desk Here");
    const { new_space: _n, ...here } = visitors;
    const res = await api(me)("/setups", { body: here });
    expect(res.status).toBe(201);
    expect((await json<SetupResult>(res)).workflows).toHaveLength(1);
    // Both a space and a new one: refused.
    const both = await api(me)("/setups", { body: { ...visitors, space: "Personal" } });
    expect(both.status).toBe(400);
  });

  it("a key used again with other words never takes away the space it made before", async () => {
    // Codex on PR 234: after the setup's lists were deleted, the reused key hit a conflict and
    // the cleanup erased the space, with its recoverable lists.
    const me = await signUp("Test Desk Reuse");
    const first = await json<SetupResult>(
      await api(me)("/setups", { body: visitors, idempotencyKey: "plan-6" }),
    );
    const q = `?space=${first.space!.id}`;
    const del = await api(me)(`/collections/Visitors${q}`, {
      method: "DELETE",
      idempotencyKey: "plan-6-del",
    });
    expect(del.status).toBeLessThan(300);
    const again = await api(me)("/setups", {
      idempotencyKey: "plan-6",
      body: {
        ...visitors,
        name: "Test other words",
        collections: [{ name: "Other", fields: [] }],
        workflows: [],
      },
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect((await spaces(me)).map((s) => s.id)).toContain(first.space!.id);
  });
});
