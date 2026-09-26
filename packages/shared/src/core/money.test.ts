import { describe, expect, it } from "vitest";
import { formatINR, money, parseINR, paymentStatus, splitEqual, splitPercent } from "./money.ts";

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

describe("paymentStatus", () => {
  it.each([
    [5_000_000, 0, "unpaid"],
    [5_000_000, 1, "partial"],
    [5_000_000, 2_500_000, "partial"],
    [5_000_000, 5_000_000, "paid"],
    [5_000_000, 5_000_100, "overpaid"],
    [0, 0, "paid"],
    [0, 100, "overpaid"],
    // After a full reversal the net received is 0 again.
    [5_000_000, 5_000_000 - 5_000_000, "unpaid"],
  ] as const)("fee %i, received %i → %s", (due, paid, status) => {
    expect(paymentStatus(due, paid)).toBe(status);
  });
});

describe("splitEqual", () => {
  it.each([
    [1_000_000, 4, [250_000, 250_000, 250_000, 250_000]],
    [1_000_000, 3, [333_334, 333_333, 333_333]],
    [100, 3, [34, 33, 33]],
    [0, 2, [0, 0]],
    [7, 1, [7]],
  ])("%i into %i → %j", (total, n, shares) => {
    expect(splitEqual(total, n)).toEqual(shares);
    expect(splitEqual(total, n).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("rejects bad input", () => {
    expect(() => splitEqual(100, 0)).toThrow();
    expect(() => splitEqual(-100, 2)).toThrow();
  });
});

describe("splitPercent", () => {
  it.each([
    [1_000_000, [50, 25, 25], [500_000, 250_000, 250_000]],
    [1_000_000, [33.33, 33.33, 33.34], [333_300, 333_300, 333_400]],
    [100, [33.3333, 33.3333, 33.3334], [34, 33, 33]],
    [1_000_000, [40, 40], [400_000, 400_000]], // 80%: the rest stays unallocated
  ])("%i by %j → %j", (total, percents, shares) => {
    expect(splitPercent(total, percents)).toEqual(shares);
  });

  it("rejects more than 100% or negatives", () => {
    expect(() => splitPercent(100, [60, 50])).toThrow(/110%/);
    expect(() => splitPercent(100, [-1])).toThrow();
  });
});
