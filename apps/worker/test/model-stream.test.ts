// Replies as they're written (decision 2026-10-22): a maker's stream is put back together
// as the whole answer the router reads, while its words go out as they come.
import { describe, expect, it } from "vitest";
import {
  ModelError,
  fromAnthropic,
  fromResponses,
  readAnthropicStream,
  readChatCompletionsStream,
  readResponsesStream,
  toAnthropic,
  toResponses,
  type ChatMessage,
} from "../src/core/assistant/client.ts";

const sse = (events: string[]) => new Response(events.map((e) => `${e}\n\n`).join("")).body!;
const data = (o: unknown) => `data: ${JSON.stringify(o)}`;

describe("streams", () => {
  it("reads a chat-completions stream: words, a tool call in pieces, the usage at the end", async () => {
    const words: string[] = [];
    const raw = await readChatCompletionsStream(
      sse([
        data({ choices: [{ delta: { role: "assistant", content: "" } }] }),
        data({ choices: [{ delta: { content: "Adding " } }] }),
        data({ choices: [{ delta: { content: "it." } }] }),
        data({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", type: "function", function: { name: "add_", arguments: "" } },
                ],
              },
            },
          ],
        }),
        data({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { name: "record", arguments: '{"collection":' } }],
              },
            },
          ],
        }),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Test"}' } }] } }] }),
        data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        data({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        "data: [DONE]",
      ]),
      (t) => words.push(t),
    );
    expect(words).toEqual(["Adding ", "it."]);
    expect(raw.choices?.[0]?.message).toEqual({
      content: "Adding it.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "add_record", arguments: '{"collection":"Test"}' },
        },
      ],
    });
    expect(raw.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });

  it("reads a Messages API stream: thinking kept as sent, text, a tool call's JSON in pieces, usage", async () => {
    const words: string[] = [];
    const raw = await readAnthropicStream(
      sse([
        "event: message_start\n" +
          data({
            type: "message_start",
            message: { usage: { input_tokens: 20, cache_read_input_tokens: 5 } },
          }),
        data({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
        data({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
        data({
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig1" },
        }),
        data({ type: "content_block_stop", index: 0 }),
        data({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
        data({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "On " } }),
        data({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "it." } }),
        data({ type: "content_block_stop", index: 1 }),
        data({
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "t1", name: "find_records", input: {} },
        }),
        data({
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{"collec' },
        }),
        data({
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: 'tion":"Test"}' },
        }),
        data({ type: "content_block_stop", index: 2 }),
        data({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }),
        data({ type: "message_stop" }),
      ]),
      (t) => words.push(t),
    );
    expect(words).toEqual(["On ", "it."]);
    const answer = fromAnthropic(raw);
    expect(answer.content).toBe("On it.");
    expect(answer.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "find_records", arguments: '{"collection":"Test"}' } },
    ]);
    expect(answer.opaque).toEqual([{ type: "thinking", thinking: "hmm", signature: "sig1" }]);
    expect(answer.usage).toEqual({ input: 25, output: 7, cached: 5, cacheWrite: 0 });
    expect(raw.stop_reason).toBe("tool_use");
  });

  it("takes events split across chunks and ignores what isn't JSON", async () => {
    const parts = [
      'data: {"choices":[{"delta":{"content":"He',
      'llo"}}]}\n\ndata: not json\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
    const words: string[] = [];
    const raw = await readChatCompletionsStream(body, (t) => words.push(t));
    expect(words).toEqual(["Hello", " there"]);
    expect(raw.choices?.[0]?.message?.content).toBe("Hello there");
  });

  it("refuses a stream that ends before its last marker, or carries an error", async () => {
    const none = () => undefined;
    // Chat completions: no [DONE].
    await expect(
      readChatCompletionsStream(sse([data({ choices: [{ delta: { content: "Half" } }] })]), none),
    ).rejects.toBeInstanceOf(ModelError);
    // Chat completions: an error event.
    await expect(
      readChatCompletionsStream(sse([data({ error: { message: "x" } }), "data: [DONE]"]), none),
    ).rejects.toBeInstanceOf(ModelError);
    // Messages API: no message_stop.
    await expect(
      readAnthropicStream(
        sse([
          data({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
          data({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half" } }),
        ]),
        none,
      ),
    ).rejects.toBeInstanceOf(ModelError);
    // Messages API: an error event.
    await expect(
      readAnthropicStream(sse([data({ type: "error", error: { type: "overloaded_error" } })]), none),
    ).rejects.toBeInstanceOf(ModelError);
    // A whole one still reads.
    const ok = await readChatCompletionsStream(
      sse([data({ choices: [{ delta: { content: "Whole" } }] }), "data: [DONE]"]),
      none,
    );
    expect(ok.choices?.[0]?.message?.content).toBe("Whole");
  });

  it("reads a Responses API stream: words as they come, the whole answer from the final event", async () => {
    const words: string[] = [];
    const final = {
      status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", encrypted_content: "opaque==", summary: [] },
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "On it." }],
        },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "find_records",
          arguments: '{"collection":"Test"}',
        },
      ],
      usage: { input_tokens: 30, output_tokens: 9, input_tokens_details: { cached_tokens: 20 } },
    };
    const raw = await readResponsesStream(
      sse([
        "event: response.created\n" + data({ type: "response.created", response: { status: "in_progress" } }),
        data({
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "rs_1" },
        }),
        data({ type: "response.output_text.delta", delta: "On " }),
        data({ type: "response.output_text.delta", delta: "it." }),
        data({ type: "response.function_call_arguments.delta", delta: '{"collec' }),
        data({ type: "response.function_call_arguments.delta", delta: 'tion":"Test"}' }),
        "event: response.completed\n" + data({ type: "response.completed", response: final }),
      ]),
      (t) => words.push(t),
    );
    expect(words).toEqual(["On ", "it."]);
    const answer = fromResponses(raw);
    expect(answer.content).toBe("On it.");
    expect(answer.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "find_records", arguments: '{"collection":"Test"}' },
      },
    ]);
    expect(answer.opaque).toEqual([
      { type: "reasoning", id: "rs_1", encrypted_content: "opaque==", summary: [] },
    ]);
    expect(answer.usage).toEqual({ input: 30, output: 9, cached: 20 });
    // No final event, or a failure: not an answer.
    await expect(
      readResponsesStream(
        sse([data({ type: "response.output_text.delta", delta: "Half" })]),
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ModelError);
    await expect(
      readResponsesStream(
        sse([data({ type: "response.failed", response: { status: "failed" } })]),
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ModelError);
    // Cut off (max_output_tokens): not an answer either (Codex on PR 181).
    await expect(
      readResponsesStream(
        sse([
          data({ type: "response.output_text.delta", delta: "Half" }),
          data({
            type: "response.incomplete",
            response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          }),
        ]),
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ModelError);
  });

  it("hands each maker only its own opaque blocks (a fallback mid-setup; Codex on PR 181)", () => {
    const turn: ChatMessage[] = [
      { role: "user", content: "Add milk" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "add_record", arguments: "{}" } }],
        opaque: [
          { type: "thinking", thinking: "hmm", signature: "sig" },
          { type: "reasoning", id: "rs_1", encrypted_content: "x" },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "{}" },
    ];
    expect(toResponses(turn).input.filter((i) => i.type === "reasoning")).toEqual([
      { type: "reasoning", id: "rs_1", encrypted_content: "x" },
    ]);
    const blocks = toAnthropic(turn).messages[1]?.content ?? [];
    expect(blocks.filter((b) => b.type === "thinking")).toEqual([
      { type: "thinking", thinking: "hmm", signature: "sig" },
    ]);
    expect(blocks.some((b) => (b as { type: string }).type === "reasoning")).toBe(false);
  });

  it("puts the conversation in the Responses API's shape: instructions, calls, outputs, reasoning first", () => {
    const conv = toResponses([
      { role: "system", content: "Be brief." },
      { role: "system", content: "Today is Friday." },
      { role: "user", content: "Add milk" },
      {
        role: "assistant",
        content: "Adding it.",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "add_record", arguments: '{"a":1}' } },
        ],
        opaque: [{ type: "reasoning", id: "rs_1", encrypted_content: "x" }],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"ok":true}' },
    ]);
    expect(conv.instructions).toBe("Be brief.\n\nToday is Friday.");
    expect(conv.input).toEqual([
      { type: "message", role: "user", content: "Add milk" },
      { type: "reasoning", id: "rs_1", encrypted_content: "x" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Adding it." }] },
      { type: "function_call", call_id: "call_1", name: "add_record", arguments: '{"a":1}' },
      { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' },
    ]);
  });
});
