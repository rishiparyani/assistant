// Search (home-first.md §4): one index per person, filled from the space's change log,
// re-checked on every hit. Fake data only.
import { describe, expect, it } from "vitest";
import type { RecordView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
type Hit = { title: string; collection: string; snippet: string; record_id: string };
const search = async (u: User, q: string) =>
  json<Hit[]>(await api(u)(`/search?q=${encodeURIComponent(q)}&limit=12`));

describe("search", () => {
  it("finds my records by part of a word, forgets deleted ones, and shows nobody else's", async () => {
    const me = await signUp("Test Owner");
    const other = await signUp("Test Other");
    const strat = await json<RecordView>(
      await api(me)("/collections/Reminders/records", { body: { values: { Title: "Restring the Strat" } } }),
    );
    await api(me)("/collections/Expenses/records", {
      body: { values: { What: "Strap for the Strat", Amount: "650" } },
    });
    await api(me)("/collections/Notes/records", {
      body: { values: { Title: "Set list ideas", Body: "open with Purple Haze" } },
    });
    // The index fills from the alarm a moment after the writes.
    expect(await until(async () => (await search(me, "strat")).length === 2)).toBe(true);
    const hits = await search(me, "strat");
    expect(hits.map((h) => h.title).sort()).toEqual(["Restring the Strat", "Strap for the Strat"]);
    // Part of a word, any case; and the body of a note.
    expect((await search(me, "PURPLE")).map((h) => h.title)).toEqual(["Set list ideas"]);
    expect((await search(me, "purple ha"))[0]?.snippet).toMatch(/Purp/);
    // By meaning (the stand-in vector in tests): "strings" shares its letters with "Restring",
    // which no word match would find.
    expect((await search(me, "strings")).map((h) => h.title)).toContain("Restring the Strat");
    // Too short to mean anything.
    expect(await search(me, "s")).toEqual([]);
    // Nobody else's index has it.
    expect(await search(other, "strat")).toEqual([]);
    // A deleted record leaves the index.
    expect((await api(me)(`/records/${strat.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await until(async () => (await search(me, "strat")).length === 1)).toBe(true);
    // A rebuild gives the same answer; the same request again replays it, it doesn't redo it.
    const once = { method: "POST", idempotencyKey: "test-rebuild-1" };
    const re = await json<{ indexed: number }>(await api(me)("/search/rebuild", once));
    expect(re.indexed).toBe(2);
    expect(await json<{ indexed: number }>(await api(me)("/search/rebuild", once))).toEqual(re);
    expect((await search(me, "strat")).map((h) => h.title)).toEqual(["Strap for the Strat"]);
  });

  it("reindexes a list's records when one of its fields is renamed", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections/Notes/records", {
      body: { values: { Title: "Test gig notes", Body: "open with Purple Haze" } },
    });
    expect(await until(async () => (await search(me, "purple")).length === 1)).toBe(true);
    // The field's name is part of what the index reads ("Body: open with …").
    expect((await search(me, "body:")).length).toBe(1);
    expect(
      (
        await api(me)("/collections/Notes/fields/Body", {
          method: "PATCH",
          body: { name: "Details" },
        })
      ).status,
    ).toBe(200);
    expect(await until(async () => (await search(me, "details:")).length === 1)).toBe(true);
    expect(await search(me, "body:")).toEqual([]);
  });
});
