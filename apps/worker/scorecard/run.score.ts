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
/** What the model did in a case (made-up test data only), printed when the case fails. */
const steps = async (userId: string): Promise<string> => {
  const ns = (env as unknown as { CHATS: DurableObjectNamespace }).CHATS;
  const chat = ns.get(ns.idFromName(`chat:${userId}`)) as unknown as {
    context(userId: string): Promise<
      {
        role: string;
        content: string | null;
        tool_calls?: { function: { name: string; arguments: string } }[];
      }[]
    >;
  };
  const cut = (t: string) => (t.length > 240 ? `${t.slice(0, 240)}…` : t);
  return (await chat.context(userId))
    .flatMap((m) =>
      m.tool_calls?.length
        ? m.tool_calls.map((t) => `    → ${t.function.name} ${cut(t.function.arguments)}`)
        : m.role === "tool"
          ? [`    ← ${cut(m.content ?? "")}`]
          : [],
    )
    .join("\n");
};
const vars = env as unknown as Record<string, string | undefined>;
/** Setups (level 2) run with the Cloudflare credit route or a setups model tried on its maker's. */
const paid = !!vars.AI_PAID_GATEWAY?.trim() || !!vars.AI_SETUP_MODEL?.trim();
const only = vars.SCORECARD_ONLY?.trim();
/** core, hard (everyday cases), setups (level 2 only) or all. */
const suite = vars.SCORECARD_SUITE?.trim() || "all";
/** Each case this many times: a model that's right once may not be right every time. */
const repeat = Math.min(5, Math.max(1, Number(vars.SCORECARD_REPEAT) || 1));

async function runOnce(c: Case): Promise<Row> {
  const u = await signUp("Test Person", undefined, { lists: c.lists !== false });
  await c.seed?.(u);
  for (const said of c.before ?? []) await say(u, said);
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
  const made = await budget().callsFor(u.id, since);
  // A case the model never answered (allowance used up, an outage) isn't a pass.
  if (ok && !made.some((m) => m.outcome === "ok" && m.outputTokens > 0)) {
    ok = false;
    why = "no model answered";
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${c.id} (${ms} ms)${ok ? "" : `: ${why}`}`);
  if (!ok) console.log(await steps(u.id).catch(() => "    (steps not readable)"));
  return { c, ok, why, ms, calls: made };
}

it("scorecard", { timeout: 120 * 60_000 }, async () => {
  const rows: Row[] = [];
  const cases = CASES.filter(
    (c) =>
      (c.level === 1 || paid) &&
      (!only || only.split(",").includes(c.id)) &&
      (suite === "all" ||
        (suite === "setups" ? c.level === 2 : c.level === 1 && (c.suite ?? "core") === suite)),
  );
  // Cerebras's trial allows five calls a minute, Gemini's free tier about ten: space the
  // cases out by what each one used.
  const tried = `${vars.AI_EVERYDAY_MODEL ?? ""} ${vars.AI_SETUP_MODEL ?? ""}`;
  const paceMs = /cerebras|gpt-oss/i.test(tried) ? 15_000 : /gemini/i.test(tried) ? 7_000 : 0;
  for (let n = 0; n < repeat; n++)
    for (const c of cases) {
      const started = Date.now();
      const row = await runOnce(c);
      rows.push(row);
      const wait = paceMs ? paceMs * Math.max(1, row.calls.length) - (Date.now() - started) : 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  console.log("\n=== SCORECARD ===\n" + table(rows) + "\n=== END ===");
});

function table(rows: Row[]): string {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const lines: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  const models = [...new Set(rows.flatMap((r) => r.calls.map((c) => c.model)))];
  lines.push(
    `Scorecard ${day} · models: ${models.join(", ") || "none answered"} · suite: ${suite} · ${repeat} run(s) of each case`,
    "",
  );
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
        // Per run of the suite: totals over repeats are divided by the number of runs.
        `${Math.round(calls.length / repeat)} model calls, ${Math.round(tokensIn / repeat)} tokens in / ${Math.round(tokensOut / repeat)} out per run of the suite · ` +
        `≈ ${Math.round(tokensIn / rs.length)} in / ${Math.round(tokensOut / rs.length)} out per request · ` +
        `${tokensIn ? Math.round((100 * sum(calls.map((c) => c.cachedTokens ?? 0))) / tokensIn) : 0}% of input reused from the cache · ` +
        `${Math.round(sum(calls.map((c) => c.neurons)) / repeat)} neurons · ₹${(sum(calls.map((c) => c.costPaise)) / 100 / repeat).toFixed(2)} per run of the suite`,
    );
    const byCase = [...new Set(rs.map((r) => r.c))];
    if (repeat > 1)
      lines.push(
        `  - Right every time: ${byCase.filter((c) => rs.filter((r) => r.c === c).every((r) => r.ok)).length}/${byCase.length} cases (${repeat} runs each)`,
      );
    for (const s of ["core", "hard"] as const) {
      const l = rs.filter((r) => (r.c.suite ?? "core") === s);
      if (l.length)
        lines.push(`  - ${s === "core" ? "Core" : "Hard"}: ${l.filter((r) => r.ok).length}/${l.length}`);
    }
    for (const lang of ["en", "hi-en"] as const) {
      const l = rs.filter((r) => r.c.lang === lang);
      if (l.length)
        lines.push(
          `  - ${lang === "en" ? "English" : "Hinglish"}: ${l.filter((r) => r.ok).length}/${l.length}`,
        );
    }
    lines.push("");
  }
  lines.push(
    "| Case | Suite | What | Level | Right | Time (median) | Calls | Tokens in/out | Why not (first miss) |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of [...new Set(rows.map((r) => r.c))]) {
    const rs = rows.filter((r) => r.c === c);
    const good = rs.filter((r) => r.ok).length;
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const miss = rs.find((r) => !r.ok)?.why ?? "";
    const per = (f: (x: CallLog) => number) => Math.round(sum(rs.flatMap((r) => r.calls.map(f))) / rs.length);
    lines.push(
      `| ${c.id} | ${c.suite ?? "core"} | ${c.about} | ${c.level} | ${good === rs.length ? "✅" : good ? "⚠️" : "❌"} ${good}/${rs.length} | ` +
        `${(ms[Math.floor(ms.length / 2)]! / 1000).toFixed(1)} s | ${(sum(rs.map((r) => r.calls.length)) / rs.length).toFixed(1)} | ` +
        `${per((x) => x.inputTokens)}/${per((x) => x.outputTokens)} | ${miss.replace(/\|/g, "/").replace(/\n/g, " ")} |`,
    );
  }
  if (!paid)
    lines.push(
      "",
      "Level 2 (setups) not run: no AI credit yet (AI_PAID_GATEWAY and AI_SETUP_MODEL are empty).",
    );
  lines.push(
    "",
    "Not counted: search embeddings (bge-base, a few neurons per request on the free allowance); everything else is.",
  );
  return lines.join("\n");
}
