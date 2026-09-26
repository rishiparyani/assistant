import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, PageInput } from "./pagination.ts";

describe("cursors", () => {
  it("round-trip sort keys, including non-ASCII", () => {
    const keys = ["Śruti's Café", "01JUNKJUNKJUNKJUNKJUNKJUNK", 5, null];
    const c = encodeCursor(keys);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(keys);
  });

  it("returns null for garbage", () => {
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(encodeCursor([]).slice(0, 1))).toBeNull();
  });

  it("parses limits from query strings", () => {
    expect(PageInput.parse({ limit: "10" })).toEqual({ limit: 10 });
    expect(PageInput.parse({})).toEqual({ limit: 50 });
    expect(PageInput.safeParse({ limit: "1000" }).success).toBe(false);
  });
});
