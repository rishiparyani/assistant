// One short model call made by the app itself, not by a person's message: a flow's Choose
// step, the morning line. The everyday models in the router's order, each reserved and
// settled against the caps and logged to the budget as that person's call; a short output
// cap, since these answers are a line or a verdict. Returns null when no model could answer.
import { callModel, ModelError, type ChatMessage } from "./client.ts";
import { FREE_NEURONS_PER_DAY, costPaise, estimateTokens, keyed, modelsFor, neuronsFor } from "./models.ts";
import { aiSettings } from "../context.ts";

export async function systemAsk(
  env: Env,
  userId: string,
  messages: ChatMessage[],
  maxOutput: number,
): Promise<{ content: string | null; why: string }> {
  const s = aiSettings(env);
  const keys = {
    anthropic: env.ANTHROPIC_API_KEY?.trim() || undefined,
    openai: env.OPENAI_API_KEY?.trim() || undefined,
    gemini: env.GEMINI_API_KEY?.trim() || undefined,
  };
  const budget = env.BUDGET.get(env.BUDGET.idFromName("budget:global"));
  const size = estimateTokens(JSON.stringify(messages));
  let why = "no model could answer";
  for (const m of modelsFor(1, s)) {
    // A short answer: the model's own cap would reserve far more than it needs.
    const model = { ...m, maxOutput };
    if (m.provider === "cerebras") continue;
    if (keyed(m) && !keys[keyed(m)!]) continue;
    let reservation: string | null = null;
    if (m.route === "free") {
      if ((await budget.neurons()) + neuronsFor(m, size, maxOutput) > FREE_NEURONS_PER_DAY) {
        why = "the free daily allowance is used";
        continue;
      }
    } else {
      const res = await budget.reserve(
        userId,
        costPaise(m, { input: size, output: maxOutput }, s.usdInr),
        s.capPaise,
        s.personCapPaise,
      );
      if (!res.ok) {
        why = "the monthly AI cap is reached";
        continue;
      }
      reservation = res.id;
    }
    const started = Date.now();
    const log = async (usage: { input: number; output: number; cached?: number }, outcome: string) => {
      const paise = m.route === "paid" ? costPaise(m, usage, s.usdInr) : 0;
      const neurons = m.route === "free" ? neuronsFor(m, usage.input, usage.output) : 0;
      if (reservation) await budget.settle(reservation, paise);
      if (neurons) await budget.neurons(neurons);
      await budget.log({
        userId,
        level: 1,
        model: m.id,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cachedTokens: usage.cached ?? 0,
        costPaise: paise,
        neurons,
        ms: Date.now() - started,
        outcome,
      });
    };
    try {
      const answer = await callModel(env.AI, s, model, messages, [], undefined, keys);
      await log(answer.usage, "ok");
      return { content: answer.content, why: "" };
    } catch (e) {
      await log({ input: 0, output: 0 }, "error");
      if (!(e instanceof ModelError)) throw e;
      why = "the model couldn't answer";
    }
  }
  return { content: null, why };
}
