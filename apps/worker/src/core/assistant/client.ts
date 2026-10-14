// Calls one model (docs/design/universal.md §10). Workers AI models go through the AI
// binding with the gateway of the model's billing route; the answer comes back in the
// chat-completions shape (text, tool calls, token counts). No logic about what people said.
import type { AiSettings, ModelEntry } from "./models.ts";
import { fakeModel } from "./fake-model.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
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
  /** cached: of the input tokens, how many the model reused from its prompt cache. */
  usage: { input: number; output: number; cached: number };
}

export class ModelError extends Error {}

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
): Promise<ModelAnswer> {
  if (settings.fake) return fakeModel(model, messages, tools);
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
