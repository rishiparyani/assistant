// A "choose" step (decision 2026-10-23 "A Choose step"): a model picks one of the flow's own
// options from the record; unsure runs the unsure steps; a rehearsal lets the person pick
// what the app would. The fake model picks the option whose name appears in the record (sure)
// and is unsure about a record that says "Test unsure". Fake data only.
import { describe, expect, it } from "vitest";
import type { Rehearsal, RecordView, WorkflowDetail, WorkflowView } from "@assistant/shared";
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

describe("a choose step", () => {
  it("picks an option from the record, keeps the pick, runs the option's steps; unsure runs the unsure steps", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Visitors",
        fields: [
          { name: "Title", type: "text" },
          { name: "Note", type: "text" },
          { name: "Decision", type: "choice", options: { choices: ["Let in", "Deny"] } },
        ],
      },
    });
    const wf = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Gate",
          when: { event: "added", collection: "Visitors" },
          then: [
            {
              do: "choose",
              question: "Should {Title} be let in?",
              options: [
                { label: "Let in", then: [{ do: "notify", text: "Let in: {Title}", to: ["me"] }] },
                { label: "Deny", then: [{ do: "notify", text: "Denied: {Title}", to: ["me"] }] },
              ],
              unsure: [{ do: "notify", text: "Not sure about {Title}", to: ["me"] }],
              save_to: "Decision",
            },
            { do: "notify", text: "Done with {Title}", to: ["me"] },
          ],
          enabled: true,
        },
      }),
    );
    expect(wf.words).toEqual([
      "When a record is added to Visitors",
      "Decide “Should {Title} be let in?” (the app picks): Let in → Tell me: “Let in: {Title}”. Deny → Tell me: “Denied: {Title}”. Not sure → Tell me: “Not sure about {Title}”. Keep the pick in Decision",
      "Tell me: “Done with {Title}”",
    ]);

    // A record the model is sure about: the option's step, the pick kept, then the next step.
    const regular = await json<RecordView>(
      await api(me)("/collections/Visitors/records", {
        body: { values: { Title: "Test Asha", Note: "A regular, let in every day" } },
      }),
    );
    expect(await until(async () => (await inbox(me)).some((n) => n.body === "Done with Test Asha"))).toBe(
      true,
    );
    const bodies = (await inbox(me)).map((n) => n.body);
    expect(bodies).toContain("Let in: Test Asha");
    expect(bodies).not.toContain("Denied: Test Asha");
    const kept = await json<RecordView>(await api(me)(`/records/${regular.id}`));
    expect(kept.named.Decision).toBe("Let in");
    const d = await json<WorkflowDetail>(await api(me)(`/workflows/${wf.id}`));
    expect(d.history.some((h) => h.detail.includes("Picked “Let in” (90% sure)"))).toBe(true);

    // A record it isn't sure about: the unsure steps, nothing kept, and the run still goes on.
    await api(me)("/collections/Visitors/records", { body: { values: { Title: "Test unsure one" } } });
    expect(
      await until(async () => (await inbox(me)).some((n) => n.body === "Done with Test unsure one")),
    ).toBe(true);
    const later = (await inbox(me)).map((n) => n.body);
    expect(later).toContain("Not sure about Test unsure one");
    expect(later.filter((b) => b?.startsWith("Let in:"))).toEqual(["Let in: Test Asha"]);
    const d2 = await json<WorkflowDetail>(await api(me)(`/workflows/${wf.id}`));
    expect(d2.history.some((h) => h.detail.includes("Not sure enough"))).toBe(true);
  });

  it("rehearses with the person picking what the app would, and checks the options when saved", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Visitors", fields: [{ name: "Title", type: "text" }] },
    });
    const wf = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Gate",
          when: { event: "added", collection: "Visitors" },
          then: [
            {
              do: "choose",
              question: "Let {Title} in?",
              options: [
                { label: "Let in", then: [{ do: "notify", text: "In: {Title}", to: ["me"] }] },
                { label: "Deny", then: [{ do: "notify", text: "Out: {Title}", to: ["me"] }] },
              ],
              unsure: [{ do: "notify", text: "Unsure: {Title}", to: ["me"] }],
            },
          ],
          enabled: false,
        },
      }),
    );
    await api(me)("/collections/Visitors/records", { body: { values: { Title: "Test Rahul" } } });
    const first = await json<Rehearsal>(await api(me)(`/workflows/${wf.id}/rehearse`, { body: {} }));
    expect(first.lines).toEqual(["Would decide “Let Test Rahul in?” (Let in / Deny)"]);
    expect(first.waiting).toMatchObject({
      step: 1,
      question: "Let Test Rahul in?",
      choices: ["Let in", "Deny", "Not sure"],
      people: ["the app"],
      next: "the app",
    });
    const denied = await json<Rehearsal>(
      await api(me)(`/workflows/${wf.id}/rehearse`, {
        body: { answers: [{ step: 1, time: 1, answer: "Deny" }] },
      }),
    );
    expect(denied.lines).toEqual([
      "Would decide “Let Test Rahul in?” (Let in / Deny)",
      "The app would pick “Deny”",
      "Told me: “Out: Test Rahul”",
    ]);
    expect(denied.finished).toBe(true);
    const unsure = await json<Rehearsal>(
      await api(me)(`/workflows/${wf.id}/rehearse`, {
        body: { answers: [{ step: 1, time: 1, answer: "Not sure" }] },
      }),
    );
    expect(unsure.lines).toContain("The app wouldn't be sure");
    expect(unsure.lines).toContain("Told me: “Unsure: Test Rahul”");
    // Nothing kept or sent by a rehearsal.
    expect((await inbox(me)).some((n) => n.body?.startsWith("Out:"))).toBe(false);

    // Two options with one name, or a pick kept in a choice field without that choice: refused.
    const same = await api(me)("/workflows", {
      body: {
        name: "Test same",
        when: { event: "added", collection: "Visitors" },
        then: [{ do: "choose", question: "Which?", options: [{ label: "A" }, { label: "a" }] }],
      },
    });
    expect(same.status).toBe(400);
  });
});
