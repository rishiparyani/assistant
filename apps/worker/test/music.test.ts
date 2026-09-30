// The music module: my song library, private to me, searchable, backed up. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, SongSummary, SongView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("song library", () => {
  it("adds, finds, changes and removes my songs; others can't see them", async () => {
    const me = await signUp("Test Guitarist");
    const other = await signUp("Test Other");

    const res = await as(me)("/songs", {
      body: {
        title: "The Test Song",
        artist: "Test Band",
        key: "G",
        tempo_bpm: 96,
        chart: "{c: Intro}\n[G]Test line [C]one",
      },
    });
    expect(res.status).toBe(201);
    const song = await json<SongView>(res);
    expect(song).toMatchObject({ title: "The Test Song", key: "G", tempo_bpm: 96, capo: null });
    await as(me)("/songs", { body: { title: "Another Test Tune", key: "Am" } });

    // Sorted by title ignoring "The"; search matches title or artist.
    const all = await json<SongSummary[]>(await as(me)("/songs"));
    expect(all.map((s) => s.title)).toEqual(["Another Test Tune", "The Test Song"]);
    expect(all[0]).not.toHaveProperty("chart");
    expect((await json<SongSummary[]>(await as(me)("/songs?q=test%20band"))).map((s) => s.id)).toEqual([
      song.id,
    ]);
    // Search is by word start (indexed): "tun" finds "Another Test Tune", "une" doesn't.
    const find = async (q: string) =>
      (await json<SongSummary[]>(await as(me)(`/songs?q=${encodeURIComponent(q)}`))).map((s) => s.title);
    expect(await find("tun")).toEqual(["Another Test Tune"]);
    expect(await find("une")).toEqual([]);
    expect(await find("TEST")).toEqual(["Another Test Tune", "The Test Song"]);

    // Bad key refused; changes keep what wasn't given; empty text clears.
    expect((await as(me)("/songs", { body: { title: "Test", key: "H" } })).status).toBe(400);
    const changed = await json<SongView>(
      await as(me)(`/songs/${song.id}`, {
        method: "PATCH",
        body: { key: "A", notes: "Test notes", artist: "" },
      }),
    );
    expect(changed).toMatchObject({ title: "The Test Song", key: "A", notes: "Test notes", artist: null });
    expect(changed.chart).toContain("[G]Test line");
    // The search words follow the change: the old artist is gone.
    expect(await find("band")).toEqual([]);

    // Private: another person gets 404 and an empty library.
    expect((await as(other)(`/songs/${song.id}`)).status).toBe(404);
    expect(await json<SongSummary[]>(await as(other)("/songs"))).toEqual([]);

    // Full library (for offline use) includes the charts.
    const full = await json<SongView[]>(await as(me)("/songs-all"));
    expect(full.find((s) => s.id === song.id)?.chart).toContain("[C]one");

    // Remove.
    expect((await as(me)(`/songs/${song.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(me)(`/songs/${song.id}`)).status).toBe(404);
    expect(await find("song")).toEqual([]);
    expect((await json<SongSummary[]>(await as(me)("/songs"))).map((s) => s.title)).toEqual([
      "Another Test Tune",
    ]);
  });

  it("applies a repeated request once, and accepts an id made on the device", async () => {
    const me = await signUp("Test Guitarist");
    const key = crypto.randomUUID();
    const id = "01K0000000000000000000TEST";
    const first = await as(me)("/songs", { body: { id, title: "Test Once" }, idempotencyKey: key });
    const again = await as(me)("/songs", { body: { id, title: "Test Once" }, idempotencyKey: key });
    expect(first.status).toBe(201);
    expect((await json<SongView>(again)).id).toBe(id);
    expect(await json<SongSummary[]>(await as(me)("/songs"))).toHaveLength(1);
    // The same id again (new request) is refused.
    expect((await as(me)("/songs", { body: { id, title: "Test Twice" } })).status).toBe(409);
  });

  it("links songs to setlist items, made with the list or added later", async () => {
    const me = await signUp("Test Guitarist");
    const song = await json<SongView>(await as(me)("/songs", { body: { title: "Test Song", key: "G" } }));
    const gig = await json<BookingView>(
      await as(me)("/gigs", { body: { title: "Test Gig", events: [{ start_at: "2026-12-12T19:00" }] } }),
    );
    let g = await json<BookingView>(
      await as(me)(`/gigs/${gig.id}/lists`, {
        body: { title: "Test Set", items: [{ text: "Test Song", song_id: song.id }, { text: "Test Jam" }] },
      }),
    );
    const list = g.lists[0]!;
    g = await json<BookingView>(
      await as(me)(`/gigs/${gig.id}/lists/${list.id}/items`, {
        body: { items: [{ text: "Test Song", song_id: song.id }] },
      }),
    );
    expect(g.lists[0]!.items.map((i) => i.song_id)).toEqual([song.id, null, song.id]);
  });
});
