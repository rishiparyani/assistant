// Replies as they're written (decision 2026-10-22): a maker's stream is put back together
// as the whole answer the router reads, while its words go out as they come.
import { describe, expect, it } from "vitest";
import {
  ModelError,
  fromAnthropic,
  readAnthropicStream,
  readChatCompletionsStream,
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
});
