// Workflows (chat-first step 5): when / check / wait / then, run by the space after a write.
// Fake data only.
import { describe, expect, it } from "vitest";
import type { RecordView, WorkflowDetail, WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

/** Waits until `check` returns true (the space's alarm runs jobs a moment after a write). */
async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
type Inbox = { items: { title: string; body: string | null }[] };
const inbox = async (u: User) => (await json<Inbox>(await api(u)("/me/notifications"))).items;

describe("workflows", () => {
  it("tells me about big expenses, in words from the saved definition", async () => {
    const me = await signUp("Test Owner");
    const res = await api(me)("/workflows", {
      body: {
        name: "Big expenses",
        when: { event: "added", collection: "Expenses" },
        check: [{ field: "Amount", op: "gt", value: "5000" }],
        then: [{ do: "notify", text: "Big expense: {Amount} on {What}", to: ["me"] }],
        enabled: true,
      },
    });
    expect(res.status).toBe(201);
    const wf = await json<WorkflowView>(res);
    expect(wf.words).toEqual([
      "When a record is added to Expenses",
      "Only if Amount is more than ₹5,000",
      "Tell me: “Big expense: {Amount} on {What}”",
    ]);

    await api(me)("/collections/Expenses/records", {
      body: { values: { What: "Test amp", Amount: "6000" } },
    });
    await api(me)("/collections/Expenses/records", { body: { values: { What: "Test tea", Amount: "40" } } });
    expect(
      await until(async () => (await inbox(me)).some((n) => n.body === "Big expense: ₹6,000 on Test amp")),
    ).toBe(true);
    expect(
      await until(async () => {
        const d = await json<WorkflowDetail>(await api(me)(`/workflows/${wf.id}`));
        return d.history.length === 2;
      }),
    ).toBe(true);
    const d = await json<WorkflowDetail>(await api(me)(`/workflows/${wf.id}`));
    expect(d.workflow.runs).toBe(1);
    expect(d.history.map((h) => h.detail).sort()).toEqual([
      "Skipped: it didn't match the check",
      "Told me: “Big expense: ₹6,000 on Test amp”",
    ]);
    // Only one notification: the tea didn't match.
    expect((await inbox(me)).filter((n) => n.title === "Big expenses")).toHaveLength(1);
  });

  it("reminds at Due with the built-in workflow, unless it's done", async () => {
    const me = await signUp("Test Owner");
    const list = await json<WorkflowView[]>(await api(me)("/workflows"));
    expect(list.map((w) => [w.name, w.enabled])).toEqual([["Remind me", true]]);
    expect(list[0]!.words).toEqual([
      "At the Due of each record in Reminders",
      "Only if Done isn't Yes",
      "Tell me: “{Title}”",
    ]);

    const soon = new Date(Date.now() + 1500).toISOString();
    await api(me)("/collections/Reminders/records", {
      body: { values: { Title: "Test call the venue", Due: soon } },
    });
    const done = await json<RecordView>(
      await api(me)("/collections/Reminders/records", {
        body: { values: { Title: "Test already done", Due: soon } },
      }),
    );
    await api(me)(`/records/${done.id}`, { method: "PATCH", body: { values: { Done: true } } });
    expect(await until(async () => (await inbox(me)).some((n) => n.body === "Test call the venue"))).toBe(
      true,
    );
    await new Promise((r) => setTimeout(r, 1000));
    expect((await inbox(me)).some((n) => n.body === "Test already done")).toBe(false);
  });

  it("does nothing while off, and stops chains after three steps", async () => {
    const me = await signUp("Test Owner");
    const wf = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Echo",
          when: { event: "added", collection: "Notes" },
          then: [{ do: "add", collection: "Notes", values: { Title: "Test echo of {Title}" } }],
        },
      }),
    );
    expect(wf.enabled).toBe(false);
    const notes = async () =>
      (await json<{ items: RecordView[] }>(await api(me)("/collections/Notes/find", { body: {} }))).items;
    await api(me)("/collections/Notes/records", { body: { values: { Title: "Test first" } } });
    await new Promise((r) => setTimeout(r, 1500));
    expect(await notes()).toHaveLength(1);

    await api(me)(`/workflows/${wf.id}/enabled`, { method: "PUT", body: { enabled: true } });
    await api(me)("/collections/Notes/records", { body: { values: { Title: "Test second" } } });
    // The person's note, then three workflow steps, then it stops.
    expect(await until(async () => (await notes()).length === 5)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await notes()).map((n) => n.title)).toContain(
      "Test echo of Test echo of Test echo of Test second",
    );
    expect(await notes()).toHaveLength(5);
  });

  it("checks definitions when saved, and others can't see them", async () => {
    const me = await signUp("Test Owner");
    const bad = await api(me)("/workflows", {
      body: {
        name: "Bad",
        when: { event: "date", collection: "Expenses", field: "What" },
        then: [{ do: "notify", text: "x" }],
      },
    });
    expect(bad.status).toBe(400);
    const unknownPerson = await api(me)("/workflows", {
      body: {
        name: "Tell a stranger",
        when: { event: "added", collection: "Notes" },
        then: [{ do: "notify", text: "x", to: ["Test Nobody"] }],
      },
    });
    expect(unknownPerson.status).toBe(404);
    const [remind] = await json<WorkflowView[]>(await api(me)("/workflows"));
    const other = await signUp("Test Other");
    expect((await api(other)(`/workflows/${remind!.id}`)).status).toBe(404);
    expect((await api(me)(`/workflows/${remind!.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await json<WorkflowView[]>(await api(me)("/workflows"))).toEqual([]);
  });

  it("counts a link change as a change, refuses to watch a link alone, and a repeated turn-on changes nothing", async () => {
    const me = await signUp("Test Owner");
    expect(
      (
        await api(me)("/workflows", {
          body: {
            name: "Watch For",
            when: { event: "changed", collection: "Expenses", field: "For" },
            then: [{ do: "notify", text: "x" }],
          },
        })
      ).status,
    ).toBe(400);
    const wf = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Expense changed",
          when: { event: "changed", collection: "Expenses" },
          then: [{ do: "notify", text: "Changed: {What}" }],
          enabled: true,
        },
      }),
    );
    // Turning on again changes nothing.
    const again = await api(me)(`/workflows/${wf.id}/enabled`, { method: "PUT", body: { enabled: true } });
    expect((await json<WorkflowView>(again)).enabled).toBe(true);

    const exp = await json<RecordView>(
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: "Test strings", Amount: "300" } },
      }),
    );
    const note = await json<RecordView>(
      await api(me)("/collections/Notes/records", { body: { values: { Title: "Test gig note" } } }),
    );
    await api(me)(`/records/${exp.id}`, { method: "PATCH", body: { values: { For: note.id } } });
    expect(await until(async () => (await inbox(me)).some((n) => n.body === "Changed: Test strings"))).toBe(
      true,
    );
  });

  it("refuses a date workflow on a personal-answer date", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test jams",
        fields: [
          { name: "Title", type: "text" },
          { name: "My day", type: "date", options: { personal: true } },
        ],
      },
    });
    const res = await api(me)("/workflows", {
      body: {
        name: "Personal date",
        when: { event: "date", collection: "Test jams", field: "My day" },
        then: [{ do: "notify", text: "x" }],
      },
    });
    expect(res.status).toBe(400);
  });
});
