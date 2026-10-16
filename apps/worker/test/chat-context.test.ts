// The conversation the model reads (decision 2026-10-16 "Chats like Claude"): the whole chat,
// never cut at a count; a long one keeps its older part as a summary. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { ChatMessage } from "../src/core/assistant/client.ts";

const chat = (name: string) => env.CHATS.getByName(name);
const turn = (n: number) => [
  { role: "user" as const, content: `Test message ${n}`, shown: "user" as const },
  { role: "assistant" as const, content: `Test answer ${n}`, shown: "assistant" as const },
];
const contextOf = async (name: string, user: string) =>
  (await chat(name).context(user)) as unknown as ChatMessage[];

describe("chat context", () => {
  it("sends the whole conversation, not the last N messages", async () => {
    const c = chat("chat:test-ctx-1");
    for (let n = 1; n <= 40; n++) await c.append("test-ctx-1", turn(n));
    const ctx = await contextOf("chat:test-ctx-1", "test-ctx-1");
    expect(ctx).toHaveLength(80);
    expect(ctx[0]).toMatchObject({ role: "user", content: "Test message 1" });
    expect(ctx.at(-1)).toMatchObject({ role: "assistant", content: "Test answer 40" });
  });

  it("folds the older part into a summary the model reads first, keeping the newest turns", async () => {
    const c = chat("chat:test-ctx-2");
    for (let n = 1; n <= 10; n++) await c.append("test-ctx-2", turn(n));
    const sizeBefore = await c.contextSize("test-ctx-2");
    const older = await c.olderTurns("test-ctx-2", 3);
    expect(older).not.toBeNull();
    expect(older!.previous).toBeNull();
    // Turns 1 to 7 go to the summariser; 8, 9, 10 stay.
    expect(older!.transcript).toContain("person: Test message 1");
    expect(older!.transcript).toContain("assistant: Test answer 7");
    expect(older!.transcript).not.toContain("Test message 8");
    await c.setSummary("test-ctx-2", "Test summary of one to seven.", older!.upto);

    const ctx = await contextOf("chat:test-ctx-2", "test-ctx-2");
    expect(ctx[0]!.role).toBe("user");
    expect(ctx[0]!.content).toContain("Test summary of one to seven.");
    expect(ctx[1]!.role).toBe("assistant");
    expect(ctx.slice(2).map((m) => m.content)).toEqual([
      "Test message 8",
      "Test answer 8",
      "Test message 9",
      "Test answer 9",
      "Test message 10",
      "Test answer 10",
    ]);
    expect(await c.contextSize("test-ctx-2")).toBeLessThan(sizeBefore);
    // The next fold carries the earlier summary along.
    for (let n = 11; n <= 16; n++) await c.append("test-ctx-2", turn(n));
    const next = await c.olderTurns("test-ctx-2", 3);
    expect(next!.previous).toBe("Test summary of one to seven.");
    expect(next!.transcript).toContain("Test message 8");
    expect(next!.transcript).not.toContain("Test message 1\n");
    // Too little to fold: nothing.
    expect(await c.olderTurns("test-ctx-2", 20)).toBeNull();
  });

  it("clearing a chat drops its summary too", async () => {
    const c = chat("chat:test-ctx-3");
    for (let n = 1; n <= 6; n++) await c.append("test-ctx-3", turn(n));
    const older = await c.olderTurns("test-ctx-3", 2);
    await c.setSummary("test-ctx-3", "Test summary.", older!.upto);
    await c.clear("test-ctx-3");
    expect(await contextOf("chat:test-ctx-3", "test-ctx-3")).toEqual([]);
    expect(await c.contextSize("test-ctx-3")).toBe(0);
  });
});
