// A flow asks people a few links away (owner, 2026-10-25: a society's visitor flow wasn't made
// because the resident is on a Residents row linked to the flat, two links from the visitor).
// Fake data only.
import { describe, expect, it } from "vitest";
import type { CreatedShare, RecordView, SharedWithMe, WorkflowDetail, WorkflowView } from "@assistant/shared";
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

describe("flows through links", () => {
  it("asks the app accounts of the residents of the visitor's flat ({Flat.Residents.App account})", async () => {
    const owner = await signUp("Test Owner");
    // Asha knows the owner (she joined a shared note), so she can be named in a person field.
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test notice board" } } }),
    );
    const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
    const asha = await signUp("Test Asha");
    await api(asha)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });

    await api(owner)("/collections", {
      body: { name: "Flats", fields: [{ name: "Flat", type: "text" }] },
    });
    const flats = (await json<{ id: string; name: string }[]>(await api(owner)("/collections"))).find(
      (c) => c.name === "Flats",
    )!.id;
    await api(owner)("/collections", {
      body: {
        name: "Residents",
        fields: [
          { name: "Name", type: "text" },
          { name: "App account", type: "person" },
          { name: "Flat", type: "link", options: { target: flats } },
        ],
      },
    });
    await api(owner)("/collections", {
      body: {
        name: "Visitors",
        fields: [
          { name: "Visitor name", type: "text" },
          { name: "Flat", type: "link", options: { target: flats } },
          { name: "Status", type: "choice", options: { choices: ["Pending", "Approved", "Rejected"] } },
        ],
      },
    });
    const flat = await json<RecordView>(
      await api(owner)("/collections/Flats/records", { body: { values: { Flat: "Test B-204" } } }),
    );
    await api(owner)("/collections/Residents/records", {
      body: {
        values: { Name: "Test Asha", "App account": { user_id: asha.id, name: "Test Asha" }, Flat: flat.id },
      },
    });

    const wf = await json<WorkflowView>(
      await api(owner)("/workflows", {
        body: {
          name: "Visitor approval",
          when: { event: "added", collection: "Visitors" },
          then: [
            {
              do: "ask",
              who: ["{Flat.Residents.App account}"],
              text: "{Visitor name} is at the gate for {Flat}. Let them in?",
              choices: ["Approved", "Rejected"],
              save_to: "Status",
              until: "first",
            },
          ],
          enabled: true,
        },
      }),
    );
    // The flow reads as written: the flat, its residents, their app accounts.
    const detail = await json<WorkflowDetail>(await api(owner)(`/workflows/${wf.id}`));
    expect(JSON.stringify(detail)).toContain("{Flat.Residents.App account}");

    // A visitor for B-204: Asha, a resident there, is asked.
    await api(owner)("/collections/Visitors/records", {
      body: { values: { "Visitor name": "Test Kabir", Flat: flat.id } },
    });
    expect(
      await until(async () =>
        (await json<SharedWithMe[]>(await api(asha)("/cards"))).some(
          (c) =>
            c.kind === "question" && c.title === "Test Kabir is at the gate for Test B-204. Let them in?",
        ),
      ),
    ).toBe(true);

    // A field that isn't a person at the end is refused, in words.
    const bad = await api(owner)("/workflows", {
      body: {
        name: "Wrong",
        when: { event: "added", collection: "Visitors" },
        then: [{ do: "ask", who: ["{Flat.Residents.Name}"], text: "Hi?", choices: ["Yes", "No"] }],
        enabled: false,
      },
    });
    expect(bad.status).toBe(400);
  });

  it("asks one person field ({Guard}) and keeps the answer in a choice field, all answers or first", async () => {
    const owner = await signUp("Test Owner");
    await api(owner)("/collections", {
      body: {
        name: "Visitors",
        fields: [
          { name: "Visitor name", type: "text" },
          { name: "Guard", type: "person" },
          { name: "Status", type: "choice", options: { choices: ["Pending", "Checked in", "Rejected"] } },
        ],
      },
    });
    const res = await api(owner)("/workflows", {
      body: {
        name: "Gate entry",
        when: { event: "added", collection: "Visitors" },
        then: [
          {
            do: "ask",
            who: ["{Guard}"],
            text: "Let {Visitor name} in?",
            choices: ["Checked in", "Rejected"],
            save_to: "Status",
          },
        ],
        enabled: false,
      },
    });
    expect(res.status).toBe(201);
  });
});
