// Claude models from Anthropic (decision 2026-10-15 "Try the small frontier models"): offered
// only through the scorecard until one wins, only with the key in, on Anthropic's own credit;
// the conversation crosses to the Messages API's shape and back without losing a tool call.
import { describe, expect, it } from "vitest";
import { modelsFor, type AiSettings } from "../src/core/assistant/models.ts";
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
  it("is tried only by the scorecard for now, and never bills the Cloudflare credit", () => {
    // Not in the app's everyday list, key or no key.
    expect(ids(modelsFor(1, base))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    expect(ids(modelsFor(1, { ...base, anthropic: true }))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    // The scorecard's pick: on its own, on the paid route (reserved against the app's cap),
    // never moved to the Cloudflare credit route even when that exists.
    const tried = modelsFor(1, { ...base, paidGateway: "paid", everydayModel: "claude-haiku-5-5" });
    expect(tried.map((m) => [m.id, m.route, m.provider])).toEqual([
      ["claude-haiku-5-5", "paid", "anthropic"],
    ]);
    // The same for the others in the comparison.
    for (const id of ["gpt-5.4-nano", "gpt-5.4-mini", "gemini-3.1-flash-lite"]) {
      expect(ids(modelsFor(1, { ...base, everydayModel: id }))).toEqual([id]);
      expect(ids(modelsFor(1, { ...base, openai: true, gemini: true }))).toEqual([
        "@cf/zai-org/glm-4.7-flash",
      ]);
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
    expect(answer.usage).toEqual({ input: 10_000, output: 50, cached: 9_000 });
  });
});
