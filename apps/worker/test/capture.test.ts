// The Inbox (home-first.md §2 point 12): something captured goes in the Inbox list (a card on
// the home from the start) and into the chat, where the assistant says where it goes. Fake
// data only.
import { describe, expect, it } from "vitest";
import type { ChatView, RecordView, SavedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("the inbox", () => {
  it("keeps what was captured, pins the Inbox card, and asks the assistant where it goes", async () => {
    const me = await signUp("Test Owner");
    const res = await api(me)("/inbox", { body: { text: "Strings ₹450 at Furtados", source: "siri" } });
    expect(res.status).toBe(201);
    const { record, guess } = await json<{ record: RecordView; guess: string | null }>(res);
    expect(record.named.Text).toBe("Strings ₹450 at Furtados");
    expect(record.named.Source).toBe("Siri");
    expect(record.named.Sorted).toBe("No");
    // The scripted model answers something; it's kept as the guess.
    expect(guess).toBeTruthy();
    expect(record.named.Guess).toBe(guess);
    // The chat holds the capture and the answer.
    const chat = await json<ChatView>(await api(me)("/chats/main"));
    expect(
      chat.items.some((i) => i.role === "user" && i.text.startsWith("Captured from Siri: Strings")),
    ).toBe(true);
    // The Inbox is a pinned card on the home, showing what isn't sorted yet.
    const views = await json<SavedView[]>(await api(me)("/views"));
    const inbox = views.find((v) => v.name === "Inbox");
    expect(inbox?.pinned).toBe(true);
    expect(inbox?.filters).toEqual([expect.objectContaining({ op: "ne", value: true })]);
    // A second capture reuses the list; a person without the assistant still gets the record.
    const other = await signUp("Test Other", undefined, { assistant: false });
    const r2 = await json<{ record: RecordView; guess: string | null }>(
      await api(other)("/inbox", { body: { text: "Call Dev about Saturday" } }),
    );
    expect(r2.record.named.Source).toBe("Other");
    expect(r2.guess).toBeNull();
  });

  it("only proposes where a capture goes: the filing waits for a tap", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/inbox", { body: { text: "Test PA needs two DI boxes", source: "share" } });
    // The model filed it as a note, but in the Inbox turn that's a card, not a write.
    const chat = await json<ChatView>(await api(me)("/chats/main"));
    const card = chat.items.find((i) => i.card)?.card;
    expect(card?.tool).toBe("add_record");
    expect(card?.status).toBe("waiting");
    const notes = await json<{ items: RecordView[] }>(await api(me)("/collections/Notes/find", { body: {} }));
    expect(notes.items.some((r) => r.title === "Test PA needs two DI boxes")).toBe(false);
    // The tap files it.
    expect((await api(me)(`/chats/main/actions/${card!.action_id}/confirm`, { method: "POST" })).status).toBe(
      200,
    );
    const after = await json<{ items: RecordView[] }>(await api(me)("/collections/Notes/find", { body: {} }));
    expect(after.items.some((r) => r.title === "Test PA needs two DI boxes")).toBe(true);
  });
});
