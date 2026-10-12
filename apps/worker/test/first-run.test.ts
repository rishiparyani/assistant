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
});
