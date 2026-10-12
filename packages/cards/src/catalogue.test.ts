import { describe as group, expect, it } from "vitest";
import { ARRANGEMENT_INFO, catalogueText, describe } from "./catalogue.ts";
import { ARRANGEMENTS } from "./spec.ts";

group("the catalogue", () => {
  it("has a line for every arrangement the assistant may pick, none for app-only or undrawn ones", () => {
    const text = catalogueText();
    for (const a of ARRANGEMENTS) {
      expect(ARRANGEMENT_INFO[a]).toBeDefined();
      expect(text.includes(`- ${a} (`)).toBe(!ARRANGEMENT_INFO[a].appOnly && !ARRANGEMENT_INFO[a].later);
    }
    expect(text).toContain("- list-ticks (s/m/l): a list with a tick box on each row");
  });

  it("stays short enough to send with every setup request", () => {
    // About 4 characters a token: well under 600 tokens.
    expect(catalogueText().length).toBeLessThan(2400);
  });

  it("describes one arrangement in full", () => {
    expect(describe("countdown")).toContain("Sizes: xs, s, bar, m");
    expect(describe("countdown")).toContain("Source: date_field.");
  });
});
