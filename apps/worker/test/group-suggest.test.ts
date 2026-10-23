// Suggested actions on messages (backlog DF4): a member who switched it on gets one action
// under a new message when the model is sure, only they see it, and tapping it saves exactly
// that. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { CreatedShare, GroupView, RecordView, SaveProposal } from "@assistant/shared";
import { ulid } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

/** The group's alarm, now (the queue is decided there). */
async function tick(groupId: string) {
  const stub = env.GROUPS.getByName(`group:${groupId}`);
  await runInDurableObject(stub, async (inst) => {
    await (inst as unknown as { alarm(): Promise<void> }).alarm();
  });
}

describe("suggested actions on messages", () => {
  it("suggests one sure action to the member who asked, and saving it files exactly that", async () => {
    const owner = await signUp("Test Owner");
    const rahul = await signUp("Rahul Test");
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test note" } } }),
    );
    const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
    await api(rahul)("/cards/join", { body: { token: tokenOf(link) } });
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Flat", people: ["Rahul Test"] } }),
    );
    expect(g.suggest).toBe(false);

    // Rahul switches it on for himself; the owner didn't.
    const on = await json<GroupView>(
      await api(rahul)(`/groups/${g.id}/suggest`, { method: "PUT", body: { on: true } }),
    );
    expect(on.suggest).toBe(true);
    expect((await json<GroupView>(await api(owner)(`/groups/${g.id}`))).suggest).toBe(false);

    // Three messages: a sure one, an unsure one, plain talk.
    for (const text of ["Test remind Rahul about the deposit", "Test unsure about Friday", "Test hello all"])
      await api(owner)(`/groups/${g.id}/messages`, { body: { text } });
    await tick(g.id);
    const his = await json<GroupView>(await api(rahul)(`/groups/${g.id}`));
    const byText = Object.fromEntries(his.messages.map((m) => [m.text, m.id]));
    expect(his.suggested).toEqual({ [byText["Test remind Rahul about the deposit"]!]: "Remind me" });
    // The owner (off) sees none, and none of Rahul's.
    expect((await json<GroupView>(await api(owner)(`/groups/${g.id}`))).suggested).toEqual({});

    // Tapping it: the assistant proposes exactly that; nothing is saved until the tap.
    const proposal = await json<SaveProposal>(
      await api(rahul)(`/groups/${g.id}/messages/${byText["Test remind Rahul about the deposit"]}/save`, {
        body: { action: "Remind me" },
      }),
    );
    const card = proposal.items.find((i) => i.card)!.card!;
    expect(card.title).toContain("Reminders");
    expect(card.status).toBe("waiting");

    // A retry of the old "on" (same key) after "off" doesn't switch it back on.
    await api(rahul)(`/groups/${g.id}/suggest`, { method: "PUT", body: { on: true }, idempotencyKey: "s-1" });
    await api(rahul)(`/groups/${g.id}/suggest`, {
      method: "PUT",
      body: { on: false },
      idempotencyKey: "s-2",
    });
    await api(rahul)(`/groups/${g.id}/suggest`, { method: "PUT", body: { on: true }, idempotencyKey: "s-1" });
    expect((await json<GroupView>(await api(rahul)(`/groups/${g.id}`))).suggest).toBe(false);
  });

  it("refuses a member without the assistant", async () => {
    const owner = await signUp("Test Owner");
    const noai = await signUp("Test Noai", undefined, { assistant: false });
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test note" } } }),
    );
    const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
    await api(noai)("/cards/join", { body: { token: tokenOf(link) } });
    const g = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), name: "Test Quiet", people: ["Test Noai"] } }),
    );
    expect((await api(noai)(`/groups/${g.id}/suggest`, { method: "PUT", body: { on: true } })).status).toBe(
      403,
    );
  });
});
