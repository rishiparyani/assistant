// The person's own conversations with the assistant are in their search (owner, 2026-10-17):
// only theirs, named by the conversation's title, and gone once the conversation is deleted.
// Fake data and the scripted test model only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { call, json, signUp } from "./http.ts";

type Hit = { kind: string; chat?: string; chat_id?: string; snippet: string };
const search = async (cookie: string, q: string) =>
  json<Hit[]>(await call(`/api/search?q=${encodeURIComponent(q)}`, { cookie }));
/** The conversation's background job: its words go into the person's index. */
const index = async (name: string) => {
  const stub = env.CHATS.getByName(name);
  // The alarm may already have run by itself; running it again is harmless.
  await runDurableObjectAlarm(stub);
};

describe("searching my conversations with the assistant", () => {
  it("finds what I said, only for me, until the conversation is deleted", async () => {
    const me = await signUp("Test Owner");
    await call("/api/chat", { cookie: me.cookie, body: { text: "Test: the gatekeepxyz visitor book" } });
    await index(`chat:${me.id}`);
    const found = await search(me.cookie, "gatekeepxyz");
    expect(found).toContainEqual(
      expect.objectContaining({ kind: "conversation", chat_id: "main", chat: "Your main chat" }),
    );

    // Nobody else finds it.
    const other = await signUp("Test Friend");
    expect(await search(other.cookie, "gatekeepxyz")).toEqual([]);

    // Another conversation, named by its title; deleting it takes it out of search.
    const chat = await json<{ id: string }>(await call("/api/chats", { cookie: me.cookie, body: {} }));
    await call(`/api/chats/${chat.id}`, {
      cookie: me.cookie,
      body: { text: "Test: plan the orchidqqq repairs" },
    });
    await index(`chat:${me.id}:${chat.id}`);
    const hits = await search(me.cookie, "orchidqqq");
    expect(hits).toContainEqual(expect.objectContaining({ kind: "conversation", chat_id: chat.id }));
    expect(hits.find((h) => h.chat_id === chat.id)!.chat).toMatch(/orchidqqq/);
    expect((await call(`/api/chats/${chat.id}`, { cookie: me.cookie, method: "DELETE" })).status).toBe(200);
    expect((await search(me.cookie, "orchidqqq")).filter((h) => h.kind === "conversation")).toEqual([]);
  });
});
