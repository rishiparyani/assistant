// Questions with answers to tap (decision 2026-10-17): the assistant asks, the turn stops
// there, and the tap comes back as the person's next message. Scripted test model only.
import { describe, expect, it } from "vitest";
import type { ChatView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

describe("questions with answers to tap", () => {
  it("shows the question and its answers, and waits for the tap", async () => {
    const me = await signUp("Test Owner");
    const chat = await json<ChatView>(
      await call("/api/chat", { cookie: me.cookie, body: { text: "Test: ask me" } }),
    );
    const last = chat.items.at(-1)!;
    expect(last.role).toBe("choices");
    expect(last.choices).toEqual({
      question: "How often should the reminder come?",
      options: [
        { label: "Every week", description: "Each Monday morning" },
        { label: "Every month", description: "On the 1st" },
      ],
    });
    // In words too (an older app shows that), and nothing after it: the turn waits.
    expect(last.text).toMatch(/How often[\s\S]*Every week: Each Monday morning/);
    // The tap is just the next message; the conversation goes on from there.
    const next = await json<ChatView>(
      await call("/api/chat", { cookie: me.cookie, body: { text: "Every week" } }),
    );
    expect(next.items.some((i) => i.role === "user" && i.text === "Every week")).toBe(true);
    expect(next.items.at(-1)!.role).toBe("assistant");
  });
});
