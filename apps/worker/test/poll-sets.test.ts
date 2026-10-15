// Questions that act, second part (decision 2026-10-15): a chat question about a plain field of
// a pinned record; the most picked answer sets it, as the lead changes (auto) or when the asker
// says (ask), written as the person who pinned the record. Fake data only.
import { describe, expect, it } from "vitest";
import type { GroupView } from "@assistant/shared";
import { api, gig, json, lastPoll, until } from "./poll-helpers.ts";

describe("questions that set a field", () => {
  it("sets the field to the most picked answer as the lead changes (auto)", async () => {
    const { owner, asha, chat, shareId, value } = await gig();
    const g = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: {
          question: "What do we wear?",
          options: ["black", "Band tees"],
          about: { share_id: shareId, field: "Dress", apply: "auto" },
        },
      }),
    );
    const poll = lastPoll(g);
    expect(g.polls[poll.id]!.about).toMatchObject({
      field: "Dress",
      personal: false,
      apply: "auto",
      can_apply: true,
    });
    // One answer ahead: the field follows it, in the field's own spelling.
    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "black" } });
    expect(await until(async () => (await value("Dress")) === "Black")).toBe(true);
    // A tie: nothing changes.
    await api(owner)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "Band tees" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(await value("Dress")).toBe("Black");
    // The lead moves: so does the field.
    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "Band tees" } });
    expect(await until(async () => (await value("Dress")) === "Band tees")).toBe(true);
    const after = await json<GroupView>(await api(asha)(`/groups/${chat}`));
    expect(after.polls[poll.id]!.about).toMatchObject({
      applied: { option: "Band tees", status: "done" },
      can_apply: false,
    });
  });

  it("waits for the asker to set it (ask), and only the asker or an admin may", async () => {
    const { owner, asha, chat, shareId, value } = await gig();
    const g = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: {
          question: "Call time?",
          options: ["2026-12-12 18:00", "2026-12-12 19:30"],
          about: { share_id: shareId, field: "Call time" },
        },
      }),
    );
    const poll = lastPoll(g);
    expect(g.polls[poll.id]!.about).toMatchObject({ apply: "ask", applied: null });
    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "2026-12-12 19:30" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(await value("Call time")).toBeNull();
    // A member can't set it; the asker can, and the field takes it as a date-and-time.
    expect(
      (await api(asha)(`/groups/${chat}/polls/${poll.id}/apply`, { body: { option: "2026-12-12 19:30" } }))
        .status,
    ).toBe(403);
    expect(
      (await api(owner)(`/groups/${chat}/polls/${poll.id}/apply`, { body: { option: "noon" } })).status,
    ).toBe(400);
    await api(owner)(`/groups/${chat}/polls/${poll.id}/apply`, { body: { option: "2026-12-12 19:30" } });
    expect(await until(async () => String(await value("Call time")).startsWith("2026-12-12T"))).toBe(true);
  });

  it("refuses answers the field can't take, and a personal field has no apply", async () => {
    const { owner, chat, shareId } = await gig();
    expect(
      (
        await api(owner)(`/groups/${chat}/polls`, {
          body: {
            question: "When?",
            options: ["soon", "later"],
            about: { share_id: shareId, field: "Call time" },
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(owner)(`/groups/${chat}/polls`, {
          body: {
            question: "Wear?",
            options: ["Pink", "Black"],
            about: { share_id: shareId, field: "Dress" },
          },
        })
      ).status,
    ).toBe(400);
    const g = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: { question: "Playing?", about: { share_id: shareId, field: "Playing?", apply: "auto" } },
      }),
    );
    const poll = lastPoll(g);
    expect(g.polls[poll.id]!.about).toMatchObject({ personal: true });
    expect(g.polls[poll.id]!.about).not.toHaveProperty("apply");
    expect(
      (await api(owner)(`/groups/${chat}/polls/${poll.id}/apply`, { body: { option: "Yes" } })).status,
    ).toBe(400);
  });
});
