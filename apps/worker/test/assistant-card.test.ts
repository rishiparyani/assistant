// Cards the assistant designs (decision 2026-10-18 "Try A2UI"): a card that checks out shows in
// the chat with its lists resolved; one that doesn't comes back to the model in words and
// nothing is shown. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView, LiveRef } from "@assistant/shared";
import { showCard } from "../src/core/assistant/service.ts";
import { call, json, signUp } from "./http.ts";

const say = async (cookie: string, text: string) =>
  json<ChatView>(await call("/api/chat", { cookie, body: { text } }));

describe("cards the assistant designs", () => {
  it("shows a checked card with its list filled from the person's own", async () => {
    const me = await signUp("Test Card Maker");
    await say(me.cookie, "Test: remind me to call the venue");
    const chat = await say(me.cookie, "Test: show a card");
    const live = chat.items.filter((i) => i.role === "live").map((i) => i.live as LiveRef);
    const ui = live.find((l) => l.kind === "ui") as Extract<LiveRef, { kind: "ui" }> | undefined;
    expect(ui?.title).toBe("Test reminders board");
    expect(ui?.sources?.["/reminders"]?.name).toBe("Reminders");
    expect(ui?.sources?.["/reminders"]?.collection_id).toMatch(/^[0-9A-Z]{26}$/);
    // The list fills it on the device; the card starts with an empty one.
    expect(ui?.card.data).toEqual({ reminders: [] });
  });

  it("sends a card that can't be drawn back to the model, in words", async () => {
    const me = await signUp("Test Card Breaker");
    const chat = await say(me.cookie, "Test: show a bad card");
    expect(chat.items.some((i) => i.role === "live" && i.live?.kind === "ui")).toBe(false);
    const reply = chat.items.filter((i) => i.role === "assistant").at(-1)!.text ?? "";
    expect(reply).toMatch(/Sparkle/);
  });

  it("names a list that isn't there, and checks a source's path", () => {
    const card = (sources: object) => ({
      title: "x",
      parts: [{ id: "root", component: "Text", text: "hi" }],
      sources,
    });
    const lost = showCard(card({ "/things": { list: "Nowhere" } }), [], null);
    expect(lost.kind).toBe("error");
    expect(lost.text).toMatch(/No list called \\"Nowhere\\"/);
    const badPath = showCard(card({ "things/x": { list: "Nowhere" } }), [], null);
    expect(badPath.text).toMatch(/one word after a slash/);
  });

  it("pins a designed card to the home as a view, checked like the chat checks it", async () => {
    const me = await signUp("Test Card Pinner");
    await say(me.cookie, "Test: remind me to call the venue");
    const chat = await say(me.cookie, "Test: show a card");
    const ui = chat.items.find((i) => i.live?.kind === "ui")!.live as Extract<LiveRef, { kind: "ui" }>;
    const source = ui.sources!["/reminders"]!;
    const ok = await call("/api/views", {
      cookie: me.cookie,
      body: {
        name: ui.title,
        collection: source.collection_id,
        pinned: true,
        card: { ui: { parts: ui.card.parts, data: ui.card.data, sources: ui.sources } },
      },
    });
    expect(ok.status).toBe(201);
    const view = await json<{ id: string; card: { ui?: { parts: unknown[] } } | null }>(ok);
    expect(view.card?.ui?.parts.length).toBe(ui.card.parts.length);
    const bad = await call("/api/views", {
      cookie: me.cookie,
      body: {
        name: "Test broken card",
        collection: source.collection_id,
        pinned: true,
        card: { ui: { parts: [{ id: "root", component: "Sparkle" }] } },
      },
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/Sparkle/);
  });
});
