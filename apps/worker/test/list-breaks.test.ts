// Breaks in lists (decision 2026-10-03): a divider with a name and an optional length;
// never numbered or ticked; history says what changed. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, GigHistoryView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("breaks in lists", () => {
  it("adds a break between sets, changes its length, refuses ticks and lengths on items", async () => {
    const owner = await signUp("Test Owner");
    const gig = await json<BookingView>(
      await as(owner)("/gigs", {
        body: { title: "Test Breaks Gig", events: [{ start_at: "2026-12-20T19:00" }] },
      }),
    );
    const made = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/lists`, {
        body: {
          title: "Test Setlist",
          checkable: true,
          items: [
            { text: "Song A" },
            { kind: "break", text: "Break", minutes: 15, detail: "Dinner for the band" },
            { text: "Song B" },
          ],
        },
      }),
    );
    const list = made.lists[0]!;
    expect(list.items.map((i) => [i.kind, i.text, i.minutes])).toEqual([
      ["item", "Song A", null],
      ["break", "Break", 15],
      ["item", "Song B", null],
    ]);
    const brk = list.items[1]!;
    const base = `/gigs/${gig.id}/lists/${list.id}/items`;

    // A second break, after Song B.
    const more = await json<BookingView>(
      await as(owner)(base, {
        body: { items: [{ kind: "break", text: "Interval" }], after_item_id: list.items[2]!.id },
      }),
    );
    expect(more.lists[0]!.items.map((i) => i.text)).toEqual(["Song A", "Break", "Song B", "Interval"]);

    // Its length changes; a break can't be ticked; an item has no length; a break isn't a song.
    const changed = await json<BookingView>(
      await as(owner)(`${base}/${brk.id}`, { method: "PATCH", body: { minutes: 10 } }),
    );
    expect(changed.lists[0]!.items[1]!.minutes).toBe(10);
    const cleared = await json<BookingView>(
      await as(owner)(`${base}/${brk.id}`, { method: "PATCH", body: { minutes: null } }),
    );
    expect(cleared.lists[0]!.items[1]!.minutes).toBeNull();
    expect((await as(owner)(`${base}/${brk.id}`, { method: "PATCH", body: { done: true } })).status).toBe(
      400,
    );
    expect(
      (await as(owner)(`${base}/${list.items[0]!.id}`, { method: "PATCH", body: { minutes: 5 } })).status,
    ).toBe(400);
    expect(
      (
        await as(owner)(base, {
          body: { items: [{ kind: "break", text: "X", song_id: "01J00000000000000000000000" }] },
        })
      ).status,
    ).toBe(400);
    expect((await as(owner)(base, { body: { items: [{ text: "Y", minutes: 5 }] } })).status).toBe(400);

    const h = await json<GigHistoryView>(await as(owner)(`/gigs/${gig.id}/history`));
    expect(h.items.map((e) => [e.summary, e.details])).toEqual(
      expect.arrayContaining([
        [`Changed “Break” in “Test Setlist”`, ["Length: 10 min → no length"]],
        [`Changed “Break” in “Test Setlist”`, ["Length: 15 min → 10 min"]],
        [`Added a break to “Test Setlist”`, ["Interval"]],
      ]),
    );
  });
});
