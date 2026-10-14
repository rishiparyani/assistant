// Group chats (chat-first step 7): people I know talk together; the assistant answers only
// when someone with assistant access writes @assistant. Fake data only.
import { describe, expect, it } from "vitest";
import {
  ulid,
  type ChatPerson,
  type ChatView,
  type CreatedShare,
  type SaveProposal,
  type GroupSummary,
  type GroupView,
  type RecordView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

/** The owner shares a note; Dev joins it, so the owner knows Dev. */
async function setUp() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test setlist" } } }),
  );
  const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
  const dev = await signUp("Test Dev", undefined, { assistant: false });
  await api(dev)("/cards/join", { body: { token: tokenOf(link) } });
  const outsider = await signUp("Test Outsider");
  return { owner, dev, outsider };
}

describe("group chats", () => {
  it("lets members talk, and keeps everyone else out", async () => {
    const { owner, dev, outsider } = await setUp();
    const made = await api(owner)("/groups", {
      body: { id: ulid(), name: "Test Band", people: ["Test Dev"] },
    });
    expect(made.status).toBe(201);
    const g = await json<GroupView>(made);
    expect(g.members.map((m) => [m.name, m.role])).toEqual([
      ["Test Owner", "owner"],
      ["Test Dev", "member"],
    ]);
    // A retry makes no second group; a different group can't take the same id.
    const again = await api(owner)("/groups", {
      body: { id: g.id, name: "Test Band", people: ["Test Dev"] },
    });
    expect((await json<GroupView>(again)).id).toBe(g.id);
    expect((await api(owner)("/groups", { body: { id: g.id, name: "Test Other" } })).status).toBe(409);
    expect(await json<GroupSummary[]>(await api(owner)("/groups"))).toHaveLength(1);
    // Dev sees it in their list and writes.
    const list = await json<GroupSummary[]>(await api(dev)("/groups"));
    expect(list.map((x) => x.name)).toEqual(["Test Band"]);
    const sent = await api(dev)(`/groups/${g.id}/messages`, { body: { text: "Test rehearsal at 6?" } });
    expect(sent.status).toBe(200);
    const seen = await json<GroupView>(await api(owner)(`/groups/${g.id}`));
    expect(seen.messages.filter((m) => m.kind === "person").map((m) => [m.author, m.text])).toEqual([
      ["Test Dev", "Test rehearsal at 6?"],
    ]);
    // Someone outside gets nothing, and can't write.
    expect((await api(outsider)(`/groups/${g.id}`)).status).toBe(404);
    expect((await api(outsider)(`/groups/${g.id}/messages`, { body: { text: "Test hello" } })).status).toBe(
      404,
    );
    // Only people I know can be added.
    expect(
      (await api(owner)(`/groups/${g.id}/people`, { body: { people: ["Test Outsider"] } })).status,
    ).not.toBe(200);
    // Leaving takes it off Dev's list.
    expect((await api(dev)(`/groups/${g.id}/leave`, { body: {} })).status).toBe(200);
    expect(await json<GroupSummary[]>(await api(dev)("/groups"))).toEqual([]);
    expect((await api(dev)(`/groups/${g.id}`)).status).toBe(404);
  });

  it("asks my assistant privately, and shares an answer only when I choose", async () => {
    const { owner, dev, outsider } = await setUp();
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Band", people: ["Test Dev"] } }),
    );
    // @assistant in the chat is just words now: nothing answers in the group.
    const plain = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/messages`, { body: { text: "@assistant what's on?" } }),
    );
    expect(plain.messages.filter((m) => m.kind === "assistant")).toEqual([]);
    // The owner asks privately: the answer is in the owner's own chat, not the group.
    const chat = await json<ChatView>(
      await api(owner)(`/groups/${g.id}/assistant`, { body: { text: "What's on this week?" } }),
    );
    const answer = chat.items.filter((i) => i.role === "assistant").at(-1)!;
    expect(answer.text.length).toBeGreaterThan(0);
    expect(
      (await json<GroupView>(await api(dev)(`/groups/${g.id}`))).messages.some((m) => m.kind === "assistant"),
    ).toBe(false);
    expect((await json<ChatView>(await api(owner)(`/groups/${g.id}/assistant`))).items.length).toBe(
      chat.items.length,
    );
    // Sharing posts it for everyone, once, as the owner's.
    for (let n = 0; n < 2; n++)
      expect((await api(owner)(`/groups/${g.id}/share`, { body: { item_id: answer.id } })).status).toBe(200);
    const shared = (await json<GroupView>(await api(dev)(`/groups/${g.id}`))).messages.filter(
      (m) => m.kind === "assistant",
    );
    expect(shared.map((m) => [m.author, m.text])).toEqual([
      ["Assistant (shared by Test Owner)", answer.text],
    ]);
    // Remembered for good (not just a day), and shown to me as shared.
    expect((await json<GroupView>(await api(owner)(`/groups/${g.id}`))).shared_answers).toEqual([answer.id]);
    // A group id is a ULID, so it can never be the id of my own first chat ("main").
    expect((await api(owner)("/groups", { body: { id: "main", name: "Test Main" } })).status).toBe(400);
    // Only a real answer from my own chat can be shared; Dev (no assistant) can't ask; outsiders get 404.
    expect((await api(owner)(`/groups/${g.id}/share`, { body: { item_id: "nope" } })).status).toBe(404);
    expect((await api(dev)(`/groups/${g.id}/assistant`, { body: { text: "Hi" } })).status).toBe(403);
    expect((await api(outsider)(`/groups/${g.id}/assistant`)).status).toBe(404);
    expect((await api(outsider)(`/groups/${g.id}/share`, { body: { item_id: answer.id } })).status).toBe(404);
  });

  it("keeps one chat per pair, from either side, and counts what's unread", async () => {
    const { owner, dev, outsider } = await setUp();
    // Dev knows the owner because the owner shared with Dev; the outsider knows nobody.
    const devKnows = await json<ChatPerson[]>(await api(dev)("/chat-people"));
    expect(devKnows.map((p) => p.name)).toEqual(["Test Owner"]);
    expect(await json<ChatPerson[]>(await api(outsider)("/chat-people"))).toEqual([]);
    expect(
      (await api(outsider)("/groups", { body: { id: ulid(), direct: true, people: ["Test Owner"] } })).status,
    ).not.toBe(201);

    const first = await json<GroupView>(
      await api(dev)("/groups", { body: { id: ulid(), direct: true, people: ["Test Owner"] } }),
    );
    expect([first.direct, first.name]).toEqual([true, "Test Owner"]);
    // The owner starting it too (with their own new id) opens the same chat, named after Dev.
    const second = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), direct: true, people: ["Test Dev"] } }),
    );
    expect([second.id, second.name]).toEqual([first.id, "Test Dev"]);
    expect((await json<GroupSummary[]>(await api(owner)("/groups"))).map((g) => g.id)).toEqual([first.id]);
    // A chat for two names one person, and stays two.
    expect(
      (await api(dev)("/groups", { body: { id: ulid(), direct: true, people: ["Test Owner", "Test Dev"] } }))
        .status,
    ).toBe(400);
    expect((await api(dev)(`/groups/${first.id}/people`, { body: { people: ["Test Owner"] } })).status).toBe(
      409,
    );
    expect((await api(dev)(`/groups/${first.id}/leave`, { body: {} })).status).toBe(409);

    // Two messages from Dev are unread for the owner, not for Dev; reading clears them.
    for (const text of ["Test free on Friday?", "Test 8 pm"])
      await api(dev)(`/groups/${first.id}/messages`, { body: { text } });
    const unread = async (u: User) =>
      (await json<GroupSummary[]>(await api(u)("/groups"))).find((g) => g.id === first.id)!.unread;
    expect(await unread(owner)).toBe(2);
    expect(await unread(dev)).toBe(0);
    expect((await api(owner)(`/groups/${first.id}/read`, { body: {} })).status).toBe(200);
    expect(await unread(owner)).toBe(0);
    expect((await api(outsider)(`/groups/${first.id}/read`, { body: {} })).status).toBe(404);

    // In a group, what was said before someone (re)joined isn't unread for them; what comes after is.
    const duo = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Duo", people: ["Test Dev"] } }),
    );
    const duoUnread = async () =>
      (await json<GroupSummary[]>(await api(dev)("/groups"))).find((g) => g.id === duo.id)?.unread;
    await api(owner)(`/groups/${duo.id}/messages`, { body: { text: "Test hello" } });
    expect(await duoUnread()).toBe(1);
    await api(dev)(`/groups/${duo.id}/leave`, { body: {} });
    await api(owner)(`/groups/${duo.id}/messages`, { body: { text: "Test while you were out" } });
    await api(owner)(`/groups/${duo.id}/people`, { body: { people: ["Test Dev"] } });
    expect(await duoUnread()).toBe(0);
  });

  it("saves a message only after a tap, and marks it saved for the saver alone", async () => {
    const { owner, dev, outsider } = await setUp();
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Band", people: ["Test Dev"] } }),
    );
    await api(dev)(`/groups/${g.id}/messages`, { body: { text: "Test PA needs two DI boxes" } });
    const msg = (await json<GroupView>(await api(owner)(`/groups/${g.id}`))).messages.find(
      (m) => m.kind === "person",
    )!;
    // The owner's assistant proposes; nothing is saved yet.
    const res = await api(owner)(`/groups/${g.id}/messages/${msg.id}/save`, { body: {} });
    expect(res.status).toBe(200);
    const proposal = await json<SaveProposal>(res);
    const card = proposal.items.find((i) => i.card)?.card;
    expect([card?.tool, card?.status]).toEqual(["add_record", "waiting"]);
    const notes = async () =>
      (await json<{ items: { title: string }[] }>(await api(owner)("/collections/Notes/find", { body: {} })))
        .items;
    expect((await notes()).some((r) => r.title === "Test PA needs two DI boxes")).toBe(false);
    // It waits in the owner's own chat about the group; the tap saves it.
    const chat = await json<ChatView>(await api(owner)(`/chats/${proposal.chat_id}`));
    expect(chat.items.some((i) => i.card?.action_id === card!.action_id)).toBe(true);
    expect(
      (await api(owner)(`/chats/${proposal.chat_id}/actions/${card!.action_id}/confirm`, { method: "POST" }))
        .status,
    ).toBe(200);
    expect((await notes()).some((r) => r.title === "Test PA needs two DI boxes")).toBe(true);
    // "Saved to Notes" shows for the owner, not for Dev.
    await api(owner)(`/groups/${g.id}/messages/${msg.id}/saved`, { body: { label: "Notes" } });
    expect((await json<GroupView>(await api(owner)(`/groups/${g.id}`))).saved).toEqual({ [msg.id]: "Notes" });
    expect((await json<GroupView>(await api(dev)(`/groups/${g.id}`))).saved).toEqual({});
    // Without the assistant (Dev) it's refused (the phone offers the Inbox); outsiders get 404.
    expect((await api(dev)(`/groups/${g.id}/messages/${msg.id}/save`, { body: {} })).status).toBe(403);
    expect((await api(outsider)(`/groups/${g.id}/messages/${msg.id}/save`, { body: {} })).status).toBe(404);
    const stranger = await signUp("Test Stranger", undefined, { assistant: false });
    expect((await api(stranger)(`/groups/${g.id}/messages/${msg.id}/save`, { body: {} })).status).toBe(404);
    expect(
      (await api(outsider)(`/groups/${g.id}/messages/${msg.id}/saved`, { body: { label: "Test" } })).status,
    ).toBe(404);
  });

  it("finds chat messages in search, for the people in the chat only", async () => {
    const { owner, dev, outsider } = await setUp();
    const until = async (check: () => Promise<boolean>, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await check()) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    type Hit = { kind: string; chat?: string; group_id?: string; snippet: string };
    const search = async (u: User, q: string) =>
      (await json<Hit[]>(await api(u)(`/search?q=${encodeURIComponent(q)}&limit=12`))).filter(
        (h) => h.kind === "message",
      );
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Band", people: ["Test Dev"] } }),
    );
    await api(dev)(`/groups/${g.id}/messages`, { body: { text: "Can we do 12 Dec at Test Taj?" } });
    await api(owner)(`/groups/${g.id}/messages`, { body: { text: "They offered sixty thousand" } });
    // Both find it (one piece of conversation, named as each sees the chat); nobody else does.
    expect(await until(async () => (await search(owner, "Test Taj")).length === 1)).toBe(true);
    expect((await search(owner, "Test Taj"))[0]).toMatchObject({
      kind: "message",
      chat: "Test Band",
      group_id: g.id,
    });
    expect(await until(async () => (await search(dev, "sixty")).length === 1)).toBe(true);
    expect(await search(outsider, "Test Taj")).toEqual([]);
    // A hit opens the chat around its message.
    const hit = (
      await json<{ message_id: string }[]>(await api(owner)(`/search?q=Test%20Taj&limit=12`))
    ).find((h) => "message_id" in h)!;
    const around = await json<GroupView>(await api(owner)(`/groups/${g.id}?around=${hit.message_id}`));
    expect(around.messages.some((m) => m.id === hit.message_id)).toBe(true);
    // Leaving the chat takes it out of Dev's results.
    await api(dev)(`/groups/${g.id}/leave`, { body: {} });
    expect(await until(async () => (await search(dev, "Test Taj")).length === 0)).toBe(true);
    expect((await search(owner, "Test Taj")).length).toBe(1);
  });

  it("asks everyone a question: one answer each, changeable, seen by all", async () => {
    const { owner, dev, outsider } = await setUp();
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Band", people: ["Test Dev"] } }),
    );
    const made = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/polls`, { body: { question: "Free on Sat 12 Dec for Test Taj?" } }),
    );
    const poll = made.messages.find((m) => m.kind === "poll")!;
    expect(made.polls[poll.id]).toMatchObject({ options: ["Yes", "No", "Maybe"], mine: null });
    const vote = (u: User, option: string | null) =>
      api(u)(`/groups/${g.id}/polls/${poll.id}/vote`, { body: { option } });
    expect((await vote(owner, "Yes")).status).toBe(200);
    expect((await vote(dev, "Maybe")).status).toBe(200);
    expect((await vote(dev, "Yes")).status).toBe(200); // changes Dev's answer
    const seen = (await json<GroupView>(await api(dev)(`/groups/${g.id}`))).polls[poll.id]!;
    expect(seen.votes).toEqual([
      { option: "Yes", people: ["Test Owner", "Test Dev"] },
      { option: "No", people: [] },
      { option: "Maybe", people: [] },
    ]);
    expect(seen.mine).toBe("Yes");
    // Taking it back, a made-up answer, and someone outside.
    expect((await vote(owner, null)).status).toBe(200);
    expect((await json<GroupView>(await api(owner)(`/groups/${g.id}`))).polls[poll.id]!.mine).toBeNull();
    expect((await vote(dev, "Perhaps")).status).toBe(400);
    expect((await vote(outsider, "Yes")).status).toBe(404);
    // Its own answers too (they must differ).
    expect(
      (
        await api(owner)(`/groups/${g.id}/polls`, {
          body: { question: "Test which set?", options: ["A", "a"] },
        })
      ).status,
    ).toBe(400);
  });
});
