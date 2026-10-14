// How the assistant is doing (decision 2026-10-14 "We don't read people's data"): each
// request leaves numbers and tool names, cards and undos leave signals, 👍 / 👎 is a count,
// and none of it keeps a word anyone wrote. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { ChatView, HistoryItem } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const say = (u: User, text: string) =>
  call("/api/chat", { cookie: u.cookie, body: { text } }).then((r) => json<ChatView>(r));
const budget = () => env.BUDGET.get(env.BUDGET.idFromName("budget:global"));

/** Every turn and signal row this person left, as stored. */
function rowsOf(userId: string) {
  return runInDurableObject(budget(), async (_i, state) => ({
    turns: state.storage.sql.exec(`select * from turns where user_id = ?`, userId).toArray(),
    signals: state.storage.sql.exec(`select * from signals where user_id = ?`, userId).toArray(),
  }));
}

describe("assistant quality numbers", () => {
  it("logs each request as counts and tool names, never words", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Test: note the PA needs two DI boxes");
    const view = await say(me, "Test: spent 450 on groceries");
    const card = view.items.find((i) => i.role === "card")!;
    await call(`/api/chat/actions/${card.card!.action_id}/cancel`, { cookie: me.cookie, body: {} });
    await call("/api/chat/feedback", { cookie: me.cookie, body: { rating: "good" } });

    const { turns, signals } = await rowsOf(me.id);
    expect(turns.map((t) => [t.outcome, t.level])).toEqual([
      ["answered", 1],
      ["card", 1],
    ]);
    expect(JSON.parse(String(turns[0]!.tools_json))).toEqual({ add_record: 1 });
    expect(turns[0]!.steps).toBe(2);
    expect(signals.map((x) => [x.kind, x.tool])).toEqual([
      ["card_cancelled", "add_record"],
      ["good", null],
    ]);
    // Nothing the person wrote, or the assistant answered, is anywhere in the rows.
    const stored = JSON.stringify({ turns, signals });
    for (const word of ["DI boxes", "groceries", "450", "Done"]) expect(stored).not.toContain(word);
  });

  it("counts refusals by tool and kind, not by message", async () => {
    const me = await signUp("Test Owner");
    await say(me, "Test: note the PA needs two DI boxes");
    // A name that isn't there: the engine refuses the query.
    await say(me, "Test: notes by month");
    const { turns } = await rowsOf(me.id);
    const errors = JSON.parse(String(turns.at(-1)!.errors_json)) as Record<string, number>;
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    for (const k of Object.keys(errors)) expect(k).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it("counts confirmed cards and undos, and adds them up for the admin panel", async () => {
    const me = await signUp("Test Owner");
    const before = await budget().quality(7);
    await say(me, "Test: note the PA needs two DI boxes");
    const view = await say(me, "Test: spent 450 on groceries");
    const card = view.items.find((i) => i.role === "card")!;
    await call(`/api/chat/actions/${card.card!.action_id}/confirm`, { cookie: me.cookie, body: {} });
    const history = await json<HistoryItem[]>(await call("/api/history", { cookie: me.cookie }));
    const added = history.find((h) => h.undoable)!;
    expect(
      (await call(`/api/history/${added.id}/undo`, { cookie: me.cookie, body: {} })).status,
    ).toBeLessThan(300);
    await call("/api/chat/feedback", { cookie: me.cookie, body: { rating: "bad" } });

    const q = await budget().quality(7);
    const d = (k: string) => (q.signals[k] ?? 0) - (before.signals[k] ?? 0);
    expect(q.requests - before.requests).toBe(2);
    expect([d("card_confirmed"), d("undone"), d("bad")]).toEqual([1, 1, 1]);
    expect(q.median_ms).not.toBeNull();
    expect(q.prompt_versions.length).toBeGreaterThan(0);
    expect(q.models.length).toBeGreaterThan(0);
  });

  it("takes only good or bad", async () => {
    const me = await signUp("Test Owner");
    const r = await call("/api/chat/feedback", {
      cookie: me.cookie,
      body: { rating: "loved the bit about my mum" },
    });
    expect(r.status).toBe(400);
    expect((await rowsOf(me.id)).signals).toEqual([]);
  });
});
