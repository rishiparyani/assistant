import { afterEach, describe, expect, it, vi } from "vitest";
import { isUlid, ulid, ulidTime } from "./ids.ts";

describe("ulid", () => {
  it("makes valid, unique ULIDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isUlid(id)).toBe(true);
  });

  it("encodes the time so IDs sort by creation time", () => {
    const t = Date.UTC(2026, 8, 26, 12, 0, 0);
    expect(ulidTime(ulid(t))).toBe(t);
    expect(ulid(t) < ulid(t + 1)).toBe(true);
  });

  // The phone's JavaScript engine has no `crypto` global (the Expenses list crash, 2026-10-15).
  it("works without a crypto global", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = new Set(Array.from({ length: 200 }, () => ulid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isUlid(id)).toBe(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects bad input", () => {
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false); // time overflow
    expect(() => ulid(-1)).toThrow();
  });
});
