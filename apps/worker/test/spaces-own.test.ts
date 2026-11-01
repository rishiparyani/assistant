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

  it("is made and told how things go there from the chat", async () => {
    const me = await signUp("Test Owner");
    const main = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    // Making a space is a card to tap, never done on the model's word alone.
    const asked = await sayIn(me, main.id, "Test: make a band space");
    const card = asked.items.find((i) => i.role === "card")!;
    expect(card.card!.title).toBe("Make a space “Test band”");
    expect((await json<SpaceView[]>(await call("/api/spaces", { cookie: me.cookie }))).length).toBe(1);
    await call(`/api/chats/${main.id}/actions/${card.card!.action_id}/confirm`, {
      cookie: me.cookie,
      body: {},
    });
    const band = (await json<SpaceView[]>(await call("/api/spaces", { cookie: me.cookie }))).find(
      (s) => s.name === "Test band",
    )!;
    expect(band).toBeDefined();
    // Made, the assistant goes on with what it planned for it, without being asked again (owner,
    // 2026-11-01: "It doesn't seem to complete the task without me pushing it").
    const after = await json<ChatView>(await call(`/api/chats/${main.id}`, { cookie: me.cookie }));
    const texts = after.items.map((i) => i.text);
    expect(texts.indexOf("Test: next, the lists in it.")).toBeGreaterThan(
      texts.findIndex((t) => t.startsWith("Done: Make a space")),
    );
    // In the band's chat, its instructions are set in words, for that space only.
    const inBand = await json<ChatView>(
      await call(`/api/chats/current?space=${band.id}`, { cookie: me.cookie }),
    );
    await sayIn(me, inBand.id, "Test: in the band money is split four ways");
    const got = await json<SpaceSettings>(await call(`/api/spaces/${band.id}`, { cookie: me.cookie }));
    expect(got.instructions).toBe("Test: money is always split four ways.");
    const personal = await json<SpaceSettings>(await call("/api/spaces/Personal", { cookie: me.cookie }));
    expect(personal.instructions).toBe("");
  });

  it("shows what was made in another space from that space", async () => {
    // Owner, 2026-11-01: flows made in “Society gate” from his own chat showed “This one is
    // gone now”, read from his own space. The live card carries the space it was made in.
    const me = await signUp("Test Owner");
    const band = await json<SpaceView>(
      await call("/api/spaces", { cookie: me.cookie, body: { name: "Test band" } }),
    );
    await call("/api/collections", {
      cookie: me.cookie,
      body: { space: band.id, name: "Notes", fields: [{ name: "Title", type: "text" }] },
    });
    const main = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    const said = await sayIn(me, main.id, "Test: note in the band");
    const live = said.items.find((i) => i.role === "live")?.live;
    expect(live).toMatchObject({ kind: "record", space: band.id });
  });

  it("never stacks the same card twice, and doesn't offer to make a space that's there", async () => {
    // Owner, 2026-11-01: a "Make a space" card waited, "try again" made a second, Confirm all ran
    // both and the second failed; later the assistant offered the space again though it existed.
    const me = await signUp("Test Owner");
    const main = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    await sayIn(me, main.id, "Test: make a band space");
    const twice = await sayIn(me, main.id, "Test: make a band space");
    const cards = twice.items.filter(
      (i) => i.role === "card" && i.card!.title === "Make a space “Test band”",
    );
    expect(cards.map((c) => c.card!.status)).toEqual(["cancelled", "waiting"]);
    await call(`/api/chats/${main.id}/actions/${cards[1]!.card!.action_id}/confirm`, {
      cookie: me.cookie,
      body: {},
    });
    // It's there now: asked again, no card, and the model is told to use it.
    const again = await sayIn(me, main.id, "Test: make a band space");
    expect(again.items.filter((i) => i.role === "card" && i.card!.status === "waiting")).toEqual([]);
    expect(again.items.at(-1)!.text).toContain("already a space called");
  });
});
