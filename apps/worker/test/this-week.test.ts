// This week (home-first.md §2 point 13): proposals from the person's data, as confirm cards in
// their chat, never actions. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { ChatView, MeResponse, RecordView, SavedView, SpaceView } from "@assistant/shared";
import { proposeWeek } from "../src/core/assistant/this-week.ts";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("this week", () => {
  it("proposes a quick add, a date reminder and taking a finished card off; tapping one makes it", async () => {
    const me = await signUp("Test Owner");
    const { user } = await json<MeResponse>(await api(me)("/me"));
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    // Six expenses by hand this week, with a pinned card and no quick add.
    for (let i = 0; i < 6; i++)
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: `Test chai ${i}`, Amount: "40" } },
      });
    await api(me)("/views", {
      body: { name: "Spent", collection: "Expenses", pinned: true, filters: [], mode: "list" },
    });
    // A list with a date and money where a date went by this week, and nothing watching it.
    await api(me)("/collections", {
      body: {
        name: "Invoices",
        fields: [
          { name: "Title", type: "text" },
          { name: "Due", type: "date" },
          { name: "Amount", type: "money" },
        ],
      },
    });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await api(me)("/collections/Invoices/records", {
      body: { values: { Title: "Test club invoice", Due: yesterday, Amount: "15000" } },
    });
    // A pinned reminders card where everything is ticked.
    const r = await json<RecordView>(
      await api(me)("/collections/Reminders/records", {
        body: { values: { Title: "Test done thing", Done: true } },
      }),
    );
    expect(r.id).toBeTruthy();
    const today = await json<SavedView>(
      await api(me)("/views", {
        body: { name: "Today", collection: "Reminders", pinned: true, filters: [], mode: "list" },
      }),
    );

    expect(await proposeWeek(env, user.id, space!.id, new Date())).toBe(3);
    const chat = await json<ChatView>(await api(me)("/chats/main"));
    const cards = chat.items.filter((i) => i.card);
    expect(cards.map((c) => c.card!.title)).toEqual([
      "A quick add for Expenses",
      "A reminder when Due comes in Invoices",
      "Take “Today” off the home",
    ]);
    expect(chat.items[0]?.text).toContain("This week: 3 ideas");
    // A tap makes the proposal real: the quick add lands on the card.
    const quick = cards[0]!.card!;
    expect((await api(me)(`/chats/main/actions/${quick.action_id}/confirm`, { method: "POST" })).status).toBe(
      200,
    );
    const views = await json<SavedView[]>(await api(me)("/views"));
    expect(views.find((v) => v.name === "Spent")?.add_fields.length).toBeGreaterThan(0);
    // The same week twice: the message isn't posted again.
    await proposeWeek(env, user.id, space!.id, new Date());
    const again = await json<ChatView>(await api(me)("/chats/main"));
    expect(again.items.filter((i) => i.text.startsWith("This week:")).length).toBe(1);
    expect(today.pinned).toBe(true);
  });
});
