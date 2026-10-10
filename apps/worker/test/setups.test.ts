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
});
