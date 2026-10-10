// The in-app assistant (docs/design/universal.md §10) with the scripted test model
// (src/core/assistant/fake-model.ts): tools run through the operations, money and setups
// wait for a tap, level 1 hands setups over, and the budget keeps the cap. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { ChatView, FindResult } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const say = (u: User, text: string, key?: string) =>
  call("/api/chat", { cookie: u.cookie, body: { text }, ...(key ? { idempotencyKey: key } : {}) }).then((r) =>
    json<ChatView>(r),
  );
const find = (u: User, collection: string) =>
  call(`/api/collections/${collection}/find`, { cookie: u.cookie, body: {} }).then((r) =>
    json<FindResult>(r),
  );

describe("chat", () => {
  it("runs everyday tools at once and shows the answer", async () => {
    const me = await signUp("Test Owner");
    const empty = await json<ChatView>(await call("/api/chat", { cookie: me.cookie }));
    expect(empty).toMatchObject({ items: [], setup_in_progress: false, smart_available: false });

    const view = await say(me, "Test: note the PA needs two DI boxes");
    expect(view.items.map((i) => [i.role, i.text])).toEqual([
      ["user", "Test: note the PA needs two DI boxes"],
      ["assistant", "Done."],
      ["live", ""],
    ]);
    const notes = await find(me, "Notes");
    expect(notes.items.map((i) => i.title)).toEqual(["Test PA needs two DI boxes"]);
    // The new note follows the reply as a live card pointing at the record.
    expect(view.items.at(-1)!.live).toEqual({
      kind: "record",
      collection_id: notes.items[0]!.collection_id,
      record_id: notes.items[0]!.id,
    });
  });

  it("shows a find as a live list card", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Test: note the PA needs two DI boxes");
    const view = await say(me, "Test: show my notes");
    const live = view.items.at(-1)!;
    expect(live.role).toBe("live");
    expect(live.live).toMatchObject({ kind: "list", title: "Notes · “Test”", query: { search: "Test" } });
  });

  it("shows money as a card that runs only on Confirm, once", async () => {
    const me = await signUp("Test Owner");
    const view = await say(me, "Test: spent 450 on groceries");
    const card = view.items.find((i) => i.role === "card")!;
    expect(card.card).toMatchObject({ title: "Add to Expenses", status: "waiting" });
    expect(card.card!.details).toContain("Amount: 450");
    expect((await find(me, "Expenses")).items).toEqual([]);

    const done = await json<ChatView>(
      await call(`/api/chat/actions/${card.card!.action_id}/confirm`, { cookie: me.cookie, body: {} }),
    );
    expect(done.items.find((i) => i.role === "card")!.card!.status).toBe("done");
    expect(done.items.at(-2)!.text).toBe("Done: Add to Expenses.");
    const expenses = await find(me, "Expenses");
    expect(done.items.at(-1)!.live).toMatchObject({ kind: "record", record_id: expenses.items[0]!.id });
    expect(expenses.items.map((i) => i.named.Amount)).toEqual(["₹450"]);
    // A second tap can't add it again.
    const again = await call(`/api/chat/actions/${card.card!.action_id}/confirm`, {
      cookie: me.cookie,
      body: {},
    });
    expect(again.status).toBe(409);
  });

  it("cancels a card without running it", async () => {
    const me = await signUp("Test Owner");
    const card = (await say(me, "Test: spent 450 on groceries")).items.find((i) => i.role === "card")!;
    const view = await json<ChatView>(
      await call(`/api/chat/actions/${card.card!.action_id}/cancel`, { cookie: me.cookie, body: {} }),
    );
    expect(view.items.find((i) => i.role === "card")!.card!.status).toBe("cancelled");
    expect((await find(me, "Expenses")).items).toEqual([]);
  });

  it("hands setups over, and says so when the smart model is off", async () => {
    const me = await signUp("Test Owner");
    const view = await say(me, "Test: make a collection for fam jam sign-ups");
    expect(view.items.at(-1)!.text).toMatch(/needs the smart model.*Your lists in the menu/);
    expect(view.setup_in_progress).toBe(false);
    const cols = await json<{ name: string }[]>(await call("/api/collections", { cookie: me.cookie }));
    expect(cols.map((c) => c.name)).not.toContain("Test fam jam sign-ups");
  });

  it("answers a repeated send once, and keeps chats private", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Hello", "k-1");
    const again = await say(me, "Hello", "k-1");
    expect(again.items.filter((i) => i.role === "user")).toHaveLength(1);
    const card = (await say(me, "Test: spent 450 on groceries")).items.find((i) => i.role === "card")!;
    const other = await signUp("Test Other");
    expect((await json<ChatView>(await call("/api/chat", { cookie: other.cookie }))).items).toEqual([]);
    const steal = await call(`/api/chat/actions/${card.card!.action_id}/confirm`, {
      cookie: other.cookie,
      body: {},
    });
    expect(steal.status).toBe(404);
    // Not an MCP tool or API-token action.
    expect((await call("/api/chat", { body: { text: "hi" } })).status).toBe(401);
    const cleared = await json<ChatView>(await call("/api/chat", { cookie: me.cookie, method: "DELETE" }));
    expect(cleared.items).toEqual([]);
  });
});

describe("cards and repeats", () => {
  it("names the record a delete is about, and refuses unknown ones", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Test: note the PA needs two DI boxes");
    const note = (await find(me, "Notes")).items[0]!;
    const view = await say(me, `Test: delete record ${note.id}`);
    const card = view.items.find((i) => i.role === "card")!;
    expect(card.card!.title).toBe("Delete “Test PA needs two DI boxes” (Notes)");
    const bad = await say(me, "Test: delete record 01J0000000000000000000NOPE");
    expect(bad.items.filter((i) => i.role === "card")).toHaveLength(1);
    expect(bad.items.at(-1)!.text).toMatch(/Record not found/);
  });

  it("runs overlapping sends with one key once", async () => {
    const me = await signUp("Test Owner");
    const send = () =>
      call("/api/chat", {
        cookie: me.cookie,
        body: { text: "Test: note the PA needs two DI boxes" },
        idempotencyKey: "same-key",
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([200]));
    for (const r of [a, b]) expect([200, 409]).toContain(r.status);
    expect((await find(me, "Notes")).items).toHaveLength(1);
  });
});

describe("budget", () => {
  it("refuses a paid call that would pass the cap less 10%, and settles to the real cost", async () => {
    const budget = env.BUDGET.get(env.BUDGET.idFromName(`budget:test-${crypto.randomUUID()}`));
    const cap = 200_000; // ₹2,000
    const a = await budget.reserve("u1", 100_000, cap, cap);
    expect(a.ok).toBe(true);
    // 100,000 reserved + 90,000 would pass 180,000 (cap less 10%).
    expect((await budget.reserve("u2", 90_000, cap, cap)).ok).toBe(false);
    if (a.ok) await budget.settle(a.id, 1_000);
    const b = await budget.reserve("u2", 90_000, cap, cap);
    expect(b.ok).toBe(true);
    // Per person: u2 has 90,000 reserved of a ₹1,000 personal cap.
    expect(await budget.reserve("u2", 1_000, cap, 100_000)).toEqual({ ok: false, reason: "person_cap" });
    const v = await budget.view(cap);
    expect(v).toMatchObject({ spent_paise: 1_000, reserved_paise: 90_000, cap_paise: cap });
    expect(await budget.neurons(120)).toBe(120);
  });
});

describe("several chats and memory", () => {
  const ulidOf = (n: number) => `01K${String(n).padStart(23, "0")}`;

  it("keeps several chats, names each by its first message, and keeps them private", async () => {
    const me = await signUp("Test Owner");
    const id = ulidOf(1);
    const made = await json<ChatView>(await call("/api/chats", { cookie: me.cookie, body: { id } }));
    expect(made).toMatchObject({ id, title: "New chat", items: [] });
    // A retry with the same id makes no second chat.
    await call("/api/chats", { cookie: me.cookie, body: { id } });

    const sent = await json<ChatView>(
      await call(`/api/chats/${id}`, {
        cookie: me.cookie,
        body: { text: "Test: note the PA needs two DI boxes" },
      }),
    );
    expect(sent.title).toBe("Test: note the PA needs two DI boxes");
    // The main chat didn't get that message.
    expect((await json<ChatView>(await call("/api/chat", { cookie: me.cookie }))).items).toEqual([]);

    const list = await json<{ id: string; title: string }[]>(await call("/api/chats", { cookie: me.cookie }));
    expect(list.map((c) => c.id)).toEqual(["main", id]);

    const other = await signUp("Test Other");
    expect((await call(`/api/chats/${id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(`/api/chats/${ulidOf(2)}`, { cookie: me.cookie })).status).toBe(404);

    await call(`/api/chats/${id}`, { cookie: me.cookie, method: "DELETE" });
    const after = await json<{ id: string }[]>(await call("/api/chats", { cookie: me.cookie }));
    expect(after.map((c) => c.id)).toEqual(["main"]);
  });

  it("remembers what it's asked to, in every chat, until forgotten", async () => {
    const me = await signUp("Test Owner");
    const view = await say(me, "Test: remember weddings are 25000");
    expect(view.items.map((i) => i.text)).toContain("Remembered: Test weddings are ₹25,000 for the band.");
    const mems = await json<{ id: string; text: string; source: string }[]>(
      await call("/api/memories", { cookie: me.cookie }),
    );
    expect(mems).toHaveLength(1);
    expect(mems[0]).toMatchObject({ text: "Test weddings are ₹25,000 for the band." });
    expect(mems[0]!.source).toMatch(/^From a chat, /);

    // Another chat sees it too.
    const id = ulidOf(3);
    await call("/api/chats", { cookie: me.cookie, body: { id } });
    const other = await json<ChatView>(
      await call(`/api/chats/${id}`, { cookie: me.cookie, body: { text: "Test: what do you remember" } }),
    );
    expect(other.items.at(-1)!.text).toBe("I remember.");

    // Someone else's assistant doesn't.
    const stranger = await signUp("Test Stranger");
    expect((await say(stranger, "Test: what do you remember")).items.at(-1)!.text).toBe("Nothing yet.");
    expect(
      (await call(`/api/memories/${mems[0]!.id}`, { cookie: stranger.cookie, method: "DELETE" })).status,
    ).toBe(404);

    await call(`/api/memories/${mems[0]!.id}`, { cookie: me.cookie, method: "DELETE" });
    expect(await json(await call("/api/memories", { cookie: me.cookie }))).toEqual([]);
    expect((await say(me, "Test: what do you remember")).items.at(-1)!.text).toBe("Nothing yet.");
  });
});
