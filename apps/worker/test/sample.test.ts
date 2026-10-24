// Made-up values for a practice run read like real ones, not "Sample visitor".
import { describe, expect, it } from "vitest";
import { sampleText } from "../src/core/spaces/sample.ts";

describe("sample values", () => {
  it("fits the field's name", () => {
    expect(sampleText("Visitor")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(sampleText("Resident name")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(sampleText("Flat")).toBe("B-204");
    expect(sampleText("Purpose")).toBe("Delivery");
    expect(sampleText("Phone")).toBe("98765 43210");
    expect(sampleText("Vehicle number")).toBe("MH 12 AB 1234");
  });
  it("never says Sample, and gives a sentence to long text", () => {
    for (const n of ["Title", "Complaint", "Thing", "Description"])
      expect(sampleText(n)).not.toMatch(/sample/i);
    expect(sampleText("Notes", true)).toMatch(/\.$/);
    expect(sampleText("Anything", true)).toMatch(/\.$/);
  });
  it("is the same every time for one field", () => {
    expect(sampleText("Visitor")).toBe(sampleText("Visitor"));
  });
});
