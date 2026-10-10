// Bringing people in (chat-first step 4): people I know, and sharing straight with them by
// name (no link). Fake data only.
import { describe, expect, it } from "vitest";
import type {
  ChatView,
  CreatedShare,
  Person,
  RecordView,
  ShareView,
  SharedCardView,
  SharedWithMe,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

async function setUp() {
  const owner = await signUp("Test Owner");
  await api(owner)("/collections", {
    body: {
      name: "Shows",
      fields: [
        { name: "Title", type: "text" },
        { name: "Fee", type: "money" },
        { name: "Notes", type: "long_text" },
      ],
    },
  });
  const add = async (title: string) =>
    json<RecordView>(
      await api(owner)("/collections/Shows/records", {
        body: { values: { Title: title, Fee: "50000", Notes: "Test notes" } },
      }),
    );
  const first = await add("Test Fest");
  // A friend joins one card by link; after that the owner knows them.
  const { link } = await json<CreatedShare>(
    await api(owner)("/shares", { body: { record_id: first.id, access: "view", hide_fields: [] } }),
  );
  const friend = await signUp("Rahul Test");
  await api(friend)("/cards/join", { body: { token: tokenOf(link) } });
  return { owner, friend, add };
}

describe("people I know", () => {
  it("lists people who joined my shares, and only for me", async () => {
    const { owner, friend } = await setUp();
    const people = await json<Person[]>(await api(owner)("/people"));
    expect(people).toEqual([{ user_id: friend.id, name: "Rahul Test" }]);
    // The friend's own list doesn't include the owner (they shared nothing).
    expect(await json<Person[]>(await api(friend)("/people"))).toEqual([]);
  });

  it("shares straight with them by first name, money hidden by default", async () => {
    const { owner, friend, add } = await setUp();
    const second = await add("Test Wedding");
    const res = await api(owner)("/shares/with", {
      body: { record_id: second.id, people: ["rahul"], access: "edit" },
    });
    expect(res.status).toBe(201);
    const share = await json<ShareView>(res);
    expect(share.hidden_fields.map((f) => f.name)).toEqual(["Fee"]);
    expect(share.people.map((p) => p.name)).toEqual(["Rahul Test"]);

    const mine = await json<SharedWithMe[]>(await api(friend)("/cards"));
    expect(mine.map((s) => s.title)).toContain("Test Wedding");
    const card = await json<SharedCardView>(await api(friend)(`/cards/${share.id}`));
    expect(card.record.fields.map((f) => f.name)).not.toContain("Fee");
  });

  it("never guesses: unknown names list who I know, shared first names give candidates", async () => {
    const { owner, add } = await setUp();
    const rec = await add("Test Party");
    const unknown = await api(owner)("/shares/with", { body: { record_id: rec.id, people: ["Priya"] } });
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(await unknown.json())).toContain("Rahul Test");

    // A second Rahul joins something: "Rahul" is now ambiguous.
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: rec.id, access: "view" } }),
    );
    const other = await signUp("Rahul Other");
    await api(other)("/cards/join", { body: { token: tokenOf(link) } });
    const twice = await api(owner)("/shares/with", { body: { record_id: rec.id, people: ["Rahul"] } });
    expect(twice.status).toBe(409);
    const body = (await twice.json()) as { error: { code: string; details?: { candidates: unknown[] } } };
    expect(body.error.code).toBe("ambiguous");
  });

  it("adds people I know to an existing share; strangers can't be added", async () => {
    const { owner, friend, add } = await setUp();
    const rec = await add("Test Gig");
    const { share } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: rec.id, access: "view" } }),
    );
    const added = await api(owner)(`/shares/${share.id}/people`, { body: { people: ["Rahul Test"] } });
    expect(added.status).toBe(200);
    expect((await json<ShareView>(added)).people.map((p) => p.user_id)).toEqual([friend.id]);
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(200);

    const stranger = await signUp("Test Stranger");
    const no = await api(owner)(`/shares/${share.id}/people`, { body: { people: [stranger.id] } });
    expect(no.status).toBe(404);
    // And a friend can't add people to the owner's share.
    expect(
      (await api(friend)(`/shares/${share.id}/people`, { body: { people: ["Test Owner"] } })).status,
    ).toBe(404);
  });

  it("shares from the chat with a card that names the people, after a tap", async () => {
    const { owner, friend, add } = await setUp();
    const rec = await add("Test Sangeet");
    const view = await json<ChatView>(
      await api(owner)("/chat", { body: { text: `Test: share ${rec.id} with rahul` } }),
    );
    const card = view.items.find((i) => i.role === "card")!.card!;
    expect(card.title).toBe("Share “Test Sangeet” (Shows) with Rahul Test");
    expect(card.details).toEqual(["They can edit", "Money stays hidden"]);
    // Nothing shared until the tap.
    expect((await json<SharedWithMe[]>(await api(friend)("/cards"))).map((s) => s.title)).not.toContain(
      "Test Sangeet",
    );
    expect((await api(owner)(`/chat/actions/${card.action_id}/confirm`, { body: {} })).status).toBe(200);
    expect((await json<SharedWithMe[]>(await api(friend)("/cards"))).map((s) => s.title)).toContain(
      "Test Sangeet",
    );
  });

  it("keeps the person picked by id on the chat card, even when two share a name", async () => {
    const { owner, add } = await setUp();
    const rec = await add("Test Mehendi");
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: rec.id, access: "view" } }),
    );
    // Two people both called "Test Twin".
    const a = await signUp("Test Twin");
    const b = await signUp("Test Twin");
    for (const u of [a, b]) await api(u)("/cards/join", { body: { token: tokenOf(link) } });
    const other = await add("Test Haldi");
    const view = await json<ChatView>(
      await api(owner)("/chat", { body: { text: `Test: share ${other.id} with ${b.id}` } }),
    );
    const card = view.items.find((i) => i.role === "card")!.card!;
    expect(card.title).toBe("Share “Test Haldi” (Shows) with Test Twin");
    expect((await api(owner)(`/chat/actions/${card.action_id}/confirm`, { body: {} })).status).toBe(200);
    const seen = async (u: User) =>
      (await json<SharedWithMe[]>(await api(u)("/cards"))).some((s) => s.title === "Test Haldi");
    expect(await seen(b)).toBe(true);
    expect(await seen(a)).toBe(false);
  });
});
