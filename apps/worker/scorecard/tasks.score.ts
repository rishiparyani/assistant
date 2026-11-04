// Runs the full tasks (tasks.ts) against the real models: the whole app runs locally on fake
// data, a test person says the request once, then taps Confirm on every card and picks the
// first answer to every question, as a person would, up to the task's limit. Graded by what
// exists at the end and whether it works. Prints what each run cost. Only with suite "tasks".
import { env } from "cloudflare:workers";
import { it } from "vitest";
import type { ChatModelPick, ChatView } from "@assistant/shared";
import type { CallLog } from "../src/core/assistant/budget-object.ts";
import { json, signUp } from "../test/http.ts";
import { api } from "./cases.ts";
import { TASKS, type TaskCase } from "./tasks.ts";

const vars = env as unknown as Record<string, string | undefined>;
const suite = vars.SCORECARD_SUITE?.trim() || "all";
const only = vars.SCORECARD_ONLY?.trim();
const repeat = Math.min(5, Math.max(1, Number(vars.SCORECARD_REPEAT) || 1));
/** The model the person picked ("careful" unless the workflow says). */
const pick = (vars.SCORECARD_PICK?.trim() || "careful") as ChatModelPick;

const budget = () => {
  const ns = (env as unknown as { BUDGET: DurableObjectNamespace }).BUDGET;
  return ns.get(ns.idFromName("budget:global")) as unknown as {
    callsFor(userId: string, since: string): Promise<CallLog[]>;
  };
};

/** What the model did (made-up test data only), printed for every run. */
async function steps(userId: string): Promise<string> {
  const ns = (env as unknown as { CHATS: DurableObjectNamespace }).CHATS;
  const chat = ns.get(ns.idFromName(`chat:${userId}`)) as unknown as {
    context(
      userId: string,
    ): Promise<
      {
        role: string;
        content: string | null;
        tool_calls?: { function: { name: string; arguments: string } }[];
      }[]
    >;
  };
  const cut = (t: string) => (t.length > 300 ? `${t.slice(0, 300)}…` : t);
  return (await chat.context(userId))
    .flatMap((m) =>
      m.tool_calls?.length
        ? m.tool_calls.map((t) => `    → ${t.function.name} ${cut(t.function.arguments)}`)
        : m.role === "tool"
          ? [`    ← ${cut(m.content ?? "")}`]
          : m.role === "user"
            ? [`    [person or app] ${cut(m.content ?? "")}`]
            : m.content
              ? [`    [assistant] ${cut(m.content)}`]
              : [],
    )
    .join("\n");
}

interface Run {
  t: TaskCase;
  ok: boolean;
  problems: string[];
  taps: { confirms: number; answers: number };
  ms: number;
  calls: CallLog[];
}

async function runOnce(t: TaskCase): Promise<Run> {
  const u = await signUp("Test Owner", undefined, { lists: true });
  const since = new Date().toISOString();
  const started = Date.now();
  const taps = { confirms: 0, answers: 0 };
  const send = (text: string) =>
    api(u)("/chat", { body: { text, model: pick } }).then((r) => json<ChatView>(r));
  let problems: string[];
  try {
    let view = await send(t.text);
    for (let n = 0; n < t.maxSteps; n++) {
      // A card waiting for a tap: Confirm it (the oldest first), as a person going along would.
      const card = view.items.find((i) => i.card?.status === "waiting")?.card;
      if (card) {
        view = await json<ChatView>(await api(u)(`/chat/actions/${card.action_id}/confirm`, { body: {} }));
        taps.confirms++;
        continue;
      }
      // A question with answers to tap: the first answer to each.
      const last = view.items.at(-1);
      if (last?.role === "choices" && last.choices) {
        const qs = last.choices.questions ?? [
          { question: last.choices.question, options: last.choices.options },
        ];
        view = await send(qs.map((q) => q.options[0]?.label ?? "Yes").join("\n"));
        taps.answers++;
        continue;
      }
      break;
    }
    problems = await t.check(u);
  } catch (e) {
    problems = [`error: ${e instanceof Error ? e.message : String(e)}`];
  }
  const calls = await budget().callsFor(u.id, since);
  if (!calls.some((c) => c.outcome === "ok" && c.outputTokens > 0)) problems.push("no model answered");
  const failed = calls.filter((c) => c.outcome !== "ok");
  if (failed.length)
    problems.push(`model calls that failed: ${failed.map((c) => `${c.model} ${c.outcome}`).join(", ")}`);
  const ok = problems.length === 0 || problems.every((p) => p.startsWith("model calls that failed"));
  const ms = Date.now() - started;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${t.id} (${(ms / 1000).toFixed(0)} s)${problems.length ? `: ${problems.join("; ")}` : ""}`,
  );
  console.log(await steps(u.id).catch(() => "    (steps not readable)"));
  return { t, ok, problems, taps, ms, calls };
}

it.skipIf(suite !== "tasks")("tasks", { timeout: 120 * 60_000 }, async () => {
  const runs: Run[] = [];
  for (let n = 0; n < repeat; n++)
    for (const t of TASKS.filter((x) => !only || only.split(",").includes(x.id))) runs.push(await runOnce(t));
  console.log("\n=== SCORECARD ===\n" + table(runs) + "\n=== END ===");
});

function table(runs: Run[]): string {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const lines = [
    `Tasks ${new Date().toISOString().slice(0, 10)} · picked: ${pick} · models that answered: ${[...new Set(runs.flatMap((r) => r.calls.map((c) => c.model)))].join(", ") || "none"} · ${repeat} run(s) of each`,
    "",
    "| Task | Run | Works | Confirms | Answers | Model calls (failed) | Tokens in / out (cached %) | Cost | Time | What's wrong |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  runs.forEach((r, i) => {
    const tin = sum(r.calls.map((c) => c.inputTokens));
    const cached = sum(r.calls.map((c) => c.cachedTokens ?? 0));
    lines.push(
      `| ${r.t.id} | ${i + 1} | ${r.ok ? "✅" : "❌"} | ${r.taps.confirms} | ${r.taps.answers} | ` +
        `${r.calls.length} (${r.calls.filter((c) => c.outcome !== "ok").length}) | ` +
        `${tin} / ${sum(r.calls.map((c) => c.outputTokens))} (${tin ? Math.round((100 * cached) / tin) : 0}%) | ` +
        `₹${(sum(r.calls.map((c) => c.costPaise)) / 100).toFixed(2)} | ${(r.ms / 1000).toFixed(0)} s | ` +
        `${r.problems.join("; ").replace(/\|/g, "/").replace(/\n/g, " ")} |`,
    );
  });
  const total = sum(runs.flatMap((r) => r.calls.map((c) => c.costPaise))) / 100;
  lines.push("", `**Total cost of this run: ₹${total.toFixed(2)}** (${runs.length} task run(s)).`);
  return lines.join("\n");
}
