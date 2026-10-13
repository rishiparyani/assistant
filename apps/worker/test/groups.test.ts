// Group chats (chat-first step 7): people I know talk together; the assistant answers only
// when someone with assistant access writes @assistant. Fake data only.
import { describe, expect, it } from "vitest";
import {
  ulid,
  type ChatPerson,
  type CreatedShare,
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

  it("answers @assistant for people who have it, and refuses others", async () => {
    const { owner, dev } = await setUp();
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Band", people: ["Test Dev"] } }),
    );
    // Dev has no assistant: the message isn't sent, and says why.
    const no = await api(dev)(`/groups/${g.id}/messages`, { body: { text: "@assistant what's on?" } });
    expect(no.status).toBe(403);
    const view = await json<GroupView>(await api(dev)(`/groups/${g.id}`));
    expect(view.can_ask).toBe(false);
    expect(view.messages.some((m) => m.text.includes("what's on"))).toBe(false);
    // The owner asks: the answer is posted for everyone, from the owner's assistant.
    const asked = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/messages`, { body: { text: "@assistant what's on?" } }),
    );
    expect(asked.can_ask).toBe(true);
    const last = asked.messages.at(-1)!;
    expect(last.kind).toBe("assistant");
    expect(last.author).toBe("Assistant (asked by Test Owner)");
    expect(last.text.length).toBeGreaterThan(0);
    // A repeat of the same send posts nothing twice.
    const again = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/messages`, {
        body: { text: "@assistant again" },
        idempotencyKey: "k-group",
      }),
    );
    const twice = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/messages`, {
        body: { text: "@assistant again" },
        idempotencyKey: "k-group",
      }),
    );
    expect(twice.messages.length).toBe(again.messages.length);
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
  });
});
