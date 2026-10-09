import { describe, expect, it } from "vitest";
import { ValueError, displayValue, nameKey, normalizeValue, periodRange, type FieldView } from "./spaces.ts";

const f = (type: FieldView["type"], options: FieldView["options"] = {}) => ({ name: "F", type, options });

describe("normalizeValue", () => {
  it("stores each type in its one form", () => {
    expect(normalizeValue(f("text"), "  Hello ")).toBe("Hello");
    expect(normalizeValue(f("number"), "1,200.5")).toBe(1200.5);
    expect(normalizeValue(f("money"), "₹1,200")).toBe(120000);
    expect(normalizeValue(f("money"), 450)).toBe(45000);
    expect(normalizeValue(f("date"), "2026-12-12")).toBe("2026-12-12");
    expect(normalizeValue(f("datetime"), "2026-12-12T19:00")).toBe("2026-12-12T13:30:00.000Z");
    expect(normalizeValue(f("boolean"), "yes")).toBe(true);
    expect(normalizeValue(f("choice", { choices: ["Food", "Travel"] }), "food")).toBe("Food");
    expect(normalizeValue(f("multi_choice", { choices: ["A", "B"] }), ["b", "A", "a"])).toEqual(["B", "A"]);
    expect(normalizeValue(f("person"), "Test Rahul")).toEqual({ user_id: null, name: "Test Rahul" });
  });

  it("clears on null or empty, and refuses bad values with the field's name", () => {
    expect(normalizeValue(f("text"), "")).toBeNull();
    expect(normalizeValue(f("money"), null)).toBeNull();
    expect(() => normalizeValue(f("number"), "abc")).toThrow(ValueError);
    expect(() => normalizeValue(f("date"), "2026-02-30")).toThrow(/F: expected a date/);
    expect(() => normalizeValue(f("choice", { choices: ["Food"] }), "Fuel")).toThrow(
      /isn't a choice \(choices: Food\)/,
    );
    expect(() => normalizeValue(f("text"), "x".repeat(501))).toThrow(/at most 500/);
  });

  it("reads back for people", () => {
    expect(displayValue("money", 45000)).toBe("₹450");
    expect(displayValue("boolean", false)).toBe("No");
    expect(displayValue("person", { user_id: null, name: "Test Rahul" })).toBe("Test Rahul");
    expect(nameKey("  Plus   Ones ")).toBe("plus ones");
  });
});

describe("periodRange", () => {
  // Wed 14 Oct 2026, 23:00 IST (17:30 UTC).
  const now = Date.parse("2026-10-14T17:30:00Z");

  it("uses India days and Monday weeks", () => {
    expect(periodRange("today", now)).toMatchObject({
      fromDate: "2026-10-14",
      toDate: "2026-10-15",
      from: "2026-10-13T18:30:00.000Z",
      to: "2026-10-14T18:30:00.000Z",
    });
    expect(periodRange("this_week", now)).toMatchObject({ fromDate: "2026-10-12", toDate: "2026-10-19" });
    expect(periodRange("last_month", now)).toMatchObject({ fromDate: "2026-09-01", toDate: "2026-10-01" });
  });

  it("splits past and future at now for date-times", () => {
    expect(periodRange("future", now)).toMatchObject({
      fromDate: "2026-10-14",
      toDate: null,
      from: "2026-10-14T17:30:00.000Z",
    });
    expect(periodRange("past", now)).toMatchObject({ fromDate: null, to: "2026-10-14T17:30:00.000Z" });
  });
});
