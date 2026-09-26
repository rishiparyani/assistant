import { describe, expect, it } from "vitest";
import { formatINR, money, parseINR } from "./money.ts";

describe("formatINR", () => {
  it.each([
    [0, "₹0"],
    [5, "₹0.05"],
    [50, "₹0.50"],
    [100, "₹1"],
    [99_900, "₹999"],
    [100_000, "₹1,000"],
    [1_000_000, "₹10,000"],
    [1_000_050, "₹10,000.50"],
    [10_000_000, "₹1,00,000"],
    [1_234_567_89, "₹12,34,567.89"],
    [10_000_000_000, "₹10,00,00,000"],
    [-50_000, "-₹500"],
  ])("%i paise → %s", (paise, text) => {
    expect(formatINR(paise)).toBe(text);
  });

  it("rejects non-integers", () => {
    expect(() => formatINR(10.5)).toThrow();
  });
});

describe("parseINR", () => {
  it.each([
    ["10000", 1_000_000],
    ["10,000", 1_000_000],
    ["₹1,00,000", 10_000_000],
    ["₹ 500.5", 50_050],
    ["Rs. 250", 25_000],
    ["INR 99.99", 9_999],
    ["-500", -50_000],
    ["0.05", 5],
  ])("%s → %i paise", (text, paise) => {
    expect(parseINR(text)).toBe(paise);
  });

  it.each(["", "abc", "10.505", "1e5", "10..5", "₹"])("rejects %j", (text) => {
    expect(() => parseINR(text)).toThrow();
  });

  it("round-trips", () => {
    for (const p of [0, 5, 1_000_050, 10_000_000, -2_500]) expect(parseINR(formatINR(p))).toBe(p);
  });
});

describe("money", () => {
  it("returns the API shape", () => {
    expect(money(1_000_000)).toEqual({ amount_paise: 1_000_000, amount_display: "₹10,000" });
  });
});
