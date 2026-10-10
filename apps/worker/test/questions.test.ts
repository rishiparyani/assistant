// Question cards (chat-first step 4): ask people I know, they answer from Shared with you,
// answers show on the card. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  ChatView,
  CreatedShare,
  QuestionView,
  RecordView,
  SharedQuestionView,
  SharedWithMe,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

/** An owner who knows Rahul and Priya (they joined a shared note). */
async function setUp() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test band note" } } }),
  );
  const { link } = await json<CreatedShare>(
    await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
  );
  const token = link.slice(link.indexOf("#") + 1);
  const rahul = await signUp("Rahul Test");
  const priya = await signUp("Priya Test");
  for (const u of [rahul, priya]) await api(u)("/cards/join", { body: { token } });
  return { owner, rahul, priya };
}

describe("question cards", () => {
  it("asks people, who answer from Shared with you; the owner sees each answer", async () => {
    const { owner, rahul, priya } = await setUp();
    const res = await api(owner)("/questions", {
      body: { text: "Test: free on Saturday?", choices: ["Yes", "No", "Maybe"], people: ["Rahul", "Priya"] },
    });
    expect(res.status).toBe(201);
    const q = await json<QuestionView>(res);
    expect(q.people.map((p) => [p.name, p.answer])).toEqual([
      ["Priya Test", null],
      ["Rahul Test", null],
    ]);

    const mine = await json<SharedWithMe[]>(await api(rahul)("/cards"));
    const s = mine.find((x) => x.kind === "question")!;
    expect(s.title).toBe("Test: free on Saturday?");
    const opened = await json<SharedQuestionView>(await api(rahul)(`/cards/${s.share_id}`));
    expect(opened).toMatchObject({ choices: ["Yes", "No", "Maybe"], mine: null, closed: false });

    // Answers match a choice (any case); anything else is refused.
    expect((await api(rahul)(`/cards/${s.share_id}/answer`, { body: { answer: "Perhaps" } })).status).toBe(
      400,
    );
    const answered = await json<SharedQuestionView>(
      await api(rahul)(`/cards/${s.share_id}/answer`, { body: { answer: "yes" } }),
    );
    expect(answered.mine).toBe("Yes");
    // Changing an answer replaces it.
    await api(rahul)(`/cards/${s.share_id}/answer`, { body: { answer: "Maybe" } });

    const now = await json<QuestionView>(await api(owner)(`/questions/${q.id}`));
    expect(now.people.find((p) => p.name === "Rahul Test")?.answer).toBe("Maybe");
    expect(now.people.find((p) => p.name === "Priya Test")?.answer).toBeNull();

    // Priya can't see Rahul's answer or the owner's question view; strangers get nothing.
    const priyaOpen = await json<SharedQuestionView>(await api(priya)(`/cards/${s.share_id}`));
    expect(priyaOpen.mine).toBeNull();
    expect((await api(priya)(`/questions/${q.id}`)).status).toBe(404);
    const stranger = await signUp("Test Stranger");
    expect((await api(stranger)(`/cards/${s.share_id}/answer`, { body: { answer: "Yes" } })).status).toBe(
      404,
    );
    // A question shares no records.
    expect(
      (
        await api(rahul)(`/cards/${s.share_id}/records`, {
          body: { section: "form", values: { Title: "x" } },
        })
      ).status,
    ).toBe(404);
  });

  it("free answers, and closing stops answers", async () => {
    const { owner, rahul } = await setUp();
    const q = await json<QuestionView>(
      await api(owner)("/questions", { body: { text: "Test: which song first?", people: ["Rahul Test"] } }),
    );
    const answered = await json<SharedQuestionView>(
      await api(rahul)(`/cards/${q.share_id}/answer`, { body: { answer: "Test Song One" } }),
    );
    expect(answered.mine).toBe("Test Song One");
    await api(owner)(`/questions/${q.id}/close`, { body: {} });
    expect((await api(rahul)(`/cards/${q.share_id}/answer`, { body: { answer: "Other" } })).status).toBe(409);
  });

  it("asks from the chat after a tap, and shows a live question card", async () => {
    const { owner, rahul } = await setUp();
    const view = await json<ChatView>(
      await api(owner)("/chat", { body: { text: "Test: ask rahul if they're free" } }),
    );
    const card = view.items.find((i) => i.role === "card")!.card!;
    expect(card.title).toBe("Ask Rahul Test");
    expect(card.details).toEqual(["Test: free on Saturday for the Test Wedding?", "Answers: Yes, No"]);
    expect((await json<SharedWithMe[]>(await api(rahul)("/cards"))).some((s) => s.kind === "question")).toBe(
      false,
    );
    await api(owner)(`/chat/actions/${card.action_id}/confirm`, { body: {} });
    const after = await json<ChatView>(await api(owner)("/chat"));
    const live = after.items.find((i) => i.role === "live" && i.live?.kind === "question");
    expect(live).toBeTruthy();
    expect((await json<SharedWithMe[]>(await api(rahul)("/cards"))).some((s) => s.kind === "question")).toBe(
      true,
    );
  });

  it("puts a question card in a chat without the assistant", async () => {
    const { owner } = await setUp();
    const q = await json<QuestionView>(
      await api(owner)("/questions", {
        body: { text: "Test: lunch?", choices: ["Yes", "No"], people: ["Rahul Test"] },
      }),
    );
    const view = await json<ChatView>(
      await api(owner)("/chats/main/live", { body: { live: { kind: "question", question_id: q.id } } }),
    );
    expect(view.items.at(-1)).toMatchObject({ role: "live", live: { kind: "question", question_id: q.id } });
  });
});
