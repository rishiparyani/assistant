// Embeddings for search by meaning (home-first.md §4): Workers AI's free text model through
// the default AI Gateway, online only. In tests and local dev with the fake model, a cheap
// stand-in made from character trigrams, so the meaning path runs without any AI.
const MODEL = "@cf/baai/bge-base-en-v1.5";
const FAKE_DIMS = 128;

export interface Embedder {
  ai?: Ai;
  /** The scripted model (tests, local dev): no network, a stand-in vector. */
  fake: boolean;
}

export async function embed(e: Embedder, texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  if (e.fake || !e.ai) return texts.map(fakeEmbedding);
  try {
    const out = (await e.ai.run(MODEL as never, { text: texts.map((t) => t.slice(0, 2000)) } as never, {
      // Never logged at the gateway: the text is people's own (decision 2026-10-14).
      gateway: { id: "default", collectLog: false },
    })) as { data?: number[][] };
    return out.data && out.data.length === texts.length ? out.data : null;
  } catch (e) {
    console.warn("embedding failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Character trigrams hashed into a small vector: words that share letters land close. */
export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(FAKE_DIMS).fill(0);
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  for (let i = 0; i + 3 <= t.length; i++) {
    let h = 2166136261;
    for (const ch of t.slice(i, i + 3)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % FAKE_DIMS]! += 1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
