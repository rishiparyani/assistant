// Topics (decision 2026-10-31 "Topics"): threads inside a chat, each with its own messages; the
// assistant asked from a topic reads only that topic. Fake data only.
import { describe, expect, it } from "vitest";
import { ulid, type CreatedShare, type GroupView, type RecordView } from "@assistant/shared";
import { fakeSystems } from "../src/core/assistant/fake-model.ts";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

/** The owner and Asha know each other (a shared note) and share a chat for two. */
async function pair() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test notes" } } }),
  );
  const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
  const asha = await signUp("Test Asha");
  await api(asha)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
  const g = await json<GroupView>(
    await api(owner)("/groups", { body: { id: ulid(), name: "", people: ["Test Asha"], direct: true } }),
  );
  return { owner, asha, g };
}

describe("topics", () => {
  it("keep their own messages, apart from General, and close and reopen", async () => {
    const { owner, asha, g } = await pair();
    await api(owner)(`/groups/${g.id}/messages`, { body: { text: "Test hello in General" } });
    const made = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/topics`, { body: { name: "Test Pune show, 14 Nov" } }),
    );
    const topic = made.topics.find((t) => t.name === "Test Pune show, 14 Nov")!;
    expect(made.topic).toBe(topic.id);
    await api(asha)(`/groups/${g.id}/messages`, { body: { text: "Test fee is 8000", topic_id: topic.id } });

    // In the topic: only its messages. In General: not them, and a note that it started.
    const inTopic = await json<GroupView>(await api(asha)(`/groups/${g.id}?topic=${topic.id}`));
    expect(inTopic.messages.map((m) => m.text)).toEqual(["Test fee is 8000"]);
    const general = await json<GroupView>(await api(asha)(`/groups/${g.id}`));
    expect(general.messages.map((m) => m.text)).toContain("Test hello in General");
    expect(general.messages.map((m) => m.text)).not.toContain("Test fee is 8000");
    expect(general.messages.some((m) => m.text.includes("started the topic"))).toBe(true);
    expect(general.topics).toMatchObject([{ id: topic.id, messages: 1, closed: false }]);
    // The same name twice is refused while the first is open.
    expect(
      (await api(asha)(`/groups/${g.id}/topics`, { body: { name: "test pune show, 14 nov" } })).status,
    ).toBe(409);

    // Closed: folded away, can't be written in until it's reopened (either person, in a chat for two).
    await api(asha)(`/groups/${g.id}/topics/${topic.id}/closed`, { body: { closed: true } });
    expect(
      (await api(owner)(`/groups/${g.id}/messages`, { body: { text: "Test late", topic_id: topic.id } }))
        .status,
    ).toBe(409);
    await api(owner)(`/groups/${g.id}/topics/${topic.id}/closed`, { body: { closed: false } });
    expect(
      (await api(owner)(`/groups/${g.id}/messages`, { body: { text: "Test late", topic_id: topic.id } }))
        .status,
    ).toBe(200);

    // Someone outside the chat can't see or start topics.
    const outsider = await signUp("Test Outsider");
    expect((await api(outsider)(`/groups/${g.id}?topic=${topic.id}`)).status).toBe(404);
    expect((await api(outsider)(`/groups/${g.id}/topics`, { body: { name: "Test nope" } })).status).toBe(404);
  });

  it("the assistant asked from a topic reads that topic only", async () => {
    const { owner, asha, g } = await pair();
    await api(asha)(`/groups/${g.id}/messages`, { body: { text: "Test General chatter" } });
    const made = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/topics`, { body: { name: "Test Goa show" } }),
    );
    await api(asha)(`/groups/${g.id}/messages`, {
      body: { text: "Test Goa travel is by train", topic_id: made.topic },
    });
    fakeSystems.length = 0;
    const r = await api(owner)(`/groups/${g.id}/assistant`, {
      body: { text: "What's the plan?", topic: made.topic },
    });
    expect(r.status).toBe(200);
    const system = fakeSystems.at(-1)!;
    expect(system).toContain('the topic "Test Goa show"');
    expect(system).toContain("Test Goa travel is by train");
    expect(system).not.toContain("Test General chatter");
  });

  it("a search hit inside a topic opens that topic, and an answer shared from a topic lands there", async () => {
    const { owner, asha, g } = await pair();
    const until = async (check: () => Promise<boolean>, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await check()) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    const made = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/topics`, { body: { name: "Test Kochi show" } }),
    );
    // General, then the topic, a moment apart: two pieces of conversation, one per topic.
    await api(asha)(`/groups/${g.id}/messages`, { body: { text: "Test lunch at one" } });
    await api(asha)(`/groups/${g.id}/messages`, {
      body: { text: "Test sound check is at Test Marigold hall", topic_id: made.topic },
    });
    type Hit = { kind: string; message_id?: string; snippet: string };
    const marigold = async () =>
      (await json<Hit[]>(await api(owner)(`/search?q=${encodeURIComponent("Marigold")}&limit=12`))).find(
        (h) => h.kind === "message" && h.snippet.includes("Marigold"),
      );
    expect(await until(async () => !!(await marigold()))).toBe(true);
    const hit = (await marigold())!;
    const around = await json<GroupView>(await api(owner)(`/groups/${g.id}?around=${hit.message_id}`));
    expect(around.topic).toBe(made.topic);
    expect(around.messages.map((m) => m.text)).toContain("Test sound check is at Test Marigold hall");

    // Asked from the topic, shared from the topic: it lands in the topic, not General.
    const asked = await json<{ items: { id: string; role: string }[] }>(
      await api(owner)(`/groups/${g.id}/assistant`, {
        body: { text: "Where's the check?", topic: made.topic },
      }),
    );
    const answer = asked.items.filter((i) => i.role === "assistant").at(-1)!;
    const shared = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/share`, { body: { item_id: answer.id, topic: made.topic } }),
    );
    expect(shared.topic).toBe(made.topic);
    expect(shared.messages.some((m) => m.kind === "assistant")).toBe(true);
    const general = await json<GroupView>(await api(owner)(`/groups/${g.id}`));
    expect(general.messages.some((m) => m.kind === "assistant")).toBe(false);
  });

  it("a question asked of everyone inside a topic stays in that topic", async () => {
    const { owner, g } = await pair();
    const made = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/topics`, { body: { name: "Test Jaipur show" } }),
    );
    const asked = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/polls`, {
        body: { question: "Test train or flight?", options: ["Train", "Flight"], topic_id: made.topic },
      }),
    );
    expect(asked.topic).toBe(made.topic);
    expect(asked.messages.map((m) => m.text)).toContain("Test train or flight?");
    const general = await json<GroupView>(await api(owner)(`/groups/${g.id}`));
    expect(general.messages.map((m) => m.text)).not.toContain("Test train or flight?");
  });
});
