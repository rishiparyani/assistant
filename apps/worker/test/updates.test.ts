// Updates (decision 2026-10-30 "Updates"): the person who added a record hears what a flow's
// question about it decided, and while rehearsing, each person's updates are what the practice
// copy would have told them. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  CreatedShare,
  NotificationsView,
  PracticeView,
  RecordView,
  SharedWithMe,
  SpaceView,
  WaitingItem,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User, as?: string) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...(as ? { headers: { "x-practice-as": as } } : {}), ...init });
async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
const updates = async (call: ReturnType<typeof api>) =>
  json<NotificationsView>(await call("/me/notifications"));

/** An owner who knows Rahul, a Visits list, and a flow that asks Rahul about each visit. */
async function setUp(enabled: boolean) {
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
        { name: "Status", type: "text" },
      ],
    },
  });
  await api(owner)("/workflows", {
    body: {
      name: "Visitor approval",
      when: { event: "added", collection: "Visits" },
      then: [
        {
          do: "ask",
          who: ["Rahul"],
          text: "Let {Title} in?",
          choices: ["Approved", "Denied"],
          save_to: "Status",
        },
      ],
      enabled,
    },
  });
  return { owner, rahul };
}

describe("updates", () => {
  it("tells the person who added the record what the answer was, and not the one who answered", async () => {
    const { owner, rahul } = await setUp(true);
    await api(owner)("/collections/Visits/records", { body: { values: { Title: "Test courier" } } });
    expect(
      await until(async () =>
        (await json<SharedWithMe[]>(await api(rahul)("/cards"))).some((c) => c.kind === "question"),
      ),
    ).toBe(true);
    const q = (await json<SharedWithMe[]>(await api(rahul)("/cards"))).find((c) => c.kind === "question")!;
    expect((await api(rahul)(`/cards/${q.share_id}/answer`, { body: { answer: "Approved" } })).status).toBe(
      200,
    );
    expect(
      await until(async () =>
        (await updates(api(owner))).items.some(
          (n) => n.title === "Visitor approval: Test courier" && n.body === "Rahul Test answered “Approved”",
        ),
      ),
    ).toBe(true);
    // Rahul got the question, never an update about his own answer; the question isn't counted as
    // a new update (it waits under Needs you).
    expect((await updates(api(rahul))).items.map((n) => n.kind)).toEqual(["question"]);
    expect((await updates(api(rahul))).unread_updates).toBe(0);
    expect((await updates(api(owner))).unread_updates).toBeGreaterThan(0);
    // Read: the dot goes.
    expect((await updates(api(owner))).unread).toBeGreaterThan(0);
    await api(owner)("/me/notifications/read", { body: {} });
    expect((await updates(api(owner))).unread).toBe(0);
  });

  it("while rehearsing, shows each person what the copy would have told them, and nothing real", async () => {
    const { owner, rahul } = await setUp(false);
    const practice = await json<SpaceView>(await api(owner)("/spaces/Personal/practice", { body: {} }));
    const v = await json<PracticeView>(await api(owner)(`/spaces/${practice.id}/practice`));
    const rahulId = v.people.find((p) => p.name === "Rahul Test")!.user_id;
    const asRahul = api(owner, `${practice.id} ${rahulId}`);
    const asMe = api(owner, `${practice.id} ${owner.id}`);

    await api(owner)("/collections/Visits/records", {
      body: { space: practice.id, values: { Title: "Test plumber" } },
    });
    expect(
      await until(async () =>
        (await updates(asRahul)).items.some(
          (n) => n.kind === "question" && n.body === "Let Test plumber in?",
        ),
      ),
    ).toBe(true);
    expect((await updates(asRahul)).unread).toBe(1);
    expect((await updates(asRahul)).unread_updates).toBe(0);
    const wait = (await json<WaitingItem[]>(await asRahul("/waiting")))[0]!;
    expect((await asRahul(`/cards/${wait.share_id}/answer`, { body: { answer: "Approved" } })).status).toBe(
      200,
    );
    // The owner, played in the copy, hears it; Rahul's own answer isn't an update to him.
    expect(
      await until(async () =>
        (await updates(asMe)).items.some(
          (n) => n.title === "Visitor approval: Test plumber" && n.body === "Rahul Test answered “Approved”",
        ),
      ),
    ).toBe(true);
    expect((await updates(asRahul)).items.map((n) => n.kind)).toEqual(["question"]);
    // Read while rehearsing: only that person's dot.
    await asRahul("/me/notifications/read", { body: {} });
    expect((await updates(asRahul)).unread).toBe(0);
    expect((await updates(asMe)).unread).toBe(1);
    // Nothing reached anyone's real updates.
    expect((await updates(api(rahul))).items).toEqual([]);
    expect((await updates(api(owner))).items.some((n) => n.title.includes("Test plumber"))).toBe(false);
  });
});
