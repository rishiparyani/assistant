// Calls one model (docs/design/universal.md §10). Workers AI models go through the AI
// binding with the gateway of the model's billing route; the answer comes back in the
// chat-completions shape (text, tool calls, token counts). No logic about what people said.
import type { AiSettings, KeyedProvider, ModelEntry } from "./models.ts";
import { fakeModel } from "./fake-model.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** A maker's opaque blocks from this turn (Anthropic's signed thinking), handed back
   *  unchanged with the tool results of the same turn, as it requires. Never stored. */
  opaque?: unknown[];
}
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ModelAnswer {
  content: string | null;
  tool_calls: ToolCall[];
  /** cached: of the input tokens, how many the model reused from its prompt cache;
   *  cacheWrite: how many it stored for next time (priced differently by some makers). */
  usage: { input: number; output: number; cached: number; cacheWrite?: number };
  /** Opaque blocks to hand back with this turn's tool results (see ChatMessage.opaque). */
  opaque?: unknown[];
}

export class ModelError extends Error {}

/** Words of the answer as the model writes them (decision 2026-10-22 "Replies as they're written"). */
export type OnText = (text: string) => void;

type WorkersAiResult = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

export async function callModel(
  ai: Ai | undefined,
  settings: AiSettings,
  model: ModelEntry,
  messages: ChatMessage[],
  tools: ToolSpec[],
  /** One id per conversation: calls with the same id go to the same model server, which
   *  keeps what it already read of the prompt (prefix caching) and skips reading it again. */
  affinity?: string,
  /** Providers' own keys (never in settings, which the admin panel and tests read). */
  keys: Partial<Record<KeyedProvider | "cerebras", string>> = {},
  /** Given, the answer is streamed and its words come here as they're written (makers with
   *  their own key; Workers AI answers whole). */
  onText?: OnText,
): Promise<ModelAnswer> {
  if (settings.fake) {
    const answer = fakeModel(model, messages, tools);
    // Word by word, as a real stream would, so the plumbing is tested.
    if (onText && answer.content) for (const w of answer.content.split(/(?<= )/)) onText(w);
    return answer;
  }
  if (model.provider === "anthropic") return callAnthropic(keys.anthropic, model, messages, tools, onText);
  if (model.provider === "cerebras" || model.provider === "openai" || model.provider === "gemini")
    return callChatCompletions(
      OPENAI_SHAPED[model.provider],
      keys[model.provider],
      model,
      messages,
      tools,
      onText,
    );
  if (model.provider !== "workers-ai" || !ai) throw new ModelError(`${model.label} isn't available`);
  const gateway = model.route === "free" ? "default" : settings.paidGateway;
  if (!gateway) throw new ModelError(`${model.label} needs AI credit`);
  let raw: WorkersAiResult;
  try {
    raw = (await ai.run(
      model.id as keyof AiModels,
      {
        messages,
        tools,
        max_tokens: model.maxOutput,
        temperature: 0.2,
        ...(model.thinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        ...(model.effort ? { reasoning_effort: model.effort } : {}),
      } as never,
      {
        // Never logged at the gateway: prompts carry people's own data (decision 2026-10-14
        // "We don't read people's data"); our own call log keeps counts only.
        gateway: { id: gateway, skipCache: true, collectLog: false },
        ...(affinity ? { extraHeaders: { "x-session-affinity": affinity } } : {}),
      },
    )) as WorkersAiResult;
  } catch (e) {
    throw new ModelError(e instanceof Error ? e.message : String(e));
  }
  const msg = raw.choices?.[0]?.message;
  if (!msg) throw new ModelError(`${model.label} gave no answer`);
  return {
    content: msg.content ?? null,
    tool_calls: (msg.tool_calls ?? []).filter((t) => t.type === "function"),
    usage: {
      input: raw.usage?.prompt_tokens ?? 0,
      output: raw.usage?.completion_tokens ?? 0,
      cached: raw.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

const CHAT_TIMEOUT_MS = 30_000;

/** Makers that take the OpenAI chat-completions shape straight, with a bearer key. */
const OPENAI_SHAPED = {
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    // GPT-OSS thinks before every answer; low is the least it accepts. Temperature is allowed.
    body: (m: ModelEntry) => ({
      max_completion_tokens: m.maxOutput,
      temperature: 0.2,
      reasoning_effort: m.effort === "high" || m.effort === "max" ? "high" : "low",
    }),
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    // Reasoning models take no temperature. On chat completions GPT-5.4 refuses function
    // tools together with any reasoning effort but "none" (a 400 naming reasoning_effort;
    // the Responses API would allow it), so these answer without thinking first.
    // GPT-6.1 Sol refuses "none", "low", "high" and nothing at all with tools here (it needs the
    // Responses API, not built yet). Effort "high"/"max" sends "high", "model" sends nothing,
    // anything else "none".
    body: (m: ModelEntry) => ({
      max_completion_tokens: m.maxOutput,
      ...(m.effort === "model"
        ? {}
        : { reasoning_effort: m.effort === "high" || m.effort === "max" ? "high" : "none" }),
    }),
  },
  gemini: {
    // The Gemini API's OpenAI-shaped endpoint: the same conversation, tools and usage fields
    // (its streams carry usage without being asked).
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    usageOption: false,
    body: (m: ModelEntry) => ({
      max_tokens: m.maxOutput,
      reasoning_effort: m.effort === "high" || m.effort === "max" ? "high" : "low",
    }),
  },
} as const;

/**
 * An OpenAI-shaped chat completions call straight to a maker with the owner's key (Cerebras:
 * decision 2026-10-15 "Faster answers from Cerebras"; OpenAI and Google: "Try the small
 * frontier models"). Nothing is logged there by us; a refusal (no credit, too many requests)
 * is a ModelError, so the next model answers instead.
 */
async function callChatCompletions(
  at: { url: string; body: (m: ModelEntry) => Record<string, unknown>; usageOption?: boolean },
  key: string | undefined,
  model: ModelEntry,
  messages: ChatMessage[],
  tools: ToolSpec[],
  onText?: OnText,
): Promise<ModelAnswer> {
  if (!key) throw new ModelError(`${model.label} isn't set up`);
  let res: Response;
  try {
    res = await fetch(at.url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages,
        ...(tools.length ? { tools } : {}),
        ...at.body(model),
        ...(onText
          ? { stream: true, ...(at.usageOption === false ? {} : { stream_options: { include_usage: true } }) }
          : {}),
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ModelError(`${model.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    throw new ModelError(
      res.status === 429
        ? `${model.label} is busy (rate limit)`
        : res.status === 401
          ? `${model.label} refused the key`
          : res.status === 402 || res.status === 403
            ? `${model.label} has no credit left`
            : `${model.label} answered ${res.status}${await errorCode(res)}`,
    );
  }
  const raw =
    onText && res.body
      ? await readChatCompletionsStream(res.body, onText)
      : ((await res.json()) as WorkersAiResult);
  const msg = raw.choices?.[0]?.message;
  if (!msg) throw new ModelError(`${model.label} gave no answer`);
  return {
    content: msg.content ?? null,
    tool_calls: (msg.tool_calls ?? []).filter((t) => t.type === "function"),
    usage: {
      input: raw.usage?.prompt_tokens ?? 0,
      output: raw.usage?.completion_tokens ?? 0,
      cached: raw.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

/** The data of each event of a server-sent stream, as text, until it ends or says [DONE]. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
    // Events end with a blank line; the last may still be arriving.
    const events = buf.split(/\r?\n\r?\n/);
    buf = done ? "" : (events.pop() ?? "");
    for (const ev of events) {
      const data = ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      if (data === "[DONE]") return;
      yield data;
    }
    if (done) return;
  }
}

type ChatChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: WorkersAiResult["usage"];
};

/**
 * A chat-completions stream put back together as the whole answer (the words going to onText
 * as they come; a tool call's arguments arrive in pieces, by index). Exported for tests.
 */
export async function readChatCompletionsStream(
  body: ReadableStream<Uint8Array>,
  onText: OnText,
): Promise<WorkersAiResult> {
  let content = "";
  const calls = new Map<number, ToolCall>();
  let usage: WorkersAiResult["usage"];
  for await (const data of sseData(body)) {
    let chunk: ChatChunk;
    try {
      chunk = JSON.parse(data) as ChatChunk;
    } catch {
      continue;
    }
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const [i, t] of (delta.tool_calls ?? []).entries()) {
      const at = t.index ?? i;
      const call = calls.get(at) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (t.id) call.id = t.id;
      if (t.function?.name) call.function.name += t.function.name;
      if (t.function?.arguments) call.function.arguments += t.function.arguments;
      calls.set(at, call);
    }
  }
  const tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  return {
    choices: [{ message: { content: content || null, ...(tool_calls.length ? { tool_calls } : {}) } }],
    ...(usage ? { usage } : {}),
  };
}

/**
 * What a maker's error names, for the log: its code, type and the parameter it objects to.
 * Never the message (it could echo the prompt; decision 2026-10-14 "We don't read people's
 * data"). Codes and parameter names are the maker's own words, not anyone's.
 */
async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { code?: unknown; type?: unknown; param?: unknown; message?: unknown };
    };
    const e = body.error ?? {};
    const parts = [e.code, e.type, e.param].filter(
      (x): x is string => typeof x === "string" && x.length < 80,
    );
    // A request-shape refusal says what the maker wants instead ("use /v1/responses or set
    // reasoning_effort to 'none'"; the codes alone hid that for a day). Only that kind, and
    // short: never a message that could carry the person's words.
    if (e.type === "invalid_request_error" && typeof e.message === "string")
      parts.push(e.message.replace(/\s+/g, " ").slice(0, 160));
    return parts.length ? ` (${parts.join(", ")})` : "";
  } catch {
    return "";
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_TIMEOUT_MS = 30_000;

type AnthropicBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "thinking" | "redacted_thinking"; [k: string]: unknown };
type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicBlock[] };
type AnthropicResult = {
  content?: AnthropicBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

/**
 * The chat-completions conversation in the Messages API's shape: system lines become the
 * system prompt (cached: it's the stable start of every call), tool calls become tool_use
 * blocks and tool replies tool_result blocks in the user turn that follows. Exported for tests.
 */
export function toAnthropic(messages: ChatMessage[]): {
  system: AnthropicBlock[];
  messages: AnthropicMessage[];
} {
  const system: AnthropicBlock[] = [];
  const out: AnthropicMessage[] = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]) => {
    if (!blocks.length) return;
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) system.push({ type: "text", text: m.content });
    } else if (m.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: m.content ?? "" }]);
    } else if (m.role === "assistant") {
      // Its thinking first, exactly as it came, then what it said and asked for.
      const blocks: AnthropicBlock[] = [...((m.opaque ?? []) as AnthropicBlock[])];
      if (m.content?.trim()) blocks.push({ type: "text", text: m.content });
      for (const t of m.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: t.id,
          name: t.function.name,
          input: parseArgs(t.function.arguments),
        });
      }
      push("assistant", blocks);
    } else if (m.content) {
      push("user", [{ type: "text", text: m.content }]);
    }
  }
  // The system prompt is the same for every call of a conversation: keep it in the cache.
  const lastSystem = system.at(-1);
  if (lastSystem && lastSystem.type === "text") lastSystem.cache_control = { type: "ephemeral" };
  return { system, messages: out };
}

/** A tool call's arguments as an object (a model's broken JSON becomes no arguments, never a crash). */
function parseArgs(text: string): unknown {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

/** The Messages API's answer in the chat-completions shape the router reads. Exported for tests. */
export function fromAnthropic(raw: AnthropicResult): ModelAnswer {
  const text = (raw.content ?? []).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const tool_calls: ToolCall[] = (raw.content ?? []).flatMap((b) =>
    b.type === "tool_use"
      ? [
          {
            id: b.id,
            type: "function" as const,
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          },
        ]
      : [],
  );
  const cached = raw.usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = raw.usage?.cache_creation_input_tokens ?? 0;
  const opaque = (raw.content ?? []).filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
  return {
    content: text || null,
    tool_calls,
    usage: {
      // Anthropic counts fresh, cached and stored tokens apart; the router wants the total,
      // and the parts for the price.
      input: (raw.usage?.input_tokens ?? 0) + cached + cacheWrite,
      output: raw.usage?.output_tokens ?? 0,
      cached,
      cacheWrite,
    },
    ...(opaque.length ? { opaque } : {}),
  };
}

/**
 * Anthropic (decision 2026-10-15 "Try the small frontier models"): the Messages API, straight
 * to Anthropic with the owner's key and prepaid credit there. Thinking stays on at the lowest
 * effort (it can't be turned off on these models). A refusal, no credit or too many requests is
 * a ModelError, so the next model answers instead. Nothing is logged there by us.
 */
async function callAnthropic(
  key: string | undefined,
  model: ModelEntry,
  messages: ChatMessage[],
  tools: ToolSpec[],
  onText?: OnText,
): Promise<ModelAnswer> {
  if (!key) throw new ModelError(`${model.label} isn't set up`);
  const conv = toAnthropic(messages);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: model.maxOutput,
        system: conv.system,
        messages: conv.messages,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters,
              })),
            }
          : {}),
        output_config: { effort: model.effort === "high" || model.effort === "max" ? model.effort : "low" },
        ...(onText ? { stream: true } : {}),
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ModelError(`${model.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    throw new ModelError(
      res.status === 429
        ? `${model.label} is busy (rate limit)`
        : res.status === 401 || res.status === 403
          ? `${model.label} refused the key`
          : res.status === 402
            ? `${model.label} has no credit left`
            : `${model.label} answered ${res.status}${await errorCode(res)}`,
    );
  }
  const raw =
    onText && res.body
      ? await readAnthropicStream(res.body, onText)
      : ((await res.json()) as AnthropicResult);
  if (raw.stop_reason === "refusal") throw new ModelError(`${model.label} declined to answer`);
  const answer = fromAnthropic(raw);
  if (answer.content === null && !answer.tool_calls.length)
    throw new ModelError(`${model.label} gave no answer`);
  return answer;
}

type AnthropicEvent =
  | { type: "message_start"; message: { usage?: AnthropicResult["usage"] } }
  | { type: "content_block_start"; index: number; content_block: Record<string, unknown> & { type: string } }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: "signature_delta"; signature: string };
    }
  | { type: "message_delta"; delta: { stop_reason?: string }; usage?: { output_tokens?: number } }
  | { type: string };

/**
 * A Messages API stream put back together as the whole message: text (going to onText as it
 * comes), tool calls (their input arrives as pieces of JSON) and thinking blocks exactly as
 * sent, so fromAnthropic reads it as it reads a whole answer. Exported for tests.
 */
export async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onText: OnText,
): Promise<AnthropicResult> {
  const blocks: (Record<string, unknown> & { type: string })[] = [];
  const json = new Map<number, string>();
  const raw: AnthropicResult = { content: [] };
  for await (const data of sseData(body)) {
    let ev: AnthropicEvent;
    try {
      ev = JSON.parse(data) as AnthropicEvent;
    } catch {
      continue;
    }
    if (ev.type === "message_start" && "message" in ev) {
      raw.usage = { ...(raw.usage ?? {}), ...(ev.message.usage ?? {}) };
    } else if (ev.type === "content_block_start" && "content_block" in ev) {
      blocks[ev.index] = { ...ev.content_block };
      if (ev.content_block.type === "tool_use") json.set(ev.index, "");
    } else if (ev.type === "content_block_delta" && "delta" in ev) {
      const b = blocks[ev.index];
      if (!b) continue;
      const d = ev.delta;
      if (d.type === "text_delta") {
        b.text = `${(b.text as string) ?? ""}${d.text}`;
        onText(d.text);
      } else if (d.type === "input_json_delta")
        json.set(ev.index, (json.get(ev.index) ?? "") + d.partial_json);
      else if (d.type === "thinking_delta") b.thinking = `${(b.thinking as string) ?? ""}${d.thinking}`;
      else if (d.type === "signature_delta") b.signature = d.signature;
    } else if (ev.type === "message_delta" && "delta" in ev) {
      if (ev.delta.stop_reason) raw.stop_reason = ev.delta.stop_reason;
      if (ev.usage?.output_tokens !== undefined)
        raw.usage = { ...(raw.usage ?? {}), output_tokens: ev.usage.output_tokens };
    }
  }
  for (const [i, text] of json) {
    const b = blocks[i];
    if (b) b.input = parseArgs(text);
  }
  raw.content = blocks.filter((b): b is AnthropicBlock & Record<string, unknown> => !!b) as AnthropicBlock[];
  return raw;
}
