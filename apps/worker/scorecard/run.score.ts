// Runs the scorecard (cases.ts) against the real models: the whole app runs locally on fake
// data and only the AI binding reaches Cloudflare (remote bindings). Started by hand from
// GitHub Actions (.github/workflows/scorecard.yml); prints a Markdown table that goes in
// docs/scorecard/. Never part of `pnpm test`.
import { env } from "cloudflare:workers";
import { it } from "vitest";
import type { CallLog } from "../src/core/assistant/budget-object.ts";
import { CASES, signUp, say, type Case } from "./cases.ts";

interface Row {
  c: Case;
  ok: boolean;
  why: string;
  ms: number;
  calls: CallLog[];
}

const budget = () => {
  const ns = (env as unknown as { BUDGET: DurableObjectNamespace }).BUDGET;
  return ns.get(ns.idFromName("budget:global")) as unknown as {
    callsFor(userId: string, since: string): Promise<CallLog[]>;
  };
};
const paid = !!(env as unknown as { AI_PAID_GATEWAY?: string }).AI_PAID_GATEWAY?.trim();
const only = (env as unknown as { SCORECARD_ONLY?: string }).SCORECARD_ONLY?.trim();

it("scorecard", { timeout: 30 * 60_000 }, async () => {
  const rows: Row[] = [];
  const cases = CASES.filter((c) => (c.level === 1 || paid) && (!only || only.split(",").includes(c.id)));
  for (const c of cases) {
    const u = await signUp("Test Person", undefined, { lists: c.lists !== false });
    await c.seed?.(u);
    const since = new Date().toISOString();
    const started = Date.now();
    let ok = false;
    let why: string;
    try {
      const view = await say(u, c.text);
      const at = view.items.map((i) => i.role).lastIndexOf("user");
      const turn = view.items.slice(at + 1);
      const reply = turn
        .filter((i) => i.role === "assistant")
        .map((i) => i.text)
        .join("\n");
      const cards = turn.flatMap((i) => (i.card ? [i.card] : []));
      const calls = (await budget().callsFor(u.id, since)).length;
      const res = await c.check(u, { view, turn, reply, cards, calls });
      ok = res === null;
      why = res ?? "";
    } catch (e) {
      why = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    const ms = Date.now() - started;
    rows.push({ c, ok, why, ms, calls: await budget().callsFor(u.id, since) });
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id} (${ms} ms)${ok ? "" : `: ${why}`}`);
  }
  console.log("\n=== SCORECARD ===\n" + table(rows) + "\n=== END ===");
});

function table(rows: Row[]): string {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const lines: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  const models = [...new Set(rows.flatMap((r) => r.calls.map((c) => c.model)))];
  lines.push(`Scorecard ${day} · models: ${models.join(", ") || "none answered"}`, "");
  for (const level of [1, 2] as const) {
    const rs = rows.filter((r) => r.c.level === level);
    if (!rs.length) continue;
    const passed = rs.filter((r) => r.ok).length;
    const calls = rs.flatMap((r) => r.calls);
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const tokensIn = sum(calls.map((c) => c.inputTokens));
    const tokensOut = sum(calls.map((c) => c.outputTokens));
    lines.push(
      `**Level ${level} (${level === 1 ? "everyday" : "setups"}):** ${passed}/${rs.length} right · ` +
        `median ${(ms[Math.floor(ms.length / 2)]! / 1000).toFixed(1)} s, slowest ${(ms.at(-1)! / 1000).toFixed(1)} s · ` +
        `${calls.length} model calls, ${tokensIn} tokens in / ${tokensOut} out per run total · ` +
        `≈ ${Math.round(tokensIn / rs.length)} in / ${Math.round(tokensOut / rs.length)} out per request · ` +
        `${tokensIn ? Math.round((100 * sum(calls.map((c) => c.cachedTokens ?? 0))) / tokensIn) : 0}% of input reused from the cache · ` +
        `${sum(calls.map((c) => c.neurons))} neurons · ₹${(sum(calls.map((c) => c.costPaise)) / 100).toFixed(2)}`,
    );
    for (const lang of ["en", "hi-en"] as const) {
      const l = rs.filter((r) => r.c.lang === lang);
      if (l.length)
        lines.push(
          `  - ${lang === "en" ? "English" : "Hinglish"}: ${l.filter((r) => r.ok).length}/${l.length}`,
        );
    }
    lines.push("");
  }
  lines.push("| Case | What | Level | Result | Time | Calls | Tokens in/out | Why not |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows)
    lines.push(
      `| ${r.c.id} | ${r.c.about} | ${r.c.level} | ${r.ok ? "✅" : "❌"} | ${(r.ms / 1000).toFixed(1)} s | ${r.calls.length} | ` +
        `${sum(r.calls.map((c) => c.inputTokens))}/${sum(r.calls.map((c) => c.outputTokens))} | ${r.why.replace(/\|/g, "/").replace(/\n/g, " ")} |`,
    );
  if (!paid) lines.push("", "Level 2 (setups) not run: no AI credit yet (AI_PAID_GATEWAY is empty).");
  lines.push(
    "",
    "Not counted: search embeddings (bge-base, a few neurons per request on the free allowance); everything else is.",
  );
  return lines.join("\n");
}
