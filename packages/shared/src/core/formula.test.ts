import { describe, expect, it } from "vitest";
import { FormulaError, evalFormula, formulaFields, parseFormula, type FormulaValue } from "./formula.ts";

const vals: Record<string, FormulaValue> = {
  Fee: { t: "money", v: 5_000_000 },
  Paid: { t: "money", v: 2_000_000 },
  Count: { t: "num", v: 4 },
  Date: { t: "date", v: Date.UTC(2026, 11, 12) },
  Empty: null,
};
const run = (f: string) => evalFormula(parseFormula(f), (n) => vals[n] ?? null);

describe("formulas", () => {
  it("does money, numbers and dates", () => {
    expect(run("{Fee} - {Paid}")).toEqual({ t: "money", v: 3_000_000 });
    expect(run("{Fee} / {Count}")).toEqual({ t: "money", v: 1_250_000 });
    expect(run("({Count} + 1) * 2")).toEqual({ t: "num", v: 10 });
    expect(run("{Date} + 7")).toEqual({ t: "date", v: Date.UTC(2026, 11, 19) });
    expect(run("{Fee} + 500")).toEqual({ t: "money", v: 5_050_000 });
    expect(run("{Empty} + 1")).toBeNull();
    expect(formulaFields(parseFormula("{Fee} - {Paid} * 2"))).toEqual(["Fee", "Paid"]);
  });
  it("refuses what isn't a formula", () => {
    for (const bad of ["{Fee", "1 +", "(1", "alert(1)", "{Fee} ^ 2"])
      expect(() => parseFormula(bad)).toThrow(FormulaError);
    expect(() => run("{Fee} * {Paid}")).toThrow(FormulaError);
    expect(() => run("{Date} + {Date}")).toThrow(FormulaError);
  });
});
