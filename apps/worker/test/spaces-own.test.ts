// Spaces of one's own (decision 2026-10-16 "Spaces"): the band, home, the gate; each with its
// own chats, memory and instructions. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView, SpaceSettings, SpaceView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const sayIn = (u: User, chat: string, text: string) =>
  call(`/api/chats/${chat}`, { cookie: u.cookie, body: { text } }).then((r) => json<ChatView>(r));

describe("spaces of one's own", () => {
  it("makes a space, keeps its instructions, and keeps it private", async () => {
    const me = await signUp("Test Owner");
    const made = await json<SpaceView>(
      await call("/api/spaces", { cookie: me.cookie, body: { name: "Test band" } }),
    );
    expect(made).toMatchObject({ name: "Test band", kind: "shared", role: "owner" });
    const list = await json<SpaceView[]>(await call("/api/spaces", { cookie: me.cookie }));
    expect(list.map((s) => s.name)).toEqual(["Personal", "Test band"]);
    // The same name twice is refused.
    expect((await call("/api/spaces", { cookie: me.cookie, body: { name: "test band" } })).status).toBe(409);

    const set = await json<SpaceSettings>(
      await call(`/api/spaces/${made.id}/instructions`, {
        cookie: me.cookie,
        method: "PUT",
        body: { text: "Test: money is always split four ways." },
      }),
    );
    expect(set.instructions).toBe("Test: money is always split four ways.");
    const got = await json<SpaceSettings>(await call("/api/spaces/Test%20band", { cookie: me.cookie }));
    expect(got.instructions).toBe("Test: money is always split four ways.");
    // By name as well as id; others see nothing.
    const other = await signUp("Test Other");
    expect((await call(`/api/spaces/${made.id}`, { cookie: other.cookie })).status).toBe(404);
  });

  it("gives each space its own current chat, and the assistant works in that space", async () => {
    const me = await signUp("Test Owner");
    const band = await json<SpaceView>(
      await call("/api/spaces", { cookie: me.cookie, body: { name: "Test band" } }),
    );
    const personal = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    const inBand = await json<ChatView>(
      await call(`/api/chats/current?space=${band.id}`, { cookie: me.cookie }),
    );
    expect(inBand.id).not.toBe(personal.id);
    expect(inBand).toMatchObject({ space_id: band.id, space_name: "Test band" });
    expect(personal.space_id).toBeNull();
    // Asking again gives the same chats, each in its space.
    expect(
      (await json<ChatView>(await call(`/api/chats/current?space=Test%20band`, { cookie: me.cookie }))).id,
    ).toBe(inBand.id);
    expect((await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }))).id).toBe(
      personal.id,
    );

    // A note added from the band's chat lands in the band's lists, not Personal's (the band
    // starts with its Notes list, as the assistant would start it).
    await call("/api/lists/start", { cookie: me.cookie, body: { kind: "notes", space: band.id } });
    await sayIn(me, inBand.id, "Test: note the PA needs two DI boxes");
    const titles = async (space?: string) =>
      json<{ items: { title: string }[] }>(
        await call(`/api/collections/Notes/find${space ? `?space=${space}` : ""}`, {
          cookie: me.cookie,
          body: {},
        }),
      ).then((r) => r.items.map((x) => x.title));
    expect(await titles(band.id)).toEqual(["Test PA needs two DI boxes"]);
    expect(await titles()).toEqual([]);
  });

  it("remembers for one space only, and everywhere from Personal", async () => {
    const me = await signUp("Test Owner");
    const band = await json<SpaceView>(
      await call("/api/spaces", { cookie: me.cookie, body: { name: "Test band" } }),
    );
    const inBand = await json<ChatView>(
      await call(`/api/chats/current?space=${band.id}`, { cookie: me.cookie }),
    );
    await sayIn(me, inBand.id, "Test: remember weddings are 25000");
    // The band's chat knows it; Personal's doesn't.
    expect((await sayIn(me, inBand.id, "Test: what do you remember")).items.at(-1)!.text).toBe("I remember.");
    const personal = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    expect((await sayIn(me, personal.id, "Test: what do you remember")).items.at(-1)!.text).toBe(
      "Nothing yet.",
    );
    // The memory screen lists it with its space.
    const all = await json<{ text: string; space_id: string | null }[]>(
      await call("/api/memories", { cookie: me.cookie }),
    );
    expect(all).toHaveLength(1);
    expect(all[0]!.space_id).toBe(band.id);
    // Remembered from Personal: everywhere, so the band's chat sees both.
    await sayIn(me, personal.id, "Test: remember weddings are 25000");
    expect(
      (await json<{ space_id: string | null }[]>(await call("/api/memories", { cookie: me.cookie })))
        .map((m) => m.space_id)
        .sort(),
    ).toEqual([band.id, null].sort());
  });
});
