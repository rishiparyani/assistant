// Assistant first (decision 2026-10-10): new people start with no lists; the everyday
// assistant starts one on the spot the first time it's needed. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView, CollectionView, WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("starting lists", () => {
  it("starts empty, and starts a list once, with its alarm", async () => {
    const me = await signUp("Test Owner", undefined, { lists: false });
    expect(await json<CollectionView[]>(await api(me)("/collections"))).toEqual([]);
    const a = await json<CollectionView>(await api(me)("/lists/start", { body: { kind: "reminders" } }));
    const b = await json<CollectionView>(await api(me)("/lists/start", { body: { kind: "reminders" } }));
    expect(a.name).toBe("Reminders");
    expect(b.id).toBe(a.id);
    expect((await json<CollectionView[]>(await api(me)("/collections"))).map((c) => c.name)).toEqual([
      "Reminders",
    ]);
    const flows = await json<WorkflowView[]>(await api(me)("/workflows"));
    expect(flows.map((w) => w.name)).toEqual(["Remind me"]);
  });

  it("lets the everyday assistant start the list it needs, on the spot", async () => {
    const me = await signUp("Test Owner", undefined, { lists: false });
    const view = await json<ChatView>(
      await api(me)("/chat", { body: { text: "Test: remind me to call the venue" } }),
    );
    // No card to confirm: the list and the reminder are both there, shown as a live card.
    expect(view.items.some((i) => i.role === "card")).toBe(false);
    expect(view.items.some((i) => i.role === "live")).toBe(true);
    const found = await json<{ items: { title: string }[] }>(
      await api(me)("/collections/Reminders/find", { body: {} }),
    );
    expect(found.items.map((r) => r.title)).toEqual(["Test call the venue"]);
  });
});
