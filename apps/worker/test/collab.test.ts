// Lists and notes on a gig: everyone on the gig works on them together; players can be
// stopped by a setting; strangers see nothing. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function band() {
  const manager = await signUp("Test Manager");
  const player = await signUp("Test Player");
  const res = await as(manager)("/gigs", {
    body: {
      title: "Test Collab Gig",
      events: [{ start_at: "2026-12-12T19:00", venue_name: "Test Hall" }],
      people: [{ user_id: player.id }],
    },
  });
  const gig = await json<BookingView>(res);
  return { manager, player, gig };
}
const texts = (g: BookingView, listId: string) =>
  g.lists.find((l) => l.id === listId)!.items.map((i) => i.text);

describe("gig lists", () => {
  it("makes a list with items, adds, reorders, ticks and removes", async () => {
    const { manager, player, gig } = await band();
    expect(gig.lists).toEqual([]);
    expect(gig.can_edit_lists).toBe(true);

    let res = await as(manager)(`/gigs/${gig.id}/lists`, {
      body: {
        title: "Test Set 1",
        event_id: gig.events[0]!.id,
        items: [{ text: "Song A", detail: "G · 4 min" }, { text: "Song B" }, { text: "Song C" }],
      },
    });
    expect(res.status).toBe(201);
    let g = await json<BookingView>(res);
    const list = g.lists[0]!;
    expect(list.title).toBe("Test Set 1");
    expect(list.event_id).toBe(gig.events[0]!.id);
    expect(list.created_by).toBe("Test Manager");
    expect(texts(g, list.id)).toEqual(["Song A", "Song B", "Song C"]);
    expect(list.items[0]!.detail).toBe("G · 4 min");
    const [a, b, c] = list.items.map((i) => i.id) as [string, string, string];

    // The player sees it and can change it (default).
    g = await json<BookingView>(await as(player)(`/gigs/${gig.id}`));
    expect(texts(g, list.id)).toEqual(["Song A", "Song B", "Song C"]);
    g = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/lists/${list.id}/items/${c}/move`, { body: { after_item_id: null } }),
    );
    expect(texts(g, list.id)).toEqual(["Song C", "Song A", "Song B"]);
    g = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/lists/${list.id}/items/${c}/move`, { body: { after_item_id: b } }),
    );
    expect(texts(g, list.id)).toEqual(["Song A", "Song B", "Song C"]);

    // Add at the end, at the top, and after an item (several at once keep their order).
    await as(player)(`/gigs/${gig.id}/lists/${list.id}/items`, { body: { items: [{ text: "Song E" }] } });
    await as(player)(`/gigs/${gig.id}/lists/${list.id}/items`, {
      body: { items: [{ text: "Intro" }], after_item_id: null },
    });
    g = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/lists/${list.id}/items`, {
        body: { items: [{ text: "Song A2" }, { text: "Song A3" }], after_item_id: a },
      }),
    );
    expect(texts(g, list.id)).toEqual([
      "Intro",
      "Song A",
      "Song A2",
      "Song A3",
      "Song B",
      "Song C",
      "Song E",
    ]);

    // Many moves into the same gap still keep a clean order (positions get renumbered).
    for (let i = 0; i < 60; i++) {
      const cur = g.lists[0]!.items;
      const moving = i % 2 ? cur.find((x) => x.text === "Song E")! : cur.find((x) => x.text === "Song C")!;
      g = await json<BookingView>(
        await as(manager)(`/gigs/${gig.id}/lists/${list.id}/items/${moving.id}/move`, {
          body: { after_item_id: a },
        }),
      );
    }
    expect(texts(g, list.id).slice(0, 4)).toEqual(["Intro", "Song A", "Song E", "Song C"]);
    expect(new Set(texts(g, list.id)).size).toBe(7);

    // Edit text; tick boxes only on checkable lists.
    res = await as(player)(`/gigs/${gig.id}/lists/${list.id}/items/${b}`, {
      method: "PATCH",
      body: { text: "Song B (acoustic)", detail: null },
    });
    expect(texts(await json<BookingView>(res), list.id)).toContain("Song B (acoustic)");
    res = await as(player)(`/gigs/${gig.id}/lists/${list.id}/items/${b}`, {
      method: "PATCH",
      body: { done: true },
    });
    expect(res.status).toBe(400);
    await as(manager)(`/gigs/${gig.id}/lists/${list.id}`, { method: "PATCH", body: { checkable: true } });
    g = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/lists/${list.id}/items/${b}`, {
        method: "PATCH",
        body: { done: true },
      }),
    );
    const ticked = g.lists[0]!.items.find((i) => i.id === b)!;
    expect(ticked.done).toBe(true);
    expect(ticked.done_by).toBe("Test Player");

    // Remove an item, then the list.
    g = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/lists/${list.id}/items/${a}`, { method: "DELETE" }),
    );
    expect(texts(g, list.id)).not.toContain("Song A");
    g = await json<BookingView>(await as(manager)(`/gigs/${gig.id}/lists/${list.id}`, { method: "DELETE" }));
    expect(g.lists).toEqual([]);
    expect(
      (await as(manager)(`/gigs/${gig.id}/lists/${list.id}/items`, { body: { items: [{ text: "X" }] } }))
        .status,
    ).toBe(404);
  });

  it("lets managers stop players changing lists and notes; strangers get 404", async () => {
    const { manager, player, gig } = await band();
    const made = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/lists`, { body: { title: "Test Packing", checkable: true } }),
    );
    const listId = made.lists[0]!.id;
    await as(manager)(`/gigs/${gig.id}`, {
      method: "PATCH",
      body: { version: made.version, settings: { players_edit_lists: false } },
    });
    const seen = await json<BookingView>(await as(player)(`/gigs/${gig.id}`));
    expect(seen.can_edit_lists).toBe(false);
    expect(seen.lists.map((l) => l.title)).toEqual(["Test Packing"]); // still visible
    expect(
      (await as(player)(`/gigs/${gig.id}/lists/${listId}/items`, { body: { items: [{ text: "Cable" }] } }))
        .status,
    ).toBe(403);
    expect((await as(player)(`/gigs/${gig.id}/notes`, { body: { body: "Hi" } })).status).toBe(403);
    expect(
      (await as(manager)(`/gigs/${gig.id}/lists/${listId}/items`, { body: { items: [{ text: "Cable" }] } }))
        .status,
    ).toBe(201);

    const stranger = await signUp("Test Stranger");
    expect((await as(stranger)(`/gigs/${gig.id}/lists`, { body: { title: "X" } })).status).toBe(404);
    expect((await as(stranger)(`/gigs/${gig.id}/notes`, { body: { body: "X" } })).status).toBe(404);
  });

  it("retrying the same request doesn't add twice", async () => {
    const { manager, gig } = await band();
    const key = crypto.randomUUID();
    const body = { title: "Test Once", items: [{ text: "One" }] };
    await as(manager)(`/gigs/${gig.id}/lists`, { body, idempotencyKey: key });
    const again = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/lists`, { body, idempotencyKey: key }),
    );
    expect(again.lists.length).toBe(1);
  });
});

describe("gig notes", () => {
  it("anyone on the gig posts; only the author edits; author or manager removes", async () => {
    const { manager, player, gig } = await band();
    let g = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/notes`, { body: { body: "Test: soundcheck at 5" } }),
    );
    const mine = g.shared_notes[0]!;
    expect(mine.author).toBe("Test Player");
    expect(mine.is_mine).toBe(true);
    expect(mine.edited_at).toBeNull();
    g = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/notes`, { body: { body: "Test: bring the DI" } }),
    );
    expect(g.shared_notes.map((n) => n.body)).toEqual(["Test: bring the DI", "Test: soundcheck at 5"]);
    expect(g.shared_notes[1]!.is_mine).toBe(false);

    // Only the author edits.
    expect(
      (await as(manager)(`/gigs/${gig.id}/notes/${mine.id}`, { method: "PATCH", body: { body: "Nope" } }))
        .status,
    ).toBe(403);
    g = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/notes/${mine.id}`, {
        method: "PATCH",
        body: { body: "Test: soundcheck at 4" },
      }),
    );
    expect(g.shared_notes.find((n) => n.id === mine.id)!.edited_at).not.toBeNull();

    // A player can't remove the manager's note; the manager can remove the player's.
    const theirs = g.shared_notes.find((n) => n.author === "Test Manager")!;
    expect((await as(player)(`/gigs/${gig.id}/notes/${theirs.id}`, { method: "DELETE" })).status).toBe(403);
    g = await json<BookingView>(await as(manager)(`/gigs/${gig.id}/notes/${mine.id}`, { method: "DELETE" }));
    expect(g.shared_notes.map((n) => n.body)).toEqual(["Test: bring the DI"]);

    // The gig's own notes field is separate.
    expect(g.notes).toBeNull();
    // Too long is refused.
    expect((await as(player)(`/gigs/${gig.id}/notes`, { body: { body: "x".repeat(2001) } })).status).toBe(
      400,
    );
  });
});

describe("ids made on the device (offline changes)", () => {
  it("uses a given id for new notes, lists, items and guests; refuses one that's taken", async () => {
    const { manager, gig } = await band();
    const id = () => {
      // A valid ULID-shaped id (Crockford base32, 26 characters).
      const abc = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      return Array.from(crypto.getRandomValues(new Uint8Array(26)), (b) => abc[b % 32]).join("");
    };
    const [noteId, listId, itemId, guestId] = [id(), id(), id(), id()];
    let g = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/notes`, { body: { id: noteId, body: "Test offline note" } }),
    );
    expect(g.shared_notes[0]!.id).toBe(noteId);
    g = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/lists`, {
        body: { id: listId, title: "Test Set", items: [{ id: itemId, text: "Song A" }] },
      }),
    );
    expect(g.lists[0]!.id).toBe(listId);
    expect(g.lists[0]!.items[0]!.id).toBe(itemId);
    g = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/guests`, {
        body: { guests: [{ id: guestId, name: "Test Guest" }] },
      }),
    );
    expect(g.guest_list.guests[0]!.id).toBe(guestId);
    // Then change it by that id, as a queued offline change would.
    const res = await as(manager)(`/gigs/${gig.id}/lists/${listId}/items/${itemId}`, {
      method: "PATCH",
      body: { text: "Song A (edited offline)" },
    });
    expect(res.status).toBe(200);

    const again = await as(manager)(`/gigs/${gig.id}/notes`, { body: { id: noteId, body: "Test other" } });
    expect(again.status).toBe(409);
    expect(
      (await as(manager)(`/gigs/${gig.id}/notes`, { body: { id: "not-a-ulid", body: "x" } })).status,
    ).toBe(400);
  });
});
