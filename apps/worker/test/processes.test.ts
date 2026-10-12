// Processes (home-first.md §2 point 9): a workflow step that asks people and waits for their
// answer, nudges them, keeps the answer on the record and goes on. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  CreatedShare,
  RecordView,
  SharedWithMe,
  WaitingItem,
  WorkflowDetail,
  WorkflowView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
type Inbox = { items: { title: string; body: string | null; url?: string | null }[] };
const inbox = async (u: User) => (await json<Inbox>(await api(u)("/me/notifications"))).items;

/** An owner who knows Rahul and Priya (they joined a shared note), with a Bookings list. */
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
  await api(owner)("/collections", {
    body: {
      name: "Bookings",
      fields: [
        { name: "Title", type: "text" },
        { name: "Reply", type: "text" },
        { name: "Status", type: "choice", options: { choices: ["New", "Confirmed", "Dropped"] } },
      ],
    },
  });
  return { owner, rahul, priya };
}

describe("processes", () => {
  it("asks a person, waits for the answer, keeps it on the record and goes on", async () => {
    const { owner, rahul, priya } = await setUp();
    const res = await api(owner)("/workflows", {
      body: {
        name: "Confirm with Rahul",
        when: { event: "added", collection: "Bookings" },
        then: [
          {
            do: "ask",
            who: ["Rahul"],
            text: "Can you play {Title}?",
            choices: ["Yes", "No"],
            save_to: "Reply",
            nudge_minutes: 60,
          },
          { do: "notify", text: "Rahul said {Reply} to {Title}", to: ["me"] },
        ],
        enabled: true,
      },
    });
    expect(res.status).toBe(201);
    const wf = await json<WorkflowView>(res);
    expect(wf.words).toEqual([
      "When a record is added to Bookings",
      "Ask Rahul Test: “Can you play {Title}?” (Yes / No), wait for the answer, nudge every 1 hour, keep it in Reply",
      "Tell me: “Rahul said {Reply} to {Title}”",
    ]);

    const booking = await json<RecordView>(
      await api(owner)("/collections/Bookings/records", { body: { values: { Title: "Test wedding" } } }),
    );
    // The question reaches Rahul (inbox and Shared with you); the owner sees what's waiting.
    expect(
      await until(async () => (await inbox(rahul)).some((n) => n.body === "Can you play Test wedding?")),
    ).toBe(true);
    const waiting = await json<WaitingItem[]>(await api(owner)("/waiting"));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      workflow: "Confirm with Rahul",
      record: "Test wedding",
      text: "Can you play Test wedding?",
      choices: ["Yes", "No"],
      on: [{ name: "Rahul Test", answer: null }],
      share_id: null,
      mine: null,
    });
    const shared = await json<SharedWithMe[]>(await api(rahul)("/cards"));
    const q = shared.find((x) => x.kind === "question")!;
    expect(q.title).toBe("Can you play Test wedding?");
    // Rahul's own view of it names his share; Priya wasn't asked and sees nothing.
    const mine = await json<WaitingItem[]>(await api(rahul)("/waiting"));
    expect(mine[0]?.share_id).toBe(q.share_id);
    expect(await json<WaitingItem[]>(await api(priya)("/waiting"))).toEqual([]);

    // A nudge now: Rahul hears it again, nobody else.
    expect((await api(owner)(`/waiting/${waiting[0]!.id}/nudge`, { method: "POST" })).status).toBe(200);
    expect(
      await until(
        async () => (await inbox(rahul)).filter((n) => n.body === "Can you play Test wedding?").length === 2,
      ),
    ).toBe(true);
    expect((await inbox(priya)).length).toBe(0);

    // Rahul answers: the answer lands on the record, the owner is told, nothing waits any more.
    expect((await api(rahul)(`/cards/${q.share_id}/answer`, { body: { answer: "yes" } })).status).toBe(200);
    expect(
      await until(async () => (await inbox(owner)).some((n) => n.body === "Rahul said Yes to Test wedding")),
    ).toBe(true);
    const after = await json<RecordView>(await api(owner)(`/records/${booking.id}`));
    const reply = Object.entries(after.values).find(([, v]) => v === "Yes");
    expect(reply).toBeDefined();
    expect(await json<WaitingItem[]>(await api(owner)("/waiting"))).toEqual([]);
    const d = await json<WorkflowDetail>(await api(owner)(`/workflows/${wf.id}`));
    expect(d.waiting).toEqual([]);
    expect(d.history.map((h) => h.detail)).toEqual([
      "Told me: “Rahul said Yes to Test wedding”",
      "Rahul Test answered “Yes”",
      "Nudged Rahul Test",
      "Asked Rahul Test: “Can you play Test wedding?”",
    ]);
    expect(d.workflow.runs).toBe(1);
  });

  it("waits for everyone, loops back while a condition holds, and stops when turned off", async () => {
    const { owner, rahul, priya } = await setUp();
    const wf = await json<WorkflowView>(
      await api(owner)("/workflows", {
        body: {
          name: "Band check",
          when: { event: "added", collection: "Bookings" },
          then: [
            {
              do: "ask",
              who: ["Rahul", "Priya"],
              text: "In for {Title}?",
              choices: ["Yes", "No"],
              save_to: "Reply",
            },
            { do: "repeat", if: [{ field: "Status", op: "eq", value: "New" }], from: 1, at_most: 1 },
            { do: "set", field: "Status", value: "Confirmed" },
          ],
          enabled: true,
        },
      }),
    );
    expect(wf.words[1]).toBe(
      "Ask Rahul Test, Priya Test: “In for {Title}?” (Yes / No), wait for everyone's answer, keep it in Reply",
    );
    expect(wf.words[2]).toBe("Go back to step 1 while Status is New (at most 1 time)");
    await api(owner)("/collections/Bookings/records", {
      body: { values: { Title: "Test club night", Status: "New" } },
    });
    expect(await until(async () => (await inbox(priya)).length === 1)).toBe(true);
    const share = async (u: User) =>
      (await json<SharedWithMe[]>(await api(u)("/cards"))).find((x) => x.kind === "question")!.share_id;
    await api(rahul)(`/cards/${await share(rahul)}/answer`, { body: { answer: "Yes" } });
    // One answer in: still waiting on Priya.
    let items = await json<WaitingItem[]>(await api(owner)("/waiting"));
    expect(items[0]?.on.map((p) => [p.name, p.answer])).toEqual([
      ["Priya Test", null],
      ["Rahul Test", "Yes"],
    ]);
    await api(priya)(`/cards/${await share(priya)}/answer`, { body: { answer: "No" } });
    // Everyone answered: the answers are kept, Status is New so it asks once more (at most 1).
    expect(await until(async () => (await inbox(priya)).length === 2)).toBe(true);
    items = await json<WaitingItem[]>(await api(owner)("/waiting"));
    expect(items).toHaveLength(1);
    const records = await json<{ items: RecordView[] }>(
      await api(owner)("/collections/Bookings/find", { body: {} }),
    );
    expect(Object.values(records.items[0]!.values)).toContain("Priya Test: No · Rahul Test: Yes");
    // Turned off while waiting: the question closes and nothing waits.
    await api(owner)(`/workflows/${wf.id}/enabled`, { method: "PUT", body: { enabled: false } });
    expect(await json<WaitingItem[]>(await api(owner)("/waiting"))).toEqual([]);
    expect(
      (await api(rahul)(`/cards/${await share(rahul)}/answer`, { body: { answer: "Yes" } })).status,
    ).toBe(409);
  });

  it("checks ask steps when saved", async () => {
    const { owner } = await setUp();
    const make = (then: unknown[]) =>
      api(owner)("/workflows", {
        body: { name: "x", when: { event: "added", collection: "Bookings" }, then },
      });
    // A choice field can't keep two people's answers; the answers must be among its choices.
    expect(
      (
        await make([
          { do: "ask", who: ["Rahul", "Priya"], text: "?", choices: ["Yes", "No"], save_to: "Status" },
        ])
      ).status,
    ).toBe(400);
    expect(
      (await make([{ do: "ask", who: ["Rahul"], text: "?", choices: ["Yes", "No"], save_to: "Status" }]))
        .status,
    ).toBe(400);
    expect(
      (
        await make([
          { do: "ask", who: ["Rahul"], text: "?", choices: ["Confirmed", "Dropped"], save_to: "Status" },
        ])
      ).status,
    ).toBe(201);
    // Going back must point at an earlier step; nobody unknown can be asked.
    expect(
      (await make([{ do: "repeat", if: [{ field: "Status", op: "eq", value: "New" }], from: 1 }])).status,
    ).toBe(400);
    expect((await make([{ do: "ask", who: ["Test Nobody"], text: "?" }])).status).toBe(404);
  });
});
