// The universal engine (docs/design/universal.md): spaces, collections, typed fields,
// records, links, filters, the name resolver and the change log. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  ChangesView,
  CollectionView,
  FindResult,
  OpenedView,
  RecordView,
  SavedView,
  SpaceView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("spaces and the starter setup", () => {
  it("gives every person a Personal space with notes, reminders, events and expenses", async () => {
    const me = await signUp("Test Owner");
    const spaces = await json<SpaceView[]>(await api(me)("/spaces"));
    expect(spaces).toEqual([expect.objectContaining({ name: "Personal", kind: "personal", role: "owner" })]);
    // Asking twice doesn't make a second one.
    expect(await json<SpaceView[]>(await api(me)("/spaces"))).toHaveLength(1);
    const cols = await json<CollectionView[]>(await api(me)("/collections"));
    expect(cols.map((c) => c.name)).toEqual(["Notes", "Reminders", "Events", "Expenses"]);
    const expenses = cols.find((c) => c.name === "Expenses")!;
    expect(expenses.fields.map((f) => [f.name, f.type])).toEqual([
      ["What", "text"],
      ["Amount", "money"],
      ["Date", "date"],
      ["Category", "choice"],
      ["Paid with", "choice"],
      ["For", "link"],
    ]);
  });
});

describe("records", () => {
  it("adds, reads, finds and sorts by typed values", async () => {
    const me = await signUp("Test Owner");
    const add = (values: Record<string, unknown>) =>
      api(me)("/collections/Expenses/records", { body: { values } });
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const res = await add({ What: "Test groceries", Amount: "₹450", Category: "groceries", Date: today });
    expect(res.status).toBe(201);
    const r = await json<RecordView>(res);
    expect(r.title).toBe("Test groceries");
    expect(r.named).toMatchObject({ Amount: "₹450", Category: "Groceries", Date: today, For: null });
    await add({ What: "Test cab", Amount: 1200, Category: "Travel", Date: today });
    await add({ What: "Test strings", Amount: "₹600", Category: "Gear", Date: "2025-01-05" });

    const find = (body: Record<string, unknown>) =>
      api(me)("/collections/expenses/find", { body }).then((x) => json<FindResult>(x));
    const thisMonth = await find({
      filters: [{ field: "date", op: "period", value: "this_month" }],
      sort: { field: "Amount", dir: "desc" },
    });
    expect(thisMonth.items.map((i) => i.title)).toEqual(["Test cab", "Test groceries"]);
    const gear = await find({ filters: [{ field: "Category", op: "eq", value: "gear" }] });
    expect(gear.items.map((i) => i.title)).toEqual(["Test strings"]);
    const big = await find({ filters: [{ field: "Amount", op: "gte", value: 500 }] });
    expect(big.items.map((i) => i.title).sort()).toEqual(["Test cab", "Test strings"]);
    const words = await find({ search: "groc" });
    expect(words.items.map((i) => i.title)).toEqual(["Test groceries"]);

    // Update with a version check; stale versions are refused.
    const upd = await api(me)(`/records/${r.id}`, {
      method: "PATCH",
      body: { values: { Amount: "500" }, version: r.version },
    });
    expect((await json<RecordView>(upd)).named.Amount).toBe("₹500");
    const stale = await api(me)(`/records/${r.id}`, {
      method: "PATCH",
      body: { values: { Amount: "600" }, version: r.version },
    });
    expect(stale.status).toBe(409);
  });

  it("refuses unknown fields and bad values with the real names", async () => {
    const me = await signUp("Test Owner");
    const bad = await api(me)("/collections/Expenses/records", {
      body: { values: { What: "Test", Amount: 10, Colour: "red" } },
    });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.message).toMatch(/No field "Colour"\. Fields: What, Amount, Date/);
    const choice = await api(me)("/collections/Expenses/records", {
      body: { values: { What: "Test", Amount: 10, Category: "Fuel" } },
    });
    expect((await json(choice)).error.message).toMatch(/isn't a choice/);
    const missing = await api(me)("/collections/Expenses/records", { body: { values: { What: "Test" } } });
    expect((await json(missing)).error.message).toBe("Amount is required");
    const noCol = await api(me)("/collections/Gigz/find", { body: {} });
    expect(noCol.status).toBe(404);
    expect((await json(noCol)).error.message).toMatch(/Collections: Notes, Reminders, Events, Expenses/);
  });

  it("is idempotent per key", async () => {
    const me = await signUp("Test Owner");
    const once = () =>
      api(me)("/collections/Notes/records", {
        body: { values: { Title: "Test note" } },
        idempotencyKey: "k-1",
      });
    const a = await json<RecordView>(await once());
    const b = await json<RecordView>(await once());
    expect(b.id).toBe(a.id);
  });
});

describe("collections and links", () => {
  it("links records both ways, by id or exact title, and asks when a title is ambiguous", async () => {
    const me = await signUp("Test Owner");
    const make = (body: unknown) => api(me)("/collections", { body });
    expect(
      (
        await make({
          name: "Gigs",
          fields: [
            { name: "Title", type: "text" },
            { name: "Fee", type: "money" },
          ],
        })
      ).status,
    ).toBe(201);
    const reh = await json<CollectionView>(
      await make({
        name: "Rehearsals",
        fields: [
          { name: "Title", type: "text" },
          { name: "Gig", type: "link", options: { target: "Gigs", on_delete: "cascade" } },
        ],
      }),
    );
    expect(reh.fields[1]!.options).toMatchObject({ many: false, on_delete: "cascade" });
    const gigs = await json<CollectionView>(await api(me)("/collections/Gigs"));
    expect(gigs.linked_from).toEqual([expect.objectContaining({ collection: "Rehearsals", field: "Gig" })]);

    const gig = await json<RecordView>(
      await api(me)("/collections/Gigs/records", {
        body: { values: { Title: "Test Sunburn", Fee: "50000" } },
      }),
    );
    const r1 = await json<RecordView>(
      await api(me)("/collections/Rehearsals/records", {
        body: { values: { Title: "Test run-through", Gig: "test sunburn" } },
      }),
    );
    expect(r1.links[reh.fields[1]!.id]).toEqual([
      { id: gig.id, collection_id: gigs.id, title: "Test Sunburn" },
    ]);
    expect(r1.named.Gig).toEqual(["Test Sunburn"]);

    // A second gig with the same title: names become ambiguous; ids still work.
    const gig2 = await json<RecordView>(
      await api(me)("/collections/Gigs/records", { body: { values: { Title: "Test Sunburn" } } }),
    );
    const amb = await api(me)("/collections/Rehearsals/records", {
      body: { values: { Title: "Test second", Gig: "Test Sunburn" } },
    });
    expect(amb.status).toBe(409);
    expect((await json(amb)).error.details.candidates).toHaveLength(2);
    await api(me)("/collections/Rehearsals/records", {
      body: { values: { Title: "Test second", Gig: gig2.id } },
    });

    const forGig = await json<FindResult>(
      await api(me)("/collections/Rehearsals/find", {
        body: { filters: [{ field: "Gig", op: "eq", value: gig.id }] },
      }),
    );
    expect(forGig.items.map((i) => i.title)).toEqual(["Test run-through"]);

    // Deleting the gig cascades to its rehearsals.
    const del = await json<{ deleted: string[] }>(await api(me)(`/records/${gig.id}`, { method: "DELETE" }));
    expect(del.deleted).toEqual([gig.id, r1.id]);
    expect((await api(me)(`/records/${r1.id}`)).status).toBe(404);
  });

  it("blocks deleting a record that's still linked when the link says so", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Songs", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections", {
      body: {
        name: "Set lists",
        fields: [
          { name: "Title", type: "text" },
          {
            name: "Songs",
            type: "link",
            options: { target: "Songs", many: true, ordered: true, on_delete: "block" },
          },
        ],
      },
    });
    const song = await json<RecordView>(
      await api(me)("/collections/Songs/records", { body: { values: { Title: "Test Song" } } }),
    );
    const other = await json<RecordView>(
      await api(me)("/collections/Songs/records", { body: { values: { Title: "Test Other" } } }),
    );
    const set = await json<RecordView>(
      await api(me)("/collections/Set lists/records", {
        body: { values: { Title: "Test Set", Songs: [song.id] } },
      }),
    );
    // Ordered links: put another song first.
    const linked = await json<RecordView>(
      await api(me)(`/records/${set.id}/links`, {
        body: { field: "Songs", to: ["Test Other"], after: null },
      }),
    );
    expect(linked.named.Songs).toEqual(["Test Other", "Test Song"]);
    const blocked = await api(me)(`/records/${song.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    await api(me)(`/records/${set.id}/unlink`, { body: { field: "Songs", to: [song.id] } });
    expect((await api(me)(`/records/${song.id}`, { method: "DELETE" })).status).toBe(200);
    expect(other.id).toBeTruthy();
  });

  it("renames fields safely, keeps aliases, and hides removed fields", async () => {
    const me = await signUp("Test Owner");
    const r = await json<RecordView>(
      await api(me)("/collections/Notes/records", { body: { values: { Title: "Test", Body: "Hello" } } }),
    );
    const renamed = await json<CollectionView>(
      await api(me)("/collections/Notes/fields/Body", {
        method: "PATCH",
        body: { name: "Text", aliases: ["content"] },
      }),
    );
    expect(renamed.fields.map((f) => f.name)).toEqual(["Title", "Text", "Pinned"]);
    // The old value is still there under the new name; the alias works for writes.
    const got = await json<RecordView>(await api(me)(`/records/${r.id}`));
    expect(got.named.Text).toBe("Hello");
    await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { content: "Hi" } } });
    expect((await json<RecordView>(await api(me)(`/records/${r.id}`))).named.Text).toBe("Hi");
    expect((await api(me)("/collections/Notes/fields/Title", { method: "DELETE" })).status).toBe(409);
    const hidden = await json<CollectionView>(
      await api(me)("/collections/Notes/fields/Pinned", { method: "DELETE" }),
    );
    expect(hidden.fields.map((f) => f.name)).toEqual(["Title", "Text"]);
  });
});

describe("guards", () => {
  it("finds text anywhere in long values", async () => {
    const me = await signUp("Test Owner");
    const body = `${"x ".repeat(400)}Test needle`;
    await api(me)("/collections/Notes/records", { body: { values: { Title: "Test long", Body: body } } });
    const found = await json<FindResult>(
      await api(me)("/collections/Notes/find", {
        body: { filters: [{ field: "Body", op: "contains", value: "NEEDLE" }] },
      }),
    );
    expect(found.items.map((i) => i.title)).toEqual(["Test long"]);
  });

  it("requires required links, on add and on clearing", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Jams", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections", {
      body: {
        name: "Sign-ups",
        fields: [
          { name: "Title", type: "text" },
          { name: "Jam", type: "link", required: true, options: { target: "Jams" } },
        ],
      },
    });
    await api(me)("/collections/Jams/records", { body: { values: { Title: "Test Jam 2026" } } });
    const none = await api(me)("/collections/Sign-ups/records", { body: { values: { Title: "Test A" } } });
    expect((await json(none)).error.message).toBe("Jam is required");
    const r = await json<RecordView>(
      await api(me)("/collections/Sign-ups/records", {
        body: { values: { Title: "Test A", Jam: "Test Jam 2026" } },
      }),
    );
    const cleared = await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { Jam: null } } });
    expect((await json(cleared)).error.message).toBe("Jam is required");
  });

  it("refuses aliases that would make a field name ambiguous", async () => {
    const me = await signUp("Test Owner");
    const clash = await api(me)("/collections/Notes/fields/Body", {
      method: "PATCH",
      body: { aliases: ["title"] },
    });
    expect(clash.status).toBe(409);
    await api(me)("/collections/Notes/fields/Body", { method: "PATCH", body: { aliases: ["content"] } });
    const second = await api(me)("/collections/Notes/fields", {
      body: { field: { name: "Content", type: "text" } },
    });
    expect(second.status).toBe(409);
    expect((await json(second)).error.message).toMatch(/already names the field "Body"/);
  });

  it("won't change link options that existing links don't fit", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Songs", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections", { body: { name: "Albums", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections", {
      body: {
        name: "Sets",
        fields: [
          { name: "Title", type: "text" },
          { name: "Songs", type: "link", options: { target: "Songs", many: true } },
        ],
      },
    });
    for (const t of ["Test S1", "Test S2"])
      await api(me)("/collections/Songs/records", { body: { values: { Title: t } } });
    await api(me)("/collections/Sets/records", {
      body: { values: { Title: "Test Set", Songs: ["Test S1", "Test S2"] } },
    });
    const one = await api(me)("/collections/Sets/fields/Songs", {
      method: "PATCH",
      body: { options: { many: false } },
    });
    expect(one.status).toBe(409);
    const retarget = await api(me)("/collections/Sets/fields/Songs", {
      method: "PATCH",
      body: { options: { target: "Albums" } },
    });
    expect(retarget.status).toBe(409);
  });
});

describe("saved views", () => {
  it("saves, pins, opens and renames views; filters keep working after a field rename", async () => {
    const me = await signUp("Test Owner");
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    for (const [w, a] of [
      ["Test big", "2000"],
      ["Test small", "100"],
    ])
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: w, Amount: a, Date: today } },
      });
    const saved = await api(me)("/views", {
      body: {
        name: "Big this month",
        collection: "Expenses",
        filters: [
          { field: "Amount", op: "gte", value: 500 },
          { field: "Date", op: "period", value: "this_month" },
        ],
        sort: { field: "Amount", dir: "desc" },
        pinned: true,
      },
    });
    expect(saved.status).toBe(201);
    const v = await json<SavedView>(saved);
    expect(v).toMatchObject({ name: "Big this month", collection: "Expenses", pinned: true, mode: "list" });
    // Bad filters fail when saving, not later.
    const bad = await api(me)("/views", {
      body: { name: "Bad", collection: "Expenses", filters: [{ field: "Colour", op: "eq", value: "red" }] },
    });
    expect(bad.status).toBe(400);
    expect((await api(me)("/views", { body: { name: "big THIS month", collection: "Notes" } })).status).toBe(
      409,
    );

    await api(me)("/collections/Expenses/fields/Amount", { method: "PATCH", body: { name: "Cost" } });
    const opened = await json<OpenedView>(await api(me)(`/views/${encodeURIComponent("Big this month")}`));
    expect(opened.result.items.map((i) => i.title)).toEqual(["Test big"]);
    expect(opened.collection.name).toBe("Expenses");

    // Hiding a field the view uses: the view still opens, without that filter.
    await api(me)("/collections/Expenses/fields/Date", { method: "DELETE" });
    const stillOpens = await json<OpenedView>(await api(me)(`/views/${v.id}`));
    expect(stillOpens.view.filters).toHaveLength(1);
    expect(stillOpens.result.items.map((i) => i.title)).toEqual(["Test big"]);

    const unpinned = await json<SavedView>(
      await api(me)(`/views/${v.id}`, { method: "PATCH", body: { pinned: false, name: "Big ones" } }),
    );
    expect(unpinned).toMatchObject({ name: "Big ones", pinned: false });
    expect((await json<SavedView[]>(await api(me)("/views"))).map((x) => x.name)).toEqual(["Big ones"]);
    expect((await api(me)(`/views/${v.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await json<SavedView[]>(await api(me)("/views"))).toEqual([]);
    const other = await signUp("Test Other");
    expect((await api(other)(`/views/${v.id}`)).status).toBe(404);
  });
});

describe("access and sync", () => {
  it("keeps spaces private and logs changes for devices", async () => {
    const me = await signUp("Test Owner");
    const other = await signUp("Test Other");
    const mine = await json<SpaceView[]>(await api(me)("/spaces"));
    const r = await json<RecordView>(
      await api(me)("/collections/Notes/records", { body: { values: { Title: "Test private" } } }),
    );
    expect((await api(other)(`/records/${r.id}`)).status).toBe(404);
    expect((await api(other)(`/collections?space=${mine[0]!.id}`)).status).toBe(404);

    const all = await json<ChangesView>(await api(me)("/space-changes?since=0"));
    expect(all.changes.some((c) => c.kind === "record" && c.id === r.id)).toBe(true);
    await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { Title: "Test renamed" } } });
    const next = await json<ChangesView>(await api(me)(`/space-changes?since=${all.seq}`));
    expect(next.changes).toEqual([expect.objectContaining({ kind: "record", id: r.id, op: "upsert" })]);
  });
});
