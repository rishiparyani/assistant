// Rehearse a workflow (decision 2026-10-16 "Rehearse a workflow"): its steps run in words on one
// record, nothing kept, nobody told or asked; answers to its questions are given by step.
// Fake data only.
import { describe, expect, it } from "vitest";
import type { CreatedShare, Rehearsal, RecordView, WorkflowDetail, WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
type Inbox = { items: { title: string; body: string | null }[] };
const inbox = async (u: User) => (await json<Inbox>(await api(u)("/me/notifications"))).items;

describe("rehearse a workflow", () => {
  it("shows each step in words, stops at a question, goes on with an answer, and keeps nothing", async () => {
    const owner = await signUp("Test Owner");
    // Rahul is someone the owner knows (he joined a shared note).
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
          { name: "Status", type: "choice", options: { choices: ["New", "Confirmed"] } },
        ],
      },
    });
    // Saved off, as a new workflow is: rehearsing is how it's tried before it's turned on.
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
            { do: "set", field: "Status", value: "Confirmed" },
            { do: "notify", text: "Rahul said {Reply} to {Title}", to: ["me"] },
          ],
          enabled: false,
        },
      }),
    );
    const dinner = await json<RecordView>(
      await api(owner)("/collections/Dinners/records", { body: { values: { Title: "Test dinner" } } }),
    );

    // First go: it stops at the question, asking nobody.
    const first = await json<Rehearsal>(await api(owner)(`/workflows/${wf.id}/rehearse`, { body: {} }));
    expect(first).toMatchObject({
      workflow: "Confirm the dinner",
      record: { id: dinner.id, title: "Test dinner" },
      lines: ["Would ask Rahul Test: “Can you come to Test dinner?”"],
      waiting: {
        step: 1,
        question: "Can you come to Test dinner?",
        choices: ["Yes", "No"],
        people: ["Rahul Test"],
      },
      finished: false,
    });

    // With Rahul's answer: it goes to the end.
    const second = await json<Rehearsal>(
      await api(owner)(`/workflows/${wf.id}/rehearse`, {
        body: { record_id: dinner.id, answers: [{ step: 1, answer: "Yes" }] },
      }),
    );
    expect(second.lines).toEqual([
      "Would ask Rahul Test: “Can you come to Test dinner?”",
      "The answer: “Yes”, kept in Reply",
      "Set Status to Confirmed",
      "Told me: “Rahul said Yes to Test dinner”",
    ]);
    expect(second).toMatchObject({ waiting: null, finished: true });

    // Nothing was kept or sent: the record, the history, the waiting list and both inboxes.
    const after = await json<RecordView>(await api(owner)(`/records/${dinner.id}`));
    expect(Object.values(after.values)).not.toContain("Yes");
    expect(Object.values(after.values)).not.toContain("Confirmed");
    const d = await json<WorkflowDetail>(await api(owner)(`/workflows/${wf.id}`));
    expect(d.history).toEqual([]);
    expect(d.workflow.runs).toBe(0);
    expect(await json(await api(owner)("/waiting"))).toEqual([]);
    expect((await inbox(rahul)).some((n) => n.body?.includes("Test dinner"))).toBe(false);
    expect((await inbox(owner)).some((n) => n.body?.includes("Test dinner"))).toBe(false);

    // Only someone who can arrange the space can rehearse its workflows.
    expect((await api(rahul)(`/workflows/${wf.id}/rehearse`, { body: {} })).status).toBeGreaterThanOrEqual(
      400,
    );
  });
});
