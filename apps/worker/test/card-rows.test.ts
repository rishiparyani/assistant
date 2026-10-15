// Rich rows on list cards (decision 2026-10-13 "Cards get rich rows"): a saved view keeps its
// rows' layout (date tile, details, pills, callout, button), each part checked against its
// field and stored by id. Fake data only.
import { describe, expect, it } from "vitest";
import type { SavedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("card rows", () => {
  it("keeps a row layout by field ids, and refuses parts that don't fit", async () => {
    const me = await signUp("Test Owner", undefined, { lists: false });
    const made = await api(me)("/collections", {
      body: {
        name: "Test gigs",
        fields: [
          { name: "Venue", type: "text" },
          { name: "Starts", type: "datetime" },
          { name: "Band", type: "choice", options: { choices: ["Test Trio", "Solo"] } },
          { name: "Fee", type: "money" },
          { name: "To do", type: "long_text" },
          { name: "Address", type: "text" },
        ],
      },
    });
    expect(made.status).toBe(201);
    const saved = await api(me)("/views", {
      body: {
        name: "Coming up",
        collection: "Test gigs",
        pinned: true,
        card: {
          row: {
            date: "Starts",
            details: ["Starts", "Band"],
            pills: ["Fee"],
            callout: { field: "To do", label: "To do" },
            action: { field: "Address", as: "directions" },
          },
        },
      },
    });
    expect(saved.status).toBe(201);
    const v = await json<SavedView>(saved);
    // A row layout makes it a list card; parts are stored by field id.
    expect(v.card?.arrangement).toBe("list-plain");
    const row = v.card!.row!;
    expect(row.details).toHaveLength(2);
    expect(row.date).toBe(row.details[0]);
    expect(row.date).not.toBe("Starts");
    expect(row.callout).toMatchObject({ label: "To do" });
    expect(row.action?.as).toBe("directions");

    // Highlights: filters checked like a view's, stored by field id, names on the way out.
    const lit = await api(me)(`/views/${v.id}`, {
      method: "PATCH",
      body: {
        card: {
          row: {
            date: "Starts",
            highlights: [
              { when: [{ field: "Fee", op: "gte", value: 10000 }], colour: "green", label: "Big" },
              { when: [{ field: "Band", op: "eq", value: "Solo" }], colour: "grey" },
            ],
          },
        },
      },
    });
    expect(lit.status).toBe(200);
    const lv = await json<SavedView>(lit);
    const hs = lv.card!.row!.highlights!;
    expect(hs).toHaveLength(2);
    expect(hs[0]).toMatchObject({ colour: "green", label: "Big" });
    expect(hs[0]!.when[0]!.field).not.toBe("Fee");
    expect(hs[1]!.label).toBeNull();
    const badLit = await api(me)(`/views/${v.id}`, {
      method: "PATCH",
      body: {
        card: { row: { highlights: [{ when: [{ field: "Nope", op: "eq", value: 1 }], colour: "red" }] } },
      },
    });
    expect(badLit.status).toBe(400);

    const bad = async (r: object, arrangement?: string) =>
      api(me)(`/views/${v.id}`, { method: "PATCH", body: { card: { arrangement, row: r } } });
    const tile = await bad({ date: "Venue" });
    expect(tile.status).toBe(400);
    expect(JSON.stringify(await json(tile))).toContain("A date tile needs a date or date-time field");
    expect((await bad({ callout: { field: "Fee" } })).status).toBe(400);
    expect((await bad({ pills: ["Starts"] })).status).toBe(400);
    expect((await bad({ details: ["Nope"] })).status).toBeGreaterThanOrEqual(400);
    // Rows belong on list cards.
    expect((await bad({ pills: ["Fee"] }, "number")).status).toBe(400);
    // null resets the card.
    const reset = await api(me)(`/views/${v.id}`, { method: "PATCH", body: { card: null } });
    expect((await json<SavedView>(reset)).card).toBeNull();
  });
});
