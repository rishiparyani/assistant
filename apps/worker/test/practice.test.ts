// Practice copies (decision 2026-10-16 "Rehearse a workflow", second part): a copy of a space
// where workflows run for real but nothing reaches anyone; the owner answers as each person.
// Fake data only.
import { describe, expect, it } from "vitest";
import type {
  CreatedShare,
  PracticeAsView,
  PracticeView,
  SharedOpened,
  RecordView,
  SpaceView,
  WorkflowDetail,
  WorkflowView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
type Inbox = { items: { title: string; body: string | null }[] };
const inbox = async (u: User) => (await json<Inbox>(await api(u)("/me/notifications"))).items;
async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe("practice copies", () => {
  it("runs workflows for real with nothing reaching anyone, answers as each person, and ends clean", async () => {
    const owner = await signUp("Test Owner");
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test note" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    const rahul = await signUp("Rahul Test");
    await api(rahul)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    await api(owner)("/collections", {
      body: {
        name: "Dinners",
        fields: [
          { name: "Title", type: "text" },
          { name: "Reply", type: "text" },
        ],
      },
    });
    const wf = await json<WorkflowView>(
      await api(owner)("/workflows", {
        body: {
          name: "Confirm the dinner",
          when: { event: "added", collection: "Dinners" },
          then: [
            {
              do: "ask",
              who: ["Rahul"],
              text: "Can you come to {Title}?",
              choices: ["Yes", "No"],
              save_to: "Reply",
            },
            { do: "notify", text: "Rahul said {Reply} to {Title}", to: ["me"] },
          ],
          enabled: false,
        },
      }),
    );
    await api(owner)("/collections/Dinners/records", { body: { values: { Title: "Test real dinner" } } });

    // The copy: a space of the owner's, marked as practice, with the list, its record and the workflow (on).
    const res = await api(owner)("/spaces/Personal/practice", { body: {} });
    expect(res.status).toBe(201);
    const practice = await json<SpaceView>(res);
    expect(practice).toMatchObject({ name: "Practice: Personal", practice_of: expect.any(String) });
    const spaces = await json<SpaceView[]>(await api(owner)("/spaces"));
    expect(spaces.find((s) => s.id === practice.id)?.practice_of).toBe(
      spaces.find((s) => s.kind === "personal")!.id,
    );
    const copied = await json<{ items: RecordView[] }>(
      await api(owner)(`/collections/Dinners/find`, { body: { space: practice.id } }),
    );
    expect(copied.items.map((r) => r.title)).toEqual(["Test real dinner"]);

    // A record added in the copy runs the workflow: Rahul is asked in the practice log only.
    await api(owner)("/collections/Dinners/records", {
      body: { space: practice.id, values: { Title: "Test practice dinner" } },
    });
    const view = async () => json<PracticeView>(await api(owner)(`/spaces/${practice.id}/practice`));
    expect(await until(async () => (await view()).waiting.length === 1)).toBe(true);
    let v = await view();
    expect(v.waiting[0]).toMatchObject({
      text: "Can you come to Test practice dinner?",
      on: [{ name: "Rahul Test" }],
    });
    expect(
      await until(async () =>
        (await view()).log.some((l) => l.kind === "question" && l.name === "Rahul Test"),
      ),
    ).toBe(true);
    expect((await inbox(rahul)).some((n) => n.body?.includes("Test practice dinner"))).toBe(false);

    // The owner answers as Rahul: the run goes on, and the message to the owner lands in the log.
    v = await view();
    const rahulId = v.waiting[0]!.on[0]!.user_id;
    const answered = await api(owner)(`/spaces/${practice.id}/practice/answer`, {
      body: { wait_id: v.waiting[0]!.id, as_user_id: rahulId, answer: "Yes" },
    });
    expect(answered.status).toBe(200);
    expect(
      await until(async () =>
        (await view()).log.some(
          (l) => l.kind === "message" && l.body === "Rahul said Yes to Test practice dinner",
        ),
      ),
    ).toBe(true);
    expect((await inbox(owner)).some((n) => n.body?.includes("Test practice dinner"))).toBe(false);

    // Nothing can be shared out of a practice copy.
    const record = (
      await json<{ items: RecordView[] }>(
        await api(owner)(`/collections/Dinners/find`, { body: { space: practice.id } }),
      )
    ).items[0]!;
    expect(
      (await api(owner)("/shares", { body: { space: practice.id, record_id: record.id, access: "view" } }))
        .status,
    ).toBe(400);

    // The real space is untouched: its workflow is still off and never ran.
    const real = await json<WorkflowDetail>(await api(owner)(`/workflows/${wf.id}`));
    expect(real.workflow).toMatchObject({ enabled: false, runs: 0 });
    const realRecords = await json<{ items: RecordView[] }>(
      await api(owner)(`/collections/Dinners/find`, { body: {} }),
    );
    expect(realRecords.items.map((r) => r.title)).toEqual(["Test real dinner"]);

    // Ending it erases it; the real space can't be "ended".
    expect((await api(owner)("/spaces/Personal/practice", { method: "DELETE" })).status).toBe(404);
    expect((await api(owner)(`/spaces/${practice.id}/practice`, { method: "DELETE" })).status).toBe(200);
    expect((await json<SpaceView[]>(await api(owner)("/spaces"))).some((s) => s.id === practice.id)).toBe(
      false,
    );
  });

  it("plays each person: what's shared with them, their questions in turn, and only what they may do", async () => {
    const owner = await signUp("Test Owner");
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test plan" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    const rahul = await signUp("Rahul Test");
    const priya = await signUp("Priya Test");
    for (const u of [rahul, priya])
      await api(u)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    await api(owner)("/collections", {
      body: {
        name: "Dinners",
        fields: [
          { name: "Title", type: "text" },
          { name: "Reply", type: "text" },
        ],
      },
    });
    await api(owner)("/workflows", {
      body: {
        name: "One then the other",
        when: { event: "added", collection: "Dinners" },
        then: [
          { do: "ask", who: ["Rahul"], text: "Book {Title}?", choices: ["Yes", "No"], save_to: "Reply" },
          { do: "ask", who: ["Priya"], text: "Rahul said {Reply}. Bring dessert?", choices: ["Yes", "No"] },
        ],
        enabled: false,
      },
    });
    const practice = await json<SpaceView>(await api(owner)("/spaces/Personal/practice", { body: {} }));
    const base = `/spaces/${practice.id}/practice`;
    const view = async () => json<PracticeView>(await api(owner)(base));

    // The people it plays: the two the note is shared with (not the owner), nothing waiting yet.
    const v = await view();
    expect(v.people.map((p) => [p.name, p.role, p.waiting])).toEqual([
      ["Priya Test", "shared", 0],
      ["Rahul Test", "shared", 0],
    ]);
    const id = (name: string) => v.people.find((p) => p.name === name)!.user_id;
    const [rahulId, priyaId] = [id("Rahul Test"), id("Priya Test")];
    const as = async (who: string) => json<PracticeAsView>(await api(owner)(`${base}/as/${who}`));

    // Each sees what's shared with them, as they would: the note, opened through their share.
    expect((await as(priyaId)).cards.map((c) => [c.kind, c.title])).toEqual([["card", "Test plan"]]);
    const noteShare = (await as(priyaId)).cards[0]!.share_id;
    const opened = await json<SharedOpened>(await api(owner)(`${base}/as/${priyaId}/cards/${noteShare}`));
    expect("record" in opened && opened.record.title).toBe("Test plan");
    // A view-only share stays view-only when played.
    expect(
      (
        await api(owner)(`${base}/as/${priyaId}/cards/${noteShare}/records/${note.id}`, {
          method: "PATCH",
          body: { values: { Title: "Changed" } },
        })
      ).status,
    ).toBe(403);

    // Step 1 is Rahul's turn: his question is among his cards, not Priya's.
    await api(owner)("/collections/Dinners/records", {
      body: { space: practice.id, values: { Title: "Test Friday" } },
    });
    expect(
      await until(async () => (await view()).people.find((p) => p.name === "Rahul Test")!.waiting === 1),
    ).toBe(true);
    const question = (await as(rahulId)).cards.find((c) => c.kind === "question")!;
    expect(question.title).toBe("Book Test Friday?");
    expect((await as(priyaId)).cards.some((c) => c.kind === "question")).toBe(false);
    expect((await as(rahulId)).got.map((g) => g.body)).toEqual(["Book Test Friday?"]);
    // Priya can't answer Rahul's question.
    expect(
      (
        await api(owner)(`${base}/as/${priyaId}/cards/${question.share_id}/answer`, {
          body: { answer: "Yes" },
        })
      ).status,
    ).toBe(404);

    // Rahul answers: then it's Priya's turn, with what he said.
    expect(
      (
        await api(owner)(`${base}/as/${rahulId}/cards/${question.share_id}/answer`, {
          body: { answer: "Yes" },
        })
      ).status,
    ).toBe(200);
    expect(
      await until(async () => (await view()).people.find((p) => p.name === "Priya Test")!.waiting === 1),
    ).toBe(true);
    expect((await as(priyaId)).cards.find((c) => c.kind === "question")?.title).toBe(
      "Rahul said Yes. Bring dessert?",
    );

    // None of it reached the real people, and they can't play the rehearsal themselves.
    for (const u of [rahul, priya]) {
      expect(
        (await inbox(u)).some((n) => n.body?.includes("Test Friday") || n.body?.includes("dessert")),
      ).toBe(false);
      const theirs = await json<{ kind: string }[]>(await api(u)("/cards"));
      expect(theirs.some((c) => c.kind === "question")).toBe(false);
    }
    expect((await api(rahul)(`${base}/as/${rahulId}`)).status).toBe(404);
    // Someone the space doesn't know can't be played.
    expect((await api(owner)(`${base}/as/someone-else`)).status).toBe(404);
  });
});
