// The offline rule (AGENTS.md, docs/design/offline.md) as a check, so a new screen can't
// quietly skip it:
// 1. Every write the web app sends either goes through the outbox (a module's change helper,
//    e.g. the record changes in spaces-api.ts) or is marked `online-only: <reason>` in the comment above it (on the
//    property/function, or on the object it belongs to).
// 2. Module code never calls fetch() itself (writes would bypass the outbox and the key); core
//    marks each direct fetch() online-only too (only `request()` itself is exempt).
// 3. Every change kind sent through the outbox is shown on screen by an applier.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
// The outbox itself (it sends the queued changes).
const TRANSPORT = new Set(["core/outbox.svelte.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|svelte)$/.test(name) ? [p] : [];
  });
}
const sources = files(SRC).map((p) => ({
  path: relative(SRC, p),
  lines: readFileSync(p, "utf8").split("\n"),
}));

const WRITE = /request<[^>]*>\(\s*"(POST|PATCH|PUT|DELETE)"|request<[^>]*>\(\s*$/;
const PROPERTY = /^ {2}(\w+):/;
const DECLARATION = /^(export )?(async )?(function|const|let) /;
const FUNCTION = /^\s*(export )?(async )?function /;

/** The comment lines directly above line `i`. */
function commentAbove(lines: string[], i: number): string {
  const out: string[] = [];
  for (let j = i - 1; j >= 0 && /^\s*(\/\/|\/\*\*|\*)/.test(lines[j]!); j--) out.push(lines[j]!);
  return out.join("\n");
}

/**
 * Where line `i` belongs: the line itself, its object property (if any), the functions around
 * it (also inside a Svelte <script>) and its top-level declaration.
 */
function owners(lines: string[], i: number): number[] {
  const found: number[] = [i];
  let property = false;
  for (let j = i; j >= 0; j--) {
    const line = lines[j]!;
    if (!property && PROPERTY.test(line)) {
      property = true;
      found.push(j);
    }
    if (FUNCTION.test(line)) found.push(j);
    if (DECLARATION.test(line) || /^<script/.test(line)) return [...found, j];
  }
  return found;
}
const marked = (lines: string[], i: number) =>
  owners(lines, i).some((o) => /online-only:/i.test(commentAbove(lines, o)));

function writeCalls() {
  const calls: { where: string; marked: boolean }[] = [];
  for (const { path, lines } of sources) {
    if (TRANSPORT.has(path)) continue;
    lines.forEach((line, i) => {
      const m = WRITE.exec(line);
      if (!m) return;
      // A call split over lines: the method is on the next line.
      if (!m[1] && !/^\s*"(POST|PATCH|PUT|DELETE)"/.test(lines[i + 1] ?? "")) return;
      calls.push({ where: `${path}:${i + 1}`, marked: marked(lines, i) });
    });
  }
  return calls;
}

describe("offline rule", () => {
  it("finds the web app's writes (the check itself works)", () => {
    expect(writeCalls().length).toBeGreaterThan(20);
  });

  it("marks every write that doesn't go through the outbox as online-only, with a reason", () => {
    const unmarked = writeCalls()
      .filter((c) => !c.marked)
      .map((c) => c.where);
    expect(unmarked, "Send it through the outbox or add `// online-only: <reason>` above it").toEqual([]);
  });

  it("never calls fetch() from module code", () => {
    const direct = sources
      .filter((s) => s.path.startsWith("modules/"))
      .flatMap((s) => s.lines.flatMap((l, i) => (/\bfetch\(/.test(l) ? [`${s.path}:${i + 1}`] : [])));
    expect(direct).toEqual([]);
  });

  it("marks every direct fetch() in core as online-only (except request() itself)", () => {
    const unmarked = sources
      .filter((s) => s.path.startsWith("core/") && !TRANSPORT.has(s.path))
      .flatMap(({ path, lines }) =>
        lines.flatMap((l, i) => {
          if (!/\bfetch\(/.test(l)) return [];
          const top = owners(lines, i).at(-1)!;
          if (path === "core/api.ts" && /function request</.test(lines[top]!)) return [];
          return marked(lines, i) ? [] : [`${path}:${i + 1}`];
        }),
      );
    expect(unmarked, "Use request(), or add `// online-only: <reason>` above it").toEqual([]);
  });

  it("shows every change sent through the outbox on screen", () => {
    const all = sources.map((s) => s.lines.join("\n")).join("\n");
    const sent = [...all.matchAll(/kind:\s*"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]!);
    const shown = new Set([...all.matchAll(/applyWith\(\s*"([^"]+)"/g)].map((m) => m[1]!));
    expect(sent.length).toBeGreaterThan(2);
    const missing = sent.filter((k) => !shown.has(k));
    expect(missing, "Add an applier with applyWith()").toEqual([]);
  });
});
