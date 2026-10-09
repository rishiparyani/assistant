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
  /** How it's called: Workers AI through the binding, or a provider through the gateway. */
  provider: "workers-ai" | "anthropic";
  /** USD per million tokens. */
  price: { input: number; output: number };
  /** Workers AI neurons per million tokens (the free allowance is 10,000 a day). */
  neurons?: { input: number; output: number };
  maxOutput: number;
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
    ready: true,
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
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    level: 3,
    route: "paid",
    provider: "anthropic",
    price: { input: 2, output: 10 },
    maxOutput: 3_000,
    // Called through AI Gateway with the official SDK once prepaid credit is set up.
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
}

/** Paise for a call of this size (rounded up). */
export function costPaise(m: ModelEntry, inputTokens: number, outputTokens: number, usdInr: number): number {
  const usd = (inputTokens * m.price.input + outputTokens * m.price.output) / 1_000_000;
  return Math.ceil(usd * usdInr * 100);
}

export function neuronsFor(m: ModelEntry, inputTokens: number, outputTokens: number): number {
  if (!m.neurons) return 0;
  return Math.ceil((inputTokens * m.neurons.input + outputTokens * m.neurons.output) / 1_000_000);
}

/** A rough token count for budgeting (about 3.5 characters a token; errs high). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** Models a level may use now, in order. */
export function modelsFor(level: Level, s: AiSettings): ModelEntry[] {
  return MODELS.filter((m) => m.level === level && m.ready && (m.route === "free" || !!s.paidGateway));
}
