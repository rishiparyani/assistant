// Claude models from Anthropic (decisions 2026-10-15 "Try the small frontier models" and "Haiku
// for every day, Sonnet for setups"): the app's picks once the key is in, on Anthropic's own
// credit, GLM behind them; the conversation crosses to the Messages API's shape and back without
// losing a tool call.
import { describe, expect, it } from "vitest";
import { MODELS, costPaise, modelsFor, type AiSettings } from "../src/core/assistant/models.ts";
import { fromAnthropic, toAnthropic, type ChatMessage } from "../src/core/assistant/client.ts";

const base: AiSettings = {
  paidGateway: null,
  capPaise: 200_000,
  personCapPaise: 200_000,
  usdInr: 90,
  fake: true,
  everydayModel: null,
  fast: false,
  fastCallsPerDay: 60,
  fastCallsPerMinute: 4,
  anthropic: false,
  openai: false,
  gemini: false,
};
const ids = (ms: { id: string }[]) => ms.map((m) => m.id);

describe("Claude models", () => {
  it("answers every day and builds setups once the key is in, with GLM behind it", () => {
    // Without the key: GLM alone, the picks or not (decision 2026-10-15 "Haiku for every day,
    // Sonnet for setups").
    const picks = { everydayModel: "claude-haiku-5-5", setupModel: "claude-sonnet-5-5" };
    expect(ids(modelsFor(1, base))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    expect(ids(modelsFor(1, { ...base, ...picks }))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    expect(ids(modelsFor(2, { ...base, ...picks }))).toEqual([]);
    // With the key and the picks: Haiku first, GLM when it fails; Sonnet for setups. On the paid
    // route (reserved against the app's cap), never moved to the Cloudflare credit route.
    const on = { ...base, anthropic: true, ...picks };
    expect(modelsFor(1, on).map((m) => [m.id, m.route, m.provider])).toEqual([
      ["claude-haiku-5-5", "paid", "anthropic"],
      ["@cf/zai-org/glm-4.7-flash", "free", "workers-ai"],
    ]);
    expect(ids(modelsFor(1, { ...on, paidGateway: "paid" }))).toEqual([
      "claude-haiku-5-5",
      "@cf/zai-org/glm-4.7-flash",
    ]);
    expect(ids(modelsFor(2, on))).toEqual(["claude-sonnet-5-5"]);
    // The key alone (no picks): GLM first, Haiku behind it; Sonnet still builds setups.
    expect(ids(modelsFor(1, { ...base, anthropic: true }))).toEqual([
      "@cf/zai-org/glm-4.7-flash",
      "claude-haiku-5-5",
    ]);
    expect(ids(modelsFor(2, { ...base, anthropic: true }))).toEqual(["claude-sonnet-5-5"]);
    // Pinned (the scorecard): the pick alone, so its misses are its own; no pick, the usual list.
    expect(ids(modelsFor(1, { ...on, pinned: true }))).toEqual(["claude-haiku-5-5"]);
    expect(ids(modelsFor(1, { ...base, anthropic: true, pinned: true }))).toEqual([
      "@cf/zai-org/glm-4.7-flash",
      "claude-haiku-5-5",
    ]);
  });

  it("tries a scorecard candidate first, only at its level and only with its key", () => {
    expect(ids(modelsFor(2, { ...base, openai: true, setupModel: "gpt-5.4" }))).toEqual(["gpt-5.4"]);
    expect(ids(modelsFor(2, { ...base, setupModel: "gpt-5.4" }))).toEqual([]);
    expect(ids(modelsFor(1, { ...base, openai: true, setupModel: "gpt-5.4" }))).toEqual([
      "@cf/zai-org/glm-4.7-flash",
    ]);
    // The other makers' keys change nothing on their own.
    expect(ids(modelsFor(2, { ...base, openai: true, gemini: true }))).toEqual([]);
    for (const id of ["gpt-5.4-nano", "gpt-5.4-mini", "gemini-3.1-flash-lite"]) {
      const keys = { openai: true, gemini: true };
      expect(ids(modelsFor(1, { ...base, ...keys, everydayModel: id }))).toEqual([
        id,
        "@cf/zai-org/glm-4.7-flash",
      ]);
      expect(ids(modelsFor(1, { ...base, ...keys }))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    }
  });

  it("carries the conversation across and back", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You help with lists." },
      { role: "system", content: "Today is Thursday." },
      { role: "user", content: "Remind me to buy strings tomorrow" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "toolu_1",
            type: "function",
            function: { name: "add_record", arguments: '{"collection":"Reminders"}' },
          },
          { id: "toolu_2", type: "function", function: { name: "find_records", arguments: "not json" } },
        ],
      },
      { role: "tool", content: '{"id":"01H"}', tool_call_id: "toolu_1" },
      { role: "tool", content: "[]", tool_call_id: "toolu_2" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "Thanks" },
    ];
    const out = toAnthropic(messages);
    // Both system lines, the last one cached (the stable start of every call).
    expect(out.system.map((b) => (b.type === "text" ? b.text : ""))).toEqual([
      "You help with lists.",
      "Today is Thursday.",
    ]);
    expect(out.system[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    // Tool calls become tool_use blocks (bad JSON becomes an empty input, never a crash);
    // both replies land in the one user turn after them.
    expect(out.messages[1]!.content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "add_record", input: { collection: "Reminders" } },
      { type: "tool_use", id: "toolu_2", name: "find_records", input: {} },
    ]);
    expect(out.messages[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: '{"id":"01H"}' },
      { type: "tool_result", tool_use_id: "toolu_2", content: "[]" },
    ]);

    const answer = fromAnthropic({
      content: [
        { type: "thinking", thinking: "", signature: "sig-1" },
        { type: "text", text: "Adding it. " },
        { type: "tool_use", id: "toolu_3", name: "add_record", input: { values: { Title: "Buy strings" } } },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 1_000,
        output_tokens: 50,
        cache_read_input_tokens: 9_000,
        cache_creation_input_tokens: 0,
      },
    });
    expect(answer.content).toBe("Adding it. ");
    expect(answer.tool_calls).toEqual([
      {
        id: "toolu_3",
        type: "function",
        function: { name: "add_record", arguments: '{"values":{"Title":"Buy strings"}}' },
      },
    ]);
    // Input is the whole prompt; cached says how much of it the model reused.
    expect(answer.usage).toEqual({ input: 10_000, output: 50, cached: 9_000, cacheWrite: 0 });
    // Its thinking comes back opaque, and goes out again first in the same turn's assistant
    // message (Anthropic requires it with that turn's tool results).
    expect(answer.opaque).toEqual([{ type: "thinking", thinking: "", signature: "sig-1" }]);
    const again = toAnthropic([
      { role: "user", content: "Remind me" },
      { role: "assistant", content: answer.content, tool_calls: answer.tool_calls, opaque: answer.opaque },
      { role: "tool", content: "{}", tool_call_id: "toolu_3" },
    ]);
    expect(again.messages[1]!.content.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
  });

  it("prices cached input at the maker's cache rates", () => {
    const haiku = MODELS.find((m) => m.id === "claude-haiku-5-5")!;
    // 10,000 input tokens at $0.10/M is $0.001 = 9 paise at ₹90; with 9,000 of them cache reads
    // (a tenth of the price) and 1,000 fresh: 1,000 + 900 = 1,900 token-equivalents = 1.71 paise → 2.
    expect(costPaise(haiku, { input: 10_000, output: 0 }, 90)).toBe(9);
    expect(costPaise(haiku, { input: 10_000, output: 0, cached: 9_000 }, 90)).toBe(2);
    // A cache write costs 1.25×: 10,000 written = 12,500 → 11.25 paise → 12.
    expect(costPaise(haiku, { input: 10_000, output: 0, cacheWrite: 10_000 }, 90)).toBe(12);
    // A maker without cache prices charges every token in full.
    const glm = MODELS.find((m) => m.id === "@cf/zai-org/glm-4.7-flash")!;
    expect(costPaise(glm, { input: 10_000, output: 0, cached: 9_000 }, 90)).toBe(
      costPaise(glm, { input: 10_000, output: 0 }, 90),
    );
  });
});
