// The assistant tests every flow (decision 2026-10-30 "The assistant tests every flow"): a
// proposed workflow is acted out before the tap, with stand-in answers, nothing kept; what
// wouldn't work comes back as a gap. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { CreatedShare, RecordView, SpaceView, WorkflowView } from "@assistant/shared";
import type { WorkflowSpec } from "../src/core/spaces/space-object.ts";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

// The ask step as the space keeps it: people by account (`to`), or a person field (`to_fields`).
const askGuard = (who: { to: { user_id: string; name: string }[]; to_fields: string[] }): WorkflowSpec => ({
  name: "Test visitor approval",
  when: { event: "added" as const, collection: "Visits", offset_minutes: 0 },
  check: [],
  wait_minutes: 0,
  then: [
    {
      do: "ask" as const,
      ...who,
      text: "Let {Title} in?",
      choices: ["Approved", "Denied"],
      save_to: "Status",
      until: "first" as const,
    },
    { do: "set" as const, field: "Done", value: true },
  ],
  enabled: false,
});

describe("a proposed flow is tested before the tap", () => {
  it("tells the story when every step works, and finds who'd be missing", async () => {
    const owner = await signUp("Test Owner");
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test gate note" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    const rahul = await signUp("Rahul Test");
    await api(rahul)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    await api(owner)("/collections", {
      body: {
        name: "Visits",
        fields: [
          { name: "Title", type: "text" },
          { name: "Guard", type: "person" },
          { name: "Status", type: "text" },
          { name: "Done", type: "boolean" },
        ],
      },
    });
    const spaces = await json<SpaceView[]>(await api(owner)("/spaces"));
    const stub = env.SPACES.getByName(`space:${spaces.find((s) => s.kind === "personal")!.id}`);
    const actor = { userId: owner.id, source: "web" as const };

    // Rahul by name: a new visit (none yet) is asked of him, answered, and goes on.
    const ok: WorkflowView = await stub.previewWorkflow(
      actor,
      askGuard({ to: [{ user_id: rahul.id, name: "Rahul Test" }], to_fields: [] }),
    );
    expect(ok.test!.on).toBe("a new record in Visits");
    expect(ok.test!.gaps).toEqual([]);
    expect(ok.test!.lines.join(" | ")).toContain("Would ask Rahul Test");
    expect(ok.test!.lines.join(" | ")).toContain("would answer “Approved”");

    // Whoever is in the visit's Guard field: a new visit names nobody, so nobody would be asked.
    const gap: WorkflowView = await stub.previewWorkflow(actor, askGuard({ to: [], to_fields: ["Guard"] }));
    expect(gap.test!.gaps).toEqual(["Nobody to ask: the record names nobody in the space"]);

    // Nothing was kept: no visit, no workflow.
    expect(
      (await json<{ items: unknown[] }>(await api(owner)("/collections/Visits/find", { body: {} }))).items,
    ).toEqual([]);
    expect((await json<{ name: string }[]>(await api(owner)("/workflows"))).map((w) => w.name)).not.toContain(
      "Test visitor approval",
    );
  });
});
