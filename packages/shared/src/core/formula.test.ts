import { describe, expect, it } from "vitest";
import {
  FormulaError,
  evalFormula,
  formulaFields,
  formulaValues,
  parseFormula,
  type FormulaValue,
} from "./formula.ts";

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

  it("works out every formula field from stored values", () => {
    const fields = [
      { id: "f1", name: "Fee", type: "money", aliases: ["Price"], options: {} },
      { id: "f2", name: "Half", type: "money", options: { formula: "{Price} / 2" } },
      { id: "f3", name: "Later", type: "date", options: { formula: "{Day} + 7" } },
      { id: "f4", name: "Day", type: "date", options: {} },
    ];
    expect(formulaValues(fields, { f1: 5000, f4: "2026-12-12" })).toEqual({ f2: 2500, f3: "2026-12-19" });
    expect(formulaValues(fields, {})).toEqual({ f2: null, f3: null });
  });
});
