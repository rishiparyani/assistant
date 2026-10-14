// Chat about this (decision 2026-10-14): a chat about one record, with its people; the record
// is pinned to the chat through a share whose people follow the chat's (money hidden unless
// asked), and taking it off turns the share off. Fake data only.
import { describe, expect, it } from "vitest";
import {
  ulid,
  type CreatedShare,
  type GroupView,
  type RecordChatPlan,
  type RecordView,
  type SharedOpened,
  type SharedWithMe,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** A show with a fee; Asha and Kabir know the owner (they joined a shared note). */
async function band() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test band notes" } } }),
  );
  const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
  const asha = await signUp("Test Asha");
  const kabir = await signUp("Test Kabir");
  for (const u of [asha, kabir]) await api(u)("/cards/join", { body: { token: tokenOf(link) } });
  await api(owner)("/collections", {
    body: {
      name: "Test Shows",
      fields: [
        { name: "Title", type: "text" },
        { name: "Venue", type: "text" },
        { name: "Fee", type: "money" },
        { name: "Player", type: "person" },
      ],
    },
  });
  const plan0 = await json<RecordChatPlan>(await api(owner)(`/records/${note.id}/chat`));
  const ashaId = plan0.people.find((p) => p.name === "Test Asha")!.user_id;
  const show = await json<RecordView>(
    await api(owner)("/collections/Test Shows/records", {
      body: {
        values: {
          Title: "Test Taj night",
          Venue: "Test Taj",
          Fee: 60000,
          Player: { user_id: ashaId, name: "Test Asha" },
        },
      },
    }),
  );
  return { owner, asha, kabir, show, ashaId };
}

const cardsOf = async (u: User) => json<SharedWithMe[]>(await api(u)("/cards"));

describe("chat about a record", () => {
  it("suggests the record's people and hides money", async () => {
    const { owner, show } = await band();
    const plan = await json<RecordChatPlan>(await api(owner)(`/records/${show.id}/chat`));
    expect(plan.record).toMatchObject({ id: show.id, title: "Test Taj night", collection: "Test Shows" });
    expect(plan.people.filter((p) => p.suggested).map((p) => p.name)).toEqual(["Test Asha"]);
    expect(plan.people.map((p) => p.name)).toContain("Test Kabir");
    expect(plan.fields.map((f) => [f.name, f.hidden])).toEqual([
      ["Venue", false],
      ["Fee", true],
      ["Player", false],
    ]);
  });

  it("starts a chat with them, pins the record, and the chat sees it without the fee", async () => {
    const { owner, asha, kabir, show } = await band();
    const id = ulid();
    const g = await json<GroupView>(await api(owner)(`/records/${show.id}/chat`, { body: { chat_id: id } }));
    expect(g).toMatchObject({ id, name: "Test Taj night" });
    expect(g.members.map((m) => m.name).sort()).toEqual(["Test Asha", "Test Owner"]);
    expect(g.cards).toHaveLength(1);
    const shareId = g.cards[0]!.share_id;
    expect(g.messages.at(-1)!.text).toBe("Test Owner pinned “Test Taj night” to this chat");

    // Asha (in the chat) gets it; Kabir (not in it) doesn't.
    expect(await until(async () => (await api(asha)(`/cards/${shareId}`)).status === 200)).toBe(true);
    const opened = await json<SharedOpened & { record: { fields: { name: string }[] } }>(
      await api(asha)(`/cards/${shareId}`),
    );
    expect(opened.record.fields.map((f) => f.name)).not.toContain("Fee");
    expect((await api(kabir)(`/cards/${shareId}`)).status).toBe(404);

    // Kabir joins the chat: the share follows.
    await api(owner)(`/groups/${id}/people`, { body: { people: ["Test Kabir"] } });
    expect(await until(async () => (await api(kabir)(`/cards/${shareId}`)).status === 200)).toBe(true);
    expect((await cardsOf(kabir)).map((c) => c.share_id)).toContain(shareId);

    // Asha leaves: she loses it.
    await api(asha)(`/groups/${id}/leave`, { body: {} });
    expect(await until(async () => (await api(asha)(`/cards/${shareId}`)).status === 404)).toBe(true);
    // In the chat, everyone opens it there, the owner too (it's theirs: one record, no copy).
    const inChat = await json<SharedOpened & { record: { id: string } }>(
      await api(owner)(`/groups/${id}/cards/${shareId}`),
    );
    expect(inChat.record.id).toBe(show.id);
    expect((await api(kabir)(`/groups/${id}/cards/${shareId}`)).status).toBe(200);
    expect((await api(asha)(`/groups/${id}/cards/${shareId}`)).status).toBe(404);
  });

  it("is a retry-safe start, and only admins pin to a chat", async () => {
    const { owner, kabir, show } = await band();
    const id = ulid();
    const key = crypto.randomUUID();
    const send = () =>
      api(owner)(`/records/${show.id}/chat`, {
        body: { chat_id: id, people: ["Test Kabir"] },
        idempotencyKey: key,
      });
    const [a, b] = [await json<GroupView>(await send()), await json<GroupView>(await send())];
    expect(a.cards.map((c) => c.share_id)).toEqual(b.cards.map((c) => c.share_id));
    expect(b.cards).toHaveLength(1);
    // A member who isn't an admin can't take it off, nor pin something of theirs.
    expect(
      (await api(kabir)(`/groups/${id}/cards/${a.cards[0]!.share_id}`, { method: "DELETE" })).status,
    ).toBe(403);
    const theirs = await json<RecordView>(
      await api(kabir)("/collections/Notes/records", { body: { values: { Title: "Test Kabir idea" } } }),
    );
    expect((await api(kabir)(`/records/${theirs.id}/chat`, { body: { chat_id: id } })).status).toBe(403);
    // …and nothing was shared on the way.
    expect(await json<unknown[]>(await api(kabir)(`/shares?record_id=${theirs.id}`))).toEqual([]);
  });

  it("taking it off turns its share off", async () => {
    const { owner, asha, show } = await band();
    const id = ulid();
    const g = await json<GroupView>(await api(owner)(`/records/${show.id}/chat`, { body: { chat_id: id } }));
    const shareId = g.cards[0]!.share_id;
    expect(await until(async () => (await api(asha)(`/cards/${shareId}`)).status === 200)).toBe(true);
    const after = await json<GroupView>(
      await api(owner)(`/groups/${id}/cards/${shareId}`, { method: "DELETE" }),
    );
    expect(after.cards).toEqual([]);
    expect(await until(async () => (await api(asha)(`/cards/${shareId}`)).status === 404)).toBe(true);
    expect((await cardsOf(asha)).map((c) => c.share_id)).not.toContain(shareId);
  });

  it("needs someone to chat with, and the right to share the record", async () => {
    const owner = await signUp("Test Owner");
    const lonely = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test solo" } } }),
    );
    expect((await api(owner)(`/records/${lonely.id}/chat`, { body: { chat_id: ulid() } })).status).toBe(400);
    const stranger = await signUp("Test Stranger");
    expect((await api(stranger)(`/records/${lonely.id}/chat`)).status).toBe(404);
  });
});
