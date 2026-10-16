// The in-app assistant (docs/design/universal.md §10) with the scripted test model
// (src/core/assistant/fake-model.ts): tools run through the operations, money and setups
// wait for a tap, level 1 hands setups over, and the budget keeps the cap. Fake data only.
import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { SpaceObject } from "../src/core/spaces/space-object.ts";
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

const BASE = "http://localhost:8787";
const worker = () => (exports as unknown as { default: Fetcher }).default;

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

  it("tells my open app what it's doing as it goes, never the words", async () => {
    const me = await signUp("Test Owner");
    const res = await worker().fetch(`${BASE}/api/live`, {
      headers: { cookie: me.cookie, origin: BASE, upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const got: Record<string, unknown>[] = [];
    ws.addEventListener("message", (e) => {
      try {
        got.push(JSON.parse(String(e.data)) as Record<string, unknown>);
      } catch {
        // pong
      }
    });
    await say(me, "Test: note the PA needs two DI boxes");
    const until = Date.now() + 5000;
    while (!got.some((m) => m.step === "done") && Date.now() < until)
      await new Promise((r) => setTimeout(r, 50));
    const steps = got.filter((m) => m.type === "assistant_progress").map((m) => [m.step, m.label ?? null]);
    expect(steps[0]).toEqual(["thinking", null]);
    expect(steps).toContainEqual(["tool", "Adding to Notes…"]);
    expect(steps.at(-1)).toEqual(["done", null]);
    // Only the step and a list's name: nothing of what was said.
    expect(JSON.stringify(got)).not.toContain("DI boxes");
    ws.close(1000);
  });

  it("shows a find as a live list card", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Test: note the PA needs two DI boxes");
    const view = await say(me, "Test: show my notes");
    const live = view.items.at(-1)!;
    expect(live.role).toBe("live");
    expect(live.live).toMatchObject({ kind: "list", title: "Notes · “Test”", query: { search: "Test" } });
  });

  it("answers a count with the engine, as a live answer card", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Test: note the PA needs two DI boxes");
    const view = await say(me, "Test: how many notes");
    const live = view.items.at(-1)!;
    expect(live.role).toBe("live");
    expect(live.live).toMatchObject({
      kind: "query",
      space_id: null,
      title: "Test notes",
      query: { measures: [{ fn: "count", as: "Notes" }] },
    });
    // A name that isn't there: the error goes back to the model, no card.
    const bad = await say(me, "Test: notes by month");
    expect(bad.items.at(-1)!.role).not.toBe("live");
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

  it("checks a proposed setup all the way through and makes nothing (a quick add on a link fails now, not on Confirm)", async () => {
    const me = await signUp("Test Owner");
    const spaces = await json<{ id: string }[]>(await call("/api/spaces", { cookie: me.cookie }));
    const stub = env.SPACES.getByName(`space:${spaces[0]!.id}`);
    const actor = { userId: me.id, source: "web" as const };
    const setup = (addFields: string[]) => ({
      collections: [
        {
          id: null,
          name: "Test flats",
          description: null,
          fields: [{ name: "Flat number", type: "text" as const }],
        },
        {
          id: null,
          name: "Test visitors",
          description: null,
          fields: [
            { name: "Visitor name", type: "text" as const },
            { name: "Flat", type: "link" as const, options: { target: "Test flats" } },
            { name: "Phone", type: "text" as const },
          ],
        },
      ],
      rules: [],
      views: [
        { name: "Test guard quick entry", collection: "Test visitors", pinned: true, add_fields: addFields },
      ],
    });
    // The owner's Visitor gate (2026-10-16): the quick add names a link. (Inside the object,
    // so the refusal isn't an unhandled error crossing the test's object boundary.)
    const refusal = await runInDurableObject(stub, async (raw) => {
      const inst = raw as unknown as SpaceObject;
      try {
        await inst.checkSetup(actor, setup(["Visitor name", "Flat", "Phone"]));
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(refusal).toContain("A quick add can't fill in Flat");
    // Without the link it passes, and the check made nothing either way.
    expect(await stub.checkSetup(actor, setup(["Visitor name", "Phone"]))).toEqual({ ok: true });
    const cols = await json<{ name: string }[]>(await call("/api/collections", { cookie: me.cookie }));
    expect(cols.map((c) => c.name)).not.toContain("Test visitors");
    // The real thing still works after the dry runs.
    const made = await json<{ collections: { name: string }[] }>(
      await call("/api/setups", {
        cookie: me.cookie,
        // Over HTTP the schema takes no nulls: names and fields only.
        body: {
          name: "Test visitor gate",
          ...setup(["Visitor name", "Phone"]),
          collections: setup([]).collections.map((c) => ({ name: c.name, fields: c.fields })),
        },
      }),
    );
    expect(made.collections.map((c) => c.name)).toEqual(["Test flats", "Test visitors"]);
  });

  it("lets a setup card be changed by hand before Confirm, never a money card", async () => {
    const me = await signUp("Test Owner");
    // A setup card in the chat (as the smart model, or a shared setup, would leave it).
    const chat = env.CHATS.getByName(`chat:${me.id}`);
    await chat.deliverCard(
      me.id,
      "test-setup-card",
      {
        tool: "create_collection",
        args: {
          name: "Test fam jam sign-ups",
          fields: [
            { name: "Name", type: "text" },
            { name: "Instrument", type: "choice", options: { choices: ["Guitar", "Vocals"] } },
          ],
        },
        title: "Make a collection “Test fam jam sign-ups”",
        details: ["Name (text)", "Instrument (choice)"],
      },
      "A list for the jam?",
      60,
    );
    const view = await json<ChatView>(await call("/api/chat", { cookie: me.cookie }));
    const card = view.items.find((i) => i.role === "card")!.card!;
    expect(card).toMatchObject({ tool: "create_collection", status: "waiting", editable: true });
    const args = card.args as { name: string; fields: { name: string; type: string }[] };
    expect(args.fields.map((f) => f.name)).toContain("Instrument");
    // Renamed and one field more, then confirmed: what's made is the changed version.
    const edited = {
      ...args,
      name: "Test jam list",
      fields: [...args.fields, { name: "Ready", type: "boolean" }],
    };
    const done = await json<ChatView>(
      await call(`/api/chat/actions/${card.action_id}/confirm`, {
        cookie: me.cookie,
        body: { args: edited },
      }),
    );
    const after = done.items.find((i) => i.role === "card")!.card!;
    expect(after.status).toBe("done");
    expect(after.details.join(" ")).toContain("Ready");
    expect(after.editable).toBeUndefined();
    const made = await json<{ name: string; fields: { name: string }[] }>(
      await call("/api/collections/Test jam list", { cookie: me.cookie }),
    );
    expect(made.fields.map((f) => f.name)).toEqual(["Name", "Instrument", "Ready"]);

    // A money card never takes changed arguments: it fails and says so, nothing is added.
    const cards = (await say(me, "Test: spent 450 on groceries")).items.filter((i) => i.role === "card");
    const money = cards[cards.length - 1]!.card!;
    expect(money.editable).toBeUndefined();
    const refused = await json<ChatView>(
      await call(`/api/chat/actions/${money.action_id}/confirm`, {
        cookie: me.cookie,
        body: { args: { values: { Amount: 1 } } },
      }),
    );
    expect(refused.items.find((i) => i.card?.action_id === money.action_id)!.card!.status).toBe("failed");
    expect((await find(me, "Expenses")).items).toEqual([]);
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
    // Newest first; the first chat ("main", everything from before chats) last.
    expect(list.map((c) => c.id)).toEqual([id, "main"]);

    const other = await signUp("Test Other");
    expect((await call(`/api/chats/${id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(`/api/chats/${ulidOf(2)}`, { cookie: me.cookie })).status).toBe(404);

    // Deleting is soft, and a retry with the same key gets the same answer.
    const del = () =>
      call(`/api/chats/${id}`, { cookie: me.cookie, method: "DELETE", idempotencyKey: "test-delete-chat" });
    expect(await json(await del())).toEqual({ deleted: id });
    expect(await json(await del())).toEqual({ deleted: id });
    expect((await call(`/api/chats/${id}`, { cookie: me.cookie })).status).toBe(404);
    const after = await json<{ id: string }[]>(await call("/api/chats", { cookie: me.cookie }));
    expect(after.map((c) => c.id)).toEqual(["main"]);
  });

  it("opens on the current chat: the latest while it's fresh, else a new one", async () => {
    const me = await signUp("Test Owner");
    // Nothing yet: a new, empty chat, and the same one again (it's still empty).
    const first = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    expect(first.items).toEqual([]);
    expect(first.id).not.toBe("main");
    const again = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    expect(again.id).toBe(first.id);
    // Two apps asking at once (a double tap) get the same chat, never two empty ones.
    const other = await signUp("Test Twice");
    const [a, b] = await Promise.all([
      call("/api/chats/current", { cookie: other.cookie }).then((r) => json<ChatView>(r)),
      call("/api/chats/current", { cookie: other.cookie }).then((r) => json<ChatView>(r)),
    ]);
    expect(a.id).toBe(b.id);
    // Used a moment ago: still the current one.
    await call(`/api/chats/${first.id}`, {
      cookie: me.cookie,
      body: { text: "Test: note the PA needs two DI boxes" },
    });
    // The list follows by the chat's own outbox (an alarm): give it a beat.
    await new Promise((r) => setTimeout(r, 300));
    const still = await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }));
    expect(still.id).toBe(first.id);
    expect(still.items.length).toBeGreaterThan(0);
    // A new chat on purpose becomes the current one.
    const fresh = await json<ChatView>(await call("/api/chats", { cookie: me.cookie, body: {} }));
    expect((await json<ChatView>(await call("/api/chats/current", { cookie: me.cookie }))).id).toBe(fresh.id);
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
