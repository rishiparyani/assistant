import { describe, expect, it } from "vitest";
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

  it("rejects bad input", () => {
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false); // time overflow
    expect(() => ulid(-1)).toThrow();
  });
});
