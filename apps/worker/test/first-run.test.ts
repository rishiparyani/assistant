// First run (home-first.md §2 point 15): a conversation about the week; what it starts shows
// up on the home at once, each everyday list with its card. Fake data only.
import { describe, expect, it } from "vitest";
import type { CollectionView, SavedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("first run", () => {
  it("starts everyday lists with their cards, once", async () => {
    const me = await signUp("Test New Person", undefined, { lists: false });
    expect(await json<SavedView[]>(await api(me)("/views"))).toEqual([]);
    for (const kind of ["reminders", "expenses", "events", "notes"])
      expect((await api(me)("/lists/start", { body: { kind } })).status).toBe(201);
    const views = await json<SavedView[]>(await api(me)("/views"));
    expect(views.map((v) => [v.name, v.pinned]).sort()).toEqual([
      ["Coming up", true],
      ["Notes", true],
      ["Spent this month", true],
      ["Today", true],
    ]);
    const today = views.find((v) => v.name === "Today")!;
    expect(today.filters).toEqual([expect.objectContaining({ op: "ne", value: true })]);
    expect(views.find((v) => v.name === "Spent this month")!.filters).toEqual([
      expect.objectContaining({ op: "period", value: "this_month" }),
    ]);
    // Started again: the same list, no second card.
    const again = await json<CollectionView>(await api(me)("/lists/start", { body: { kind: "reminders" } }));
    expect(again.name).toBe("Reminders");
    expect((await json<SavedView[]>(await api(me)("/views"))).length).toBe(4);
  });

  it("gives a list made before cards existed its card once, and doesn't force a removed one back", async () => {
    const me = await signUp("Test Older Person", undefined, { lists: false });
    // An Expenses list made by hand (as before starter cards), with no card on the home.
    await api(me)("/collections", {
      body: {
        name: "Expenses",
        fields: [
          { name: "What", type: "text" },
          { name: "Amount", type: "money" },
          { name: "Date", type: "date" },
        ],
      },
    });
    expect(await json<SavedView[]>(await api(me)("/views"))).toEqual([]);
    await api(me)("/lists/start", { body: { kind: "expenses" } });
    const views = await json<SavedView[]>(await api(me)("/views"));
    expect(views.map((v) => v.name)).toEqual(["Spent this month"]);
    // Taken off the home: starting the list again doesn't bring it back.
    await api(me)(`/views/${views[0]!.id}`, { method: "DELETE" });
    await api(me)("/lists/start", { body: { kind: "expenses" } });
    expect(await json<SavedView[]>(await api(me)("/views"))).toEqual([]);
    // A hand-made list the card can't read (no Date) still starts, just without a card.
    const other = await signUp("Test Notes Person", undefined, { lists: false });
    await api(other)("/collections", {
      body: { name: "Expenses", fields: [{ name: "What", type: "text" }] },
    });
    expect((await api(other)("/lists/start", { body: { kind: "expenses" } })).status).toBe(201);
    expect(await json<SavedView[]>(await api(other)("/views"))).toEqual([]);
  });
});
