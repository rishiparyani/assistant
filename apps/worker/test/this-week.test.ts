// This week (home-first.md §2 point 13): proposals from the person's data, as confirm cards in
// their chat, never actions. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
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
    // Six expenses by hand this week; the Expenses list's own card has no quick add.
    for (let i = 0; i < 6; i++)
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: `Test chai ${i}`, Amount: "40" } },
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
    // The Reminders list's own pinned card (Today) where everything is ticked.
    const r = await json<RecordView>(
      await api(me)("/collections/Reminders/records", {
        body: { values: { Title: "Test done thing", Done: true } },
      }),
    );
    expect(r.id).toBeTruthy();

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
    expect(views.some((v) => v.collection === "Expenses" && v.add_fields.length > 0)).toBe(true);
    // The same week twice: the message isn't posted again.
    await proposeWeek(env, user.id, space!.id, new Date());
    const again = await json<ChatView>(await api(me)("/chats/main"));
    expect(again.items.filter((i) => i.text.startsWith("This week:")).length).toBe(1);
    // The cards can be tapped all week, not just for the half hour a confirm card lasts.
    const chatStub = env.CHATS.get(env.CHATS.idFromName(`chat:${user.id}`));
    await runInDurableObject(chatStub, (_i, state) => {
      const rows = state.storage.sql
        .exec<{ created_at: string; expires_at: string | null }>(
          `select created_at, expires_at from actions where status = 'waiting'`,
        )
        .toArray();
      expect(rows.length).toBe(2);
      for (const r of rows)
        expect(Date.parse(r.expires_at!) - Date.parse(r.created_at)).toBeGreaterThan(6 * 86_400_000);
    });
  });

  it("proposes a quick add only when one can fill in the required fields", async () => {
    const me = await signUp("Test Owner");
    const { user } = await json<MeResponse>(await api(me)("/me"));
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    // Gigs: a required date fourth in line (a quick add must include it); Lineups: a required
    // link (a quick add can't fill it in), so no proposal.
    await api(me)("/collections", {
      body: {
        name: "Gigs",
        fields: [
          { name: "Title", type: "text" },
          { name: "Venue", type: "text" },
          { name: "City", type: "text" },
          { name: "Date", type: "date", required: true },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Lineups",
        fields: [
          { name: "Title", type: "text" },
          { name: "Gig", type: "link", required: true, options: { target: "Gigs" } },
        ],
      },
    });
    const gig = await json<RecordView>(
      await api(me)("/collections/Gigs/records", {
        body: { values: { Title: "Test gig 0", Date: "2030-01-01" } },
      }),
    );
    for (let i = 1; i < 6; i++)
      await api(me)("/collections/Gigs/records", {
        body: { values: { Title: `Test gig ${i}`, Date: "2030-01-01" } },
      });
    for (let i = 0; i < 6; i++)
      await api(me)("/collections/Lineups/records", {
        body: { values: { Title: `Test lineup ${i}`, Gig: gig.id } },
      });
    for (const name of ["Gigs", "Lineups"])
      await api(me)("/views", { body: { name: `All ${name}`, collection: name, pinned: true } });

    await proposeWeek(env, user.id, space!.id, new Date());
    const chat = await json<ChatView>(await api(me)("/chats/main"));
    const titles = chat.items.filter((i) => i.card).map((i) => i.card!.title);
    expect(titles).toContain("A quick add for Gigs");
    expect(titles).not.toContain("A quick add for Lineups");
    const quick = chat.items.find((i) => i.card?.title === "A quick add for Gigs")!.card!;
    expect(quick.details.join(" ")).toContain("Date");
    expect((await api(me)(`/chats/main/actions/${quick.action_id}/confirm`, { method: "POST" })).status).toBe(
      200,
    );
    const views = await json<SavedView[]>(await api(me)("/views"));
    expect(views.find((v) => v.name === "All Gigs")!.add_fields.length).toBeGreaterThan(0);
  });
});
