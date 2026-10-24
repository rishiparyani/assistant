// A decision made by Jev, TypeSafe AI's decision model (owner, 2026-10-24: "just enable Jev…
// for now, let's keep it all for me"): one question, named options, a calibrated pick with
// how sure it is. Used where the app picks for itself (a flow's Choose step, a suggested
// action on a message); the everyday model answers instead when Jev isn't set up, isn't for
// this person, or fails. No cap for now (the owner's call while it's only them): calls are
// logged to the budget like any model call, at no cost here (billed at TypeSafe).
//
// The wire format is TypeSafe's own SDK's (`@typesafe-ai/sdk` 0.7): POST {base}/v1/systemone
// with `{ state, questions: { name: { type: "choice", instructions, criteria } }, model }`,
// bearer auth; the answer is `{ model, answers: { name: { choice, confidence } }, usage }`.
import { ownerEmails } from "./access.ts";
import { parseVerdict, systemAsk } from "./system-call.ts";
import type { ChatMessage } from "./client.ts";

export const JEV_BASE = "https://api.typesafe.ai";
/** How long one Jev decision may take, headers and body together. */
export const JEV_TIMEOUT_MS = 30_000;

/** The response body read under the same deadline as the request. */
function readWithin(res: Response, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Jev timed out"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    res
      .json()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
export const JEV_DEFAULT_MODEL = "jev-latest";

export interface Verdict {
  label: string | null;
  confidence: number;
  why: string;
  /** Who decided: Jev, or the everyday model. */
  by: "jev" | "model";
}

type JevEnv = {
  TYPESAFE_API_KEY?: string;
  JEV_MODEL?: string;
  ADMIN_EMAILS?: string;
  AI_FAKE?: string;
  DB: D1Database;
};

/** Whether Jev decides for this person: a key is set, it isn't the fake run, and they're an owner. */
export async function jevFor(env: JevEnv, userId: string): Promise<boolean> {
  if (!env.TYPESAFE_API_KEY?.trim() || env.AI_FAKE === "1") return false;
  const owners = ownerEmails(env);
  if (!owners.length) return false;
  const row = await env.DB.prepare(`select lower(email) as email from "user" where id = ?`)
    .bind(userId)
    .first<{ email: string }>();
  return !!row && owners.includes(row.email);
}

/**
 * One choice question to Jev. `fetchFn` is the network (a test passes a stub). Throws on a
 * bad answer; the caller falls back to the model.
 */
export async function askJev(
  key: string,
  model: string,
  q: { state: string; question: string; labels: string[] },
  fetchFn: typeof fetch = fetch,
  timeoutMs = JEV_TIMEOUT_MS,
): Promise<{ label: string | null; confidence: number; usage: { input: number; output: number } }> {
  const criteria = Object.fromEntries(q.labels.map((l) => [l, null]));
  // A deadline on the whole exchange (headers and body), like the other model clients: a stalled
  // provider must not hold up the space's alarm (its due jobs, search sync, live pings); the
  // caller then falls back to the everyday model (Codex on PR 196).
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetchFn(`${JEV_BASE}/v1/systemone`, {
    signal,
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      state: q.state,
      questions: { pick: { type: "choice", instructions: q.question, criteria } },
      model,
    }),
  });
  if (!res.ok) throw new Error(`Jev answered ${res.status}`);
  const got = (await readWithin(res, signal)) as {
    answers?: { pick?: { choice?: unknown; confidence?: unknown } };
    usage?: { input_tokens?: number | null; output_tokens?: number | null };
  };
  const pick = got.answers?.pick;
  const choice = typeof pick?.choice === "string" ? pick.choice : null;
  const label = choice !== null ? (q.labels.find((l) => l === choice) ?? null) : null;
  const confidence =
    typeof pick?.confidence === "number" ? Math.min(1, Math.max(0, pick.confidence)) : label ? 0.5 : 0;
  return {
    label,
    confidence,
    usage: { input: got.usage?.input_tokens ?? 0, output: got.usage?.output_tokens ?? 0 },
  };
}

/**
 * The app's pick between named options: Jev when it's on for this person, else the everyday
 * model with the given messages (the same prompt as before). Logged to the budget either way.
 */
export async function decide(
  env: Env,
  userId: string,
  q: { state: string; question: string; labels: string[]; messages: ChatMessage[]; maxOutput: number },
): Promise<Verdict> {
  if (await jevFor(env, userId)) {
    const started = Date.now();
    const budget = env.BUDGET.get(env.BUDGET.idFromName("budget:global"));
    const model = env.JEV_MODEL?.trim() || JEV_DEFAULT_MODEL;
    try {
      const got = await askJev(env.TYPESAFE_API_KEY!, model, q);
      await budget.log({
        userId,
        level: 1,
        model: `jev:${model}`,
        inputTokens: got.usage.input,
        outputTokens: got.usage.output,
        cachedTokens: 0,
        costPaise: 0,
        neurons: 0,
        ms: Date.now() - started,
        outcome: "ok",
      });
      return {
        label: got.label,
        confidence: got.confidence,
        why: got.label ? "" : "Jev named no option",
        by: "jev",
      };
    } catch (e) {
      await budget.log({
        userId,
        level: 1,
        model: `jev:${model}`,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costPaise: 0,
        neurons: 0,
        ms: Date.now() - started,
        outcome: "error",
      });
      console.warn("Jev failed; the everyday model decides", e instanceof Error ? e.message : String(e));
    }
  }
  const { content, why } = await systemAsk(env, userId, q.messages, q.maxOutput);
  if (content === null) return { label: null, confidence: 0, why, by: "model" };
  return { ...parseVerdict(content, q.labels), by: "model" };
}
