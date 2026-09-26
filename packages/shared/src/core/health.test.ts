import { describe, expect, it } from "vitest";
import { isHealthResponse } from "./health.ts";

describe("isHealthResponse", () => {
  it("accepts a health payload", () => {
    expect(isHealthResponse({ ok: true, environment: "dev", modules: [] })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isHealthResponse(null)).toBe(false);
    expect(isHealthResponse({ ok: false, environment: "dev", modules: [] })).toBe(false);
  });
});
