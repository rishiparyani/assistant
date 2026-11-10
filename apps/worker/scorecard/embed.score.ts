// How close the real embedding model puts things that are and aren't about the same thing, so
// the search's "near in meaning" floor is set from numbers, not a guess (2026-11-10: a search
// for nonsense showed an unrelated chat). Made-up words only. Only with suite "embed".
import { env } from "cloudflare:workers";
import { it } from "vitest";
import { embed } from "../src/core/search/embed.ts";

const vars = env as unknown as Record<string, string | undefined> & { AI: Ai };
const suite = vars.SCORECARD_SUITE?.trim() || "all";

const DOCS = [
  "Electricity bill ₹1,840 due Friday",
  "Call the plumber about the kitchen tap",
  "Visitor at the gate for flat B-204: courier",
  "Rice 5 kg, onions, eggs, milk, curd",
  "Dentist appointment on Tuesday at 5 pm",
  "What's due this week?",
  "Remember the milk is ₹60 a litre",
  "School leave request for Asha, two days",
];
const QUERIES: [string, number | null][] = [
  ["power bill", 0],
  ["bijli ka bill", 0],
  ["leaking tap", 1],
  ["who came to the gate", 2],
  ["groceries to buy", 3],
  ["doctor visit", 4],
  ["milk price", 6],
  ["zzzzqq", null],
  ["asdf", null],
  ["quantum physics lecture", null],
  ["football score", null],
  ["x", null],
];

it.skipIf(suite !== "embed")("embed", { timeout: 5 * 60_000 }, async () => {
  const e = { ai: vars.AI, fake: false };
  const docs = (await embed(e, DOCS))!;
  const qs = (await embed(
    e,
    QUERIES.map(([q]) => q),
  ))!;
  const cos = (a: number[], b: number[]) => {
    let d = 0,
      x = 0,
      y = 0;
    for (let i = 0; i < a.length; i++) {
      d += a[i]! * b[i]!;
      x += a[i]! * a[i]!;
      y += b[i]! * b[i]!;
    }
    return d / (Math.sqrt(x) * Math.sqrt(y));
  };
  const lines = [
    "=== SCORECARD ===",
    "| Query | Right doc | Best wrong doc | All |",
    "| --- | --- | --- | --- |",
  ];
  QUERIES.forEach(([q, want], i) => {
    const s = docs.map((d) => cos(qs[i]!, d));
    const right = want === null ? null : s[want]!;
    const wrong = Math.max(...s.filter((_, k) => k !== want));
    lines.push(
      `| ${q} | ${right === null ? "-" : right.toFixed(2)} | ${wrong.toFixed(2)} | ${s.map((x) => x.toFixed(2)).join(" ")} |`,
    );
  });
  lines.push("=== END ===");
  console.log(lines.join("\n"));
});
