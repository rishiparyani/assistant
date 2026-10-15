// The router's settings table (docs/design/universal.md §10 "Model router"): which models
// each level may use, on which billing route, at what price. Models change here, not in code.
// Prices from Cloudflare's Workers AI pricing (USD per million tokens) and Anthropic's.

export type Level = 1 | 2 | 3;
/** free: the default gateway on Standard billing (the daily free allowance, then it stops).
 *  paid: a gateway on Unified billing (prepaid credit), only when the owner has set one up. */
export type Route = "free" | "paid";

export interface ModelEntry {
  id: string;
  label: string;
  level: Level;
  route: Route;
  /** How it's called: Workers AI through the binding, or a maker straight (Cerebras,
   *  Anthropic, OpenAI, Google), each with the owner's own key and prepaid credit there
   *  (decisions 2026-10-15). */
  provider: "workers-ai" | "anthropic" | "cerebras" | "openai" | "gemini";
  /** USD per million tokens. */
  price: { input: number; output: number };
  /** What a cached input token costs, as a share of the input price: read (reused) and write
   *  (stored for next time). Makers without a discount leave it out (every token at full price). */
  cache?: { read: number; write: number };
  /** Workers AI neurons per million tokens (the free allowance is 10,000 a day). */
  neurons?: { input: number; output: number };
  maxOutput: number;
  /** false: answer without thinking first (much faster; the scorecard says whether it's as right). */
  thinking?: boolean;
  /** For models whose thinking can only be turned down, not off: the lowest level that works. */
  effort?: "none" | "low" | "high" | "max";
  /** Wired up in code; entries still waiting stay in the table, switched off. */
  ready: boolean;
}

export const MODELS: ModelEntry[] = [
  {
    id: "@cf/zai-org/glm-4.7-flash",
    label: "GLM 4.7 Flash",
    level: 1,
    route: "free",
    provider: "workers-ai",
    price: { input: 0.0605, output: 0.4 },
    neurons: { input: 5_500, output: 36_400 },
    maxOutput: 1_200,
    // It thinks before every answer unless told not to; everyday requests don't need it.
    thinking: false,
    ready: true,
  },
  // Candidates for the everyday level, tried through the scorecard (AI_EVERYDAY_MODEL picks one
  // there); not used by the app until one wins and is made ready (Claude Haiku 5.5 did, 2026-10-15). Prices are the makers' own
  // list prices as found 2026-10-13, to confirm against Workers AI's; neurons not known yet.
  {
    id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    level: 1,
    route: "free",
    provider: "workers-ai",
    price: { input: 0.3, output: 1.2 },
    maxOutput: 1_200,
    thinking: false,
    effort: "none",
    ready: false,
  },
  {
    id: "@cf/zai-org/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    level: 1,
    route: "free",
    provider: "workers-ai",
    price: { input: 0.15, output: 0.5 },
    maxOutput: 1_200,
    // Its thinking can't be turned off, only down.
    effort: "low",
    ready: false,
  },
  {
    id: "@cf/qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B",
    level: 1,
    route: "free",
    provider: "workers-ai",
    price: { input: 0.15, output: 0.47 },
    maxOutput: 1_200,
    thinking: false,
    ready: false,
  },
  // Faster answers (decision 2026-10-15 "Faster answers from Cerebras"): the same everyday
  // level, answered by Cerebras in a second or two. Only for people with faster answers on,
  // only while the key is set, and within its own daily cap; GLM stays the fallback.
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B (Cerebras)",
    level: 1,
    route: "free",
    provider: "cerebras",
    price: { input: 0.35, output: 0.75 },
    maxOutput: 1_200,
    // Its thinking can only be turned down, not off.
    effort: "low",
    ready: true,
  },
  // The comparison (decision 2026-10-15 "Try the small frontier models"): the makers' smallest
  // current models at the everyday level, tried through the scorecard (AI_EVERYDAY_MODEL), each
  // on its own prepaid credit and key. Not used by the app until one wins and is made ready.
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    level: 1,
    route: "paid",
    provider: "anthropic",
    price: { input: 0.1, output: 0.5 },
    // Anthropic: a cache read is a tenth of the input price, a (five-minute) write 1.25 times.
    cache: { read: 0.1, write: 1.25 },
    // Its thinking counts as output; room for it and the answer.
    maxOutput: 4_000,
    effort: "low",
    // The everyday default since 2026-10-15 (AI_EVERYDAY_MODEL; GLM answers without the key).
    ready: true,
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    level: 1,
    route: "paid",
    provider: "openai",
    price: { input: 0.2, output: 1.25 },
    // OpenAI: cached input at a tenth, no charge to write.
    cache: { read: 0.1, write: 1 },
    maxOutput: 4_000,
    effort: "low",
    ready: false,
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    level: 1,
    route: "paid",
    provider: "openai",
    price: { input: 0.75, output: 4.5 },
    cache: { read: 0.1, write: 1 },
    maxOutput: 4_000,
    effort: "low",
    ready: false,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    level: 1,
    route: "paid",
    provider: "gemini",
    price: { input: 0.25, output: 1.5 },
    // Gemini's implicit cache: a quarter of the input price for reused tokens.
    cache: { read: 0.25, write: 1 },
    maxOutput: 4_000,
    effort: "low",
    ready: false,
  },
  {
    id: "@cf/moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    level: 2,
    route: "paid",
    provider: "workers-ai",
    price: { input: 0.95, output: 4 },
    maxOutput: 3_000,
    ready: true,
  },
  // The setups comparison (decision 2026-10-15 "Try the small frontier models", second round):
  // candidates for the setups level, tried through the scorecard (AI_SETUP_MODEL), each on its
  // maker's credit. Not used by the app until one wins and is made ready (Claude Sonnet 5.5 did,
  // 2026-10-15, decision "Haiku for every day, Sonnet for setups"). Prices as found
  // 2026-10-15; a setup answer can be long, so room for it (and for thinking where it counts).
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    level: 2,
    route: "paid",
    provider: "anthropic",
    price: { input: 2, output: 10 },
    cache: { read: 0.1, write: 1.25 },
    maxOutput: 8_000,
    effort: "low",
    // The setups default since 2026-10-15 (AI_SETUP_MODEL; 21 of 21 on the setups scorecard).
    ready: true,
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    level: 2,
    route: "paid",
    provider: "openai",
    price: { input: 2.5, output: 15 },
    cache: { read: 0.1, write: 1 },
    maxOutput: 8_000,
    ready: false,
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    level: 2,
    route: "paid",
    provider: "gemini",
    price: { input: 2, output: 12 },
    cache: { read: 0.1, write: 1 },
    maxOutput: 8_000,
    effort: "low",
    ready: false,
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    level: 2,
    route: "paid",
    provider: "gemini",
    price: { input: 0.75, output: 3.75 },
    cache: { read: 0.1, write: 1 },
    maxOutput: 8_000,
    effort: "low",
    ready: false,
  },
];

/** The daily free Workers AI allowance (resets at 00:00 UTC, 5:30 AM IST). */
export const FREE_NEURONS_PER_DAY = 10_000;

export interface AiSettings {
  /** The Unified-billing gateway's id; empty until the owner loads prepaid credit. */
  paidGateway: string | null;
  /** Monthly cap for all paid AI, in paise (₹2,000 by default). */
  capPaise: number;
  /** Per person per month, in paise. */
  personCapPaise: number;
  /** Rupees per US dollar, for turning prices into paise (rounded up, so estimates err high). */
  usdInr: number;
  /** Tests only: a scripted model instead of Workers AI. */
  fake: boolean;
  /** The scorecard only: try this model (an id from MODELS) for everyday requests. */
  everydayModel?: string | null;
  /** The scorecard only: try this model for setups (level 2). */
  setupModel?: string | null;
  /** Faster answers (Cerebras) are set up: its key is in. */
  fast: boolean;
  /** Cerebras calls a day, all people together (its trial credit must last the month). */
  fastCallsPerDay: number;
  /** And a minute (the trial allows five). */
  fastCallsPerMinute: number;
  /** Anthropic is set up: its key is in (its models bill its own prepaid credit). */
  anthropic: boolean;
  /** OpenAI, the same way. */
  openai: boolean;
  /** Google (the Gemini API), the same way. */
  gemini: boolean;
}

/** Makers called straight with their own key, each billing its own prepaid credit. */
export type KeyedProvider = "anthropic" | "openai" | "gemini";
export const KEYED: readonly KeyedProvider[] = ["anthropic", "openai", "gemini"];
export const keyed = (m: ModelEntry): KeyedProvider | null =>
  (KEYED as readonly string[]).includes(m.provider) ? (m.provider as KeyedProvider) : null;

/** A call's token counts: input is the whole prompt; cached and written are the parts of it the
 *  maker priced differently (a reuse of its prompt cache, a store into it). */
export interface Usage {
  input: number;
  output: number;
  cached?: number;
  cacheWrite?: number;
}

/** Paise for a call of this size (rounded up), at the maker's cache prices where it has them. */
export function costPaise(m: ModelEntry, u: Usage, usdInr: number): number {
  const cached = m.cache ? Math.min(u.cached ?? 0, u.input) : 0;
  const written = m.cache ? Math.min(u.cacheWrite ?? 0, u.input - cached) : 0;
  const fresh = u.input - cached - written;
  const inputUsd = (fresh + cached * (m.cache?.read ?? 1) + written * (m.cache?.write ?? 1)) * m.price.input;
  const usd = (inputUsd + u.output * m.price.output) / 1_000_000;
  return Math.ceil(usd * usdInr * 100);
}

export function neuronsFor(m: ModelEntry, inputTokens: number, outputTokens: number): number {
  if (!m.neurons) return 0;
  return Math.ceil((inputTokens * m.neurons.input + outputTokens * m.neurons.output) / 1_000_000);
}

/** A rough token count for budgeting (about 3.5 characters a token; errs high). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/**
 * Models a level may use now, in order: the picked one (AI_EVERYDAY_MODEL, AI_SETUP_MODEL) first,
 * ready or not, then the ready ones as fallbacks when it fails or can't be paid for.
 * `fast`: this person has faster answers (Cerebras first among the fallbacks).
 */
export function modelsFor(level: Level, s: AiSettings, fast = false): ModelEntry[] {
  const want = level === 1 ? s.everydayModel : level === 2 ? s.setupModel : null;
  // A paid model needs its money: the Cloudflare credit route, or the provider's own key.
  const funded = (m: ModelEntry) => {
    const k = keyed(m);
    return m.route === "free" || (k ? s[k] : !!s.paidGateway);
  };
  const picked = want ? MODELS.find((m) => m.id === want && m.level === level && funded(m)) : null;
  // With AI credit a Workers AI candidate is billed to it (repeats would use up the free
  // allowance); Cerebras and Anthropic have their own credit.
  const first =
    picked && s.paidGateway && picked.provider === "workers-ai"
      ? { ...picked, route: "paid" as const }
      : picked;
  const fastFirst = (m: ModelEntry) => (m.provider === "cerebras" ? 0 : 1);
  const rest = MODELS.filter(
    (m) =>
      m.level === level &&
      m.ready &&
      m.id !== picked?.id &&
      funded(m) &&
      (m.provider !== "cerebras" || (s.fast && fast)),
  ).sort((a, b) => fastFirst(a) - fastFirst(b));
  return first ? [first, ...rest] : rest;
}
