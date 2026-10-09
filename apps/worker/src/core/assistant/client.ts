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
  usage: { input: number; output: number };
}

export class ModelError extends Error {}

type WorkersAiResult = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function callModel(
  ai: Ai | undefined,
  settings: AiSettings,
  model: ModelEntry,
  messages: ChatMessage[],
  tools: ToolSpec[],
): Promise<ModelAnswer> {
  if (settings.fake) return fakeModel(model, messages, tools);
  if (model.provider !== "workers-ai" || !ai) throw new ModelError(`${model.label} isn't available`);
  const gateway = model.route === "free" ? "default" : settings.paidGateway;
  if (!gateway) throw new ModelError(`${model.label} needs AI credit`);
  let raw: WorkersAiResult;
  try {
    raw = (await ai.run(
      model.id as keyof AiModels,
      { messages, tools, max_tokens: model.maxOutput, temperature: 0.2 } as never,
      { gateway: { id: gateway, skipCache: true } },
    )) as WorkersAiResult;
  } catch (e) {
    throw new ModelError(e instanceof Error ? e.message : String(e));
  }
  const msg = raw.choices?.[0]?.message;
  if (!msg) throw new ModelError(`${model.label} gave no answer`);
  return {
    content: msg.content ?? null,
    tool_calls: (msg.tool_calls ?? []).filter((t) => t.type === "function"),
    usage: { input: raw.usage?.prompt_tokens ?? 0, output: raw.usage?.completion_tokens ?? 0 },
  };
}
