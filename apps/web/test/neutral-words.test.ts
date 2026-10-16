// The app is for anything, not for bands or gigs (the owner, again on 2026-10-16: "I've told
// you repeatedly that this is not a gig specific app or a band specific app"). This check reads
// the words people see in the phone app and the in-app assistant's instructions, and fails on
// music words in them. Comments are skipped; examples belong to everyday life (a home, a trip,
// a bill). The old gig and music modules have their own screens and are not scanned.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const SCANNED = [
  "apps/mobile/app",
  "apps/mobile/src",
  "apps/worker/src/core/assistant/service.ts",
  // The cards' drawing and their sample gallery (Help → card gallery).
  "packages/cards/src",
];
const MUSIC = /\b(band|bands|bandmates?|gigs?|venues?|rehearsals?|setlists?|guitar|soundcheck|musicians?)\b/i;

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => {
    const p = join(path, name);
    if (statSync(p).isDirectory()) return files(p);
    // Tests are never shown to anyone.
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** The text a line shows people: its string literals and JSX text, never its comments. */
function shownText(line: string): string[] {
  const code = line.replace(/\/\/.*$/, "");
  if (/^\s*(\*|\/\*)/.test(code)) return [];
  const literals = [...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "");
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!);
  const bare = /^\s+[A-Z][^=;(){}<>]*[.?!:]?\s*$/.test(code) ? [code] : [];
  return [...literals, ...jsx, ...bare];
}

describe("the words people see are for anything", () => {
  it("say nothing about bands or gigs", () => {
    const found: string[] = [];
    for (const file of SCANNED.flatMap((p) => files(join(ROOT, p)))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const text of shownText(line)) {
            // The app's name, and the sentences the scripted test model answers to, are fine.
            const plain = text.replace(/gigspree/gi, "");
            if (/^Test[: ]/.test(plain)) continue;
            if (MUSIC.test(plain)) found.push(`${relative(ROOT, file)}:${i + 1}: ${text.trim()}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});
