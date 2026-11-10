// The floor for "near in meaning" (measured against the real model, 2026-11-10: unrelated
// things score 0.42 to 0.65, the right one 0.66 to 0.80; the old floor of 0.2 showed everything).
import { describe, expect, it } from "vitest";
import { nearEnough } from "../src/core/search/search-object.ts";

const scored = (...s: number[]) => s.map((score, i) => ({ id: i, score }));

describe("nearEnough", () => {
  it("shows nothing for words that mean nothing (the real model's 0.46 to 0.60)", () => {
    expect(nearEnough(scored(0.53, 0.46, 0.52, 0.54, 0.51, 0.57, 0.6), 768)).toEqual([]);
  });
  it("keeps the right one and drops the unrelated ones around it", () => {
    expect(nearEnough(scored(0.5, 0.77, 0.51, 0.48, 0.55), 768).map((x) => x.id)).toEqual([1]);
    expect(nearEnough(scored(0.79, 0.56, 0.58), 768).map((x) => x.id)).toEqual([0]);
  });
  it("keeps a close second, best first", () => {
    expect(nearEnough(scored(0.63, 0.66, 0.52), 768).map((x) => x.id)).toEqual([1, 0]);
  });
  it("leaves the stand-in used in tests and local dev as it was", () => {
    expect(nearEnough(scored(0.25, 0.1, 0.4), 128).map((x) => x.id)).toEqual([2, 0]);
  });
});
