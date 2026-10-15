// Bulk changes (decision 2026-10-15 "Toward Excel", 2): every record that matches gets a
// value or one worked out by a formula; previewed first, all or nothing. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChangePreview, ChangeResult, FindResult, RecordView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function gigs(me: User) {
  await api(me)("/collections", {
    body: {
      name: "Gigs",
      fields: [
        { name: "Title", type: "text" },
        { name: "Fee", type: "money" },
        { name: "Date", type: "date" },
        { name: "Kind", type: "choice", options: { choices: ["Wedding", "Corporate", "Club"] } },
        { name: "Paid", type: "boolean" },
        { name: "Balance", type: "money", options: { formula: "{Fee} - 1000" } },
      ],
    },
  });
  const add = async (Title: string, Fee: string, Date: string, Kind: string) =>
    json<RecordView>(
      await api(me)("/collections/Gigs/records", { body: { values: { Title, Fee, Date, Kind } } }),
    );
  const a = await add("Test Wedding", "50000", "2026-10-03", "Wedding");
  const b = await add("Test Corporate", "20000", "2026-10-20", "Corporate");
  const c = await add("Test Club", "8000", "2026-11-05", "Club");
  const all = async () =>
    (await json<FindResult>(await api(me)("/collections/Gigs/find", { body: {} }))).items;
  return { a, b, c, all };
}

describe("bulk changes", () => {
  it("previews, then changes every matching record by a formula or a value", async () => {
    const me = await signUp("Test Owner");
    const { a, b, c, all } = await gigs(me);
    const spec = {
      filters: [{ field: "Fee", op: "gt", value: 10000 }],
      set: [
        { field: "Fee", formula: "{Fee} * 1.1" },
        { field: "Date", formula: "{Date} + 7" },
        { field: "Kind", value: "Corporate" },
      ],
    };
    const preview = await json<ChangePreview>(
      await api(me)("/collections/Gigs/change/preview", { body: spec }),
    );
    expect(preview.count).toBe(2);
    expect(preview.words).toEqual([
      "Where Fee is more than 10000",
      "Fee = {Fee} * 1.1",
      "Date = {Date} + 7",
      "Kind → Corporate",
    ]);
    expect(preview.examples).toContain(
      "Test Wedding: Fee ₹50,000 → ₹55,000, Date 2026-10-03 → 2026-10-10, Kind Wedding → Corporate",
    );
    // Nothing changed yet.
    expect((await all()).find((r) => r.id === a.id)!.named.Fee).toBe("₹50,000");

    const done = await json<ChangeResult>(await api(me)("/collections/Gigs/change", { body: spec }));
    expect(done.changed).toBe(2);
    const after = await all();
    const named = (id: string) => after.find((r) => r.id === id)!.named;
    expect(named(a.id)).toMatchObject({
      Fee: "₹55,000",
      Date: "2026-10-10",
      Kind: "Corporate",
      Balance: "₹54,000",
    });
    expect(named(b.id)).toMatchObject({ Fee: "₹22,000", Date: "2026-10-27" });
    expect(named(c.id)).toMatchObject({ Fee: "₹8,000", Date: "2026-11-05", Kind: "Club" });

    // Text and yes/no by formula, and a value that clears.
    const r2 = await json<ChangeResult>(
      await api(me)("/collections/Gigs/change", {
        body: {
          set: [
            { field: "Title", formula: 'join({Title}, " (", {Kind}, ")")' },
            { field: "Paid", formula: "{Fee} < 10000" },
            { field: "Date", value: null },
          ],
        },
      }),
    );
    expect(r2.changed).toBe(3);
    const again = await all();
    expect(again.find((r) => r.id === c.id)!.named).toMatchObject({ Paid: "Yes" });
    expect(again.find((r) => r.id === c.id)!.title).toBe("Test Club (Club)");
    expect(again.find((r) => r.id === a.id)!.named.Paid).toBe("No");
    expect(again.find((r) => r.id === a.id)!.named.Date ?? null).toBeNull();
    // Each change is in the history and can be undone on its own.
    const history = await json<{ undoable: boolean; action: string }[]>(await api(me)("/history"));
    expect(history.filter((h) => h.action === "update_record" && h.undoable).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("refuses what can't be done, before anything changes", async () => {
    const me = await signUp("Test Owner");
    const { all } = await gigs(me);
    const tryIt = async (set: unknown, filters: unknown[] = []) =>
      (await api(me)("/collections/Gigs/change", { body: { filters, set } })).status;
    // A formula whose kind doesn't fit the field; text into money; a calculated field; both value and formula.
    expect(await tryIt([{ field: "Fee", formula: '"big"' }])).toBe(400);
    expect(await tryIt([{ field: "Fee", formula: "{Title} + 1" }])).toBe(400);
    expect(await tryIt([{ field: "Balance", value: 1 }])).toBe(400);
    expect(await tryIt([{ field: "Fee", value: 1, formula: "{Fee}" }])).toBe(400);
    expect(await tryIt([{ field: "Nope", value: 1 }])).toBe(400);
    // A choice must be one of the choices: the whole change is refused, nothing kept.
    expect(await tryIt([{ field: "Kind", formula: 'if({Fee} > 10000, "Big", "Club")' }])).toBe(400);
    expect((await all()).every((r) => r.named.Kind !== "Big")).toBe(true);
    // A viewer can't.
    const viewer = await signUp("Test Viewer");
    expect(
      (await api(viewer)("/collections/Gigs/change/preview", { body: { set: [{ field: "Fee", value: 1 }] } }))
        .status,
    ).toBe(404);
  });
});
