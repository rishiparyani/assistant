import { describe, expect, it } from "vitest";
import {
  FormulaError,
  evalFormula,
  formulaFields,
  formulaUsesToday,
  formulaValues,
  inferType,
  parseFormula,
  type FormulaType,
  type FormulaValue,
} from "./formula.ts";

const vals: Record<string, FormulaValue> = {
  Fee: { t: "money", v: 5_000_000 },
  Paid: { t: "money", v: 2_000_000 },
  Count: { t: "num", v: 4 },
  Date: { t: "date", v: Date.UTC(2026, 11, 12) },
  Name: { t: "text", v: "Test Wedding" },
  Done: { t: "bool", v: true },
  Empty: null,
};
const NOW = Date.UTC(2026, 9, 15, 10); // 15 Oct 2026, 15:30 in India
const run = (f: string) => evalFormula(parseFormula(f), (n) => vals[n] ?? null, { now: NOW });
const types: Record<string, FormulaType> = {
  Fee: "money",
  Paid: "money",
  Count: "num",
  Date: "date",
  Name: "text",
  Done: "bool",
  Empty: "num",
};
const typeOf = (f: string) =>
  inferType(parseFormula(f), (n) => {
    const t = types[n];
    if (!t) throw new FormulaError(`No field ${n}`);
    return t;
  });

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

  it("compares, decides and combines", () => {
    expect(run("{Paid} >= {Fee}")).toEqual({ t: "bool", v: false });
    expect(run('if({Paid} >= {Fee}, "Paid", "Due")')).toEqual({ t: "text", v: "Due" });
    expect(run('if({Paid} < {Fee} and {Count} > 3, "Chase", "Fine")')).toEqual({ t: "text", v: "Chase" });
    expect(run("not {Done} or {Count} = 4")).toEqual({ t: "bool", v: true });
    expect(run('{Name} = "test wedding"')).toEqual({ t: "bool", v: true });
    expect(run("{Count} <> 4")).toEqual({ t: "bool", v: false });
    expect(run("{Count} != 4")).toEqual({ t: "bool", v: false });
    expect(run("{Fee} > 40000")).toEqual({ t: "bool", v: true });
    expect(run("and({Done}, {Count} = 4)")).toEqual({ t: "bool", v: true });
    expect(run("{Empty} = {Empty}")).toEqual({ t: "bool", v: true });
    expect(run("{Empty} > 1")).toEqual({ t: "bool", v: false });
    expect(run("blank({Empty})")).toEqual({ t: "bool", v: true });
    expect(run("ifblank({Empty}, 9)")).toEqual({ t: "num", v: 9 });
  });

  it("has number, text and date functions", () => {
    expect(run("round({Fee} / 3)")).toEqual({ t: "money", v: 1_666_700 });
    expect(run("round({Count} / 3, 2)")).toEqual({ t: "num", v: 1.33 });
    expect(run("floor({Count} / 3)")).toEqual({ t: "num", v: 1 });
    expect(run("abs(0 - {Count})")).toEqual({ t: "num", v: 4 });
    expect(run("min({Fee}, {Paid})")).toEqual({ t: "money", v: 2_000_000 });
    expect(run("max({Count}, 10, {Empty})")).toEqual({ t: "num", v: 10 });
    expect(run("sum({Fee}, {Paid})")).toEqual({ t: "money", v: 7_000_000 });
    expect(run("avg({Count}, 6)")).toEqual({ t: "num", v: 5 });
    expect(run("len({Name})")).toEqual({ t: "num", v: 12 });
    expect(run("upper({Name})")).toEqual({ t: "text", v: "TEST WEDDING" });
    expect(run('join({Name}, " · ", text({Fee}))')).toEqual({ t: "text", v: "Test Wedding · ₹50,000" });
    expect(run('contains({Name}, "wed")')).toEqual({ t: "bool", v: true });
    expect(run("today()")).toEqual({ t: "date", v: Date.UTC(2026, 9, 15) });
    expect(run("{Date} - today()")).toEqual({ t: "num", v: 58 });
    expect(run("year({Date}) * 100 + month({Date})")).toEqual({ t: "num", v: 202612 });
    expect(run("weekday({Date})")).toEqual({ t: "num", v: 6 }); // a Saturday
    expect(run("date(2026, 1, 31) + 1")).toEqual({ t: "date", v: Date.UTC(2026, 1, 1) });
    expect(formulaUsesToday(parseFormula("{Date} - today()"))).toBe(true);
    expect(formulaUsesToday(parseFormula("{Date} - 1"))).toBe(false);
  });

  it("refuses what isn't a formula", () => {
    for (const bad of ["{Fee", "1 +", "(1", "alert(1)", "{Fee} ^ 2", '"open', "if({Done}, 1)", "Fee + 1"])
      expect(() => parseFormula(bad)).toThrow(FormulaError);
    expect(() => run("{Fee} * {Paid}")).toThrow(FormulaError);
    expect(() => run("{Date} + {Date}")).toThrow(FormulaError);
    expect(() => run("{Name} + 1")).toThrow(FormulaError);
  });

  it("knows a formula's type before any value exists", () => {
    expect(typeOf("{Fee} - {Paid}")).toBe("money");
    expect(typeOf("{Date} + 7")).toBe("date");
    expect(typeOf("{Date} - today()")).toBe("num");
    expect(typeOf('if({Paid} >= {Fee}, "Paid", "Due")')).toBe("text");
    expect(typeOf("{Paid} >= {Fee}")).toBe("bool");
    expect(typeOf('join({Name}, "!")')).toBe("text");
    expect(typeOf("round({Fee} / 3)")).toBe("money");
    for (const bad of [
      'if({Paid} >= {Fee}, "Paid", 0)',
      "if({Fee}, 1, 2)",
      "{Name} + 1",
      "{Fee} = {Name}",
      "{Fee} and {Done}",
      "len({Fee})",
      "month({Count})",
      "{Nope} + 1",
    ])
      expect(() => typeOf(bad)).toThrow(FormulaError);
  });

  it("works out every formula field from stored values, formulas of formulas and through a link", () => {
    const fields = [
      { id: "f1", name: "Fee", type: "money", aliases: ["Price"], options: {} },
      { id: "f2", name: "Half", type: "money", options: { formula: "{Price} / 2" } },
      { id: "f3", name: "Later", type: "date", options: { formula: "{Day} + 7" } },
      { id: "f4", name: "Day", type: "date", options: {} },
      { id: "f5", name: "Quarter", type: "money", options: { formula: "{Half} / 2" } },
      { id: "f6", name: "Status", type: "text", options: { formula: 'if({Fee} > 1000, "Big", "Small")' } },
      { id: "f7", name: "Client", type: "link", options: { target: "c2" } },
      { id: "f8", name: "Rate", type: "number", options: { formula: "{Client.Rate} * 2" } },
      { id: "f9", name: "Loop A", type: "number", options: { formula: "{Loop B} + 1" } },
      { id: "f10", name: "Loop B", type: "number", options: { formula: "{Loop A} + 1" } },
      { id: "f11", name: "Big", type: "boolean", options: { formula: "{Fee} > 1000" } },
    ];
    const linked = () => ({
      fields: [{ id: "x1", name: "Rate", type: "number", options: {} }],
      values: { x1: 21 },
    });
    expect(formulaValues(fields, { f1: 500000, f4: "2026-12-12" }, { linked })).toEqual({
      f2: 250000,
      f3: "2026-12-19",
      f5: 125000,
      f6: "Big",
      f8: 42,
      f9: null,
      f10: null,
      f11: true,
    });
    // Without a linked lookup (the device, offline), a formula through a link keeps what was stored.
    expect(formulaValues(fields, { f1: 500000, f8: 42 })).toMatchObject({ f8: 42, f6: "Big" });
    expect(formulaValues(fields, {})).toEqual({
      f2: null,
      f3: null,
      f5: null,
      f6: "Small",
      f8: null,
      f9: null,
      f10: null,
      f11: false,
    });
  });
});
