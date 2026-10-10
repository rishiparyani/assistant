// Formulas (universal.md §2 "Formula"; chat-first step 6): a small, safe language for
// calculated fields, e.g. "{Fee} - {Paid}", "{Amount} * 2", "{Date} + 7". Fields go in
// braces; numbers, + - * / and brackets are all there is. No code, no calls, bounded size.

export type FormulaNode =
  | { k: "num"; v: number }
  | { k: "field"; name: string }
  | { k: "op"; op: "+" | "-" | "*" | "/"; a: FormulaNode; b: FormulaNode }
  | { k: "neg"; a: FormulaNode };

export class FormulaError extends Error {}

const MAX_LENGTH = 300;
const MAX_NODES = 60;

/** Parses a formula; throws FormulaError with a plain message when it isn't one. */
export function parseFormula(text: string): FormulaNode {
  if (text.length > MAX_LENGTH) throw new FormulaError("That formula is too long");
  let i = 0;
  let nodes = 0;
  const node = <T extends FormulaNode>(n: T): T => {
    if (++nodes > MAX_NODES) throw new FormulaError("That formula is too long");
    return n;
  };
  const skip = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const expr = (): FormulaNode => {
    let left = term();
    for (;;) {
      skip();
      const c = text[i];
      if (c !== "+" && c !== "-") return left;
      i++;
      left = node({ k: "op", op: c, a: left, b: term() });
    }
  };
  const term = (): FormulaNode => {
    let left = unary();
    for (;;) {
      skip();
      const c = text[i];
      if (c !== "*" && c !== "/") return left;
      i++;
      left = node({ k: "op", op: c, a: left, b: unary() });
    }
  };
  const unary = (): FormulaNode => {
    skip();
    if (text[i] === "-") {
      i++;
      return node({ k: "neg", a: unary() });
    }
    return atom();
  };
  const atom = (): FormulaNode => {
    skip();
    const c = text[i];
    if (c === "(") {
      i++;
      const inner = expr();
      skip();
      if (text[i] !== ")") throw new FormulaError("A bracket isn't closed");
      i++;
      return inner;
    }
    if (c === "{") {
      const end = text.indexOf("}", i);
      if (end < 0) throw new FormulaError("A { isn't closed; fields go in braces, e.g. {Fee}");
      const name = text.slice(i + 1, end).trim();
      if (!name) throw new FormulaError("Empty {} in the formula");
      i = end + 1;
      return node({ k: "field", name });
    }
    const m = /^\d+(\.\d+)?/.exec(text.slice(i));
    if (m) {
      i += m[0].length;
      return node({ k: "num", v: Number(m[0]) });
    }
    throw new FormulaError(
      c === undefined
        ? "The formula ends too soon"
        : `Didn't expect "${c}" there; use {Field}, numbers and + - * /`,
    );
  };
  const tree = expr();
  skip();
  if (i < text.length) throw new FormulaError(`Didn't expect "${text[i]}" there`);
  return tree;
}

/** Field names a formula uses. */
export function formulaFields(n: FormulaNode): string[] {
  if (n.k === "field") return [n.name];
  if (n.k === "op") return [...formulaFields(n.a), ...formulaFields(n.b)];
  if (n.k === "neg") return formulaFields(n.a);
  return [];
}

/** What a value is while calculating: a plain number, money in paise, or a day (ms at UTC midnight). */
export type FormulaValue = { t: "num" | "money" | "date"; v: number } | null;

const DAY = 86_400_000;

/**
 * Calculates a formula from field values (already typed). Money stays in paise; a date plus
 * a number moves it by days; two dates subtract to a number of days. Empty in, empty out.
 */
export function evalFormula(n: FormulaNode, get: (name: string) => FormulaValue): FormulaValue {
  if (n.k === "num") return { t: "num", v: n.v };
  if (n.k === "field") return get(n.name);
  if (n.k === "neg") {
    const a = evalFormula(n.a, get);
    if (!a) return null;
    if (a.t === "date") throw new FormulaError("A date can't be negative");
    return { t: a.t, v: -a.v };
  }
  const a = evalFormula(n.a, get);
  const b = evalFormula(n.b, get);
  if (!a || !b) return null;
  const bad = () => {
    throw new FormulaError(
      `Can't ${n.op === "+" ? "add" : n.op === "-" ? "subtract" : n.op === "*" ? "multiply" : "divide"} ${a.t === "num" ? "a number" : a.t} and ${b.t === "num" ? "a number" : b.t}`,
    );
  };
  switch (n.op) {
    case "+":
    case "-": {
      const sign = n.op === "+" ? 1 : -1;
      if (a.t === b.t && a.t !== "date") return { t: a.t, v: a.v + sign * b.v };
      if (a.t === "date" && b.t === "num") return { t: "date", v: a.v + sign * Math.round(b.v) * DAY };
      if (n.op === "+" && a.t === "num" && b.t === "date")
        return { t: "date", v: b.v + Math.round(a.v) * DAY };
      if (n.op === "-" && a.t === "date" && b.t === "date")
        return { t: "num", v: Math.round((a.v - b.v) / DAY) };
      // A plain number with money counts as rupees.
      if (a.t === "money" && b.t === "num") return { t: "money", v: a.v + sign * Math.round(b.v * 100) };
      if (a.t === "num" && b.t === "money") return { t: "money", v: Math.round(a.v * 100) + sign * b.v };
      return bad();
    }
    case "*":
      if (a.t === "num" && b.t === "num") return { t: "num", v: a.v * b.v };
      if (a.t === "money" && b.t === "num") return { t: "money", v: Math.round(a.v * b.v) };
      if (a.t === "num" && b.t === "money") return { t: "money", v: Math.round(a.v * b.v) };
      return bad();
    case "/":
      if (b.v === 0) return null;
      if (a.t === "num" && b.t === "num") return { t: "num", v: a.v / b.v };
      if (a.t === "money" && b.t === "num") return { t: "money", v: Math.round(a.v / b.v) };
      if (a.t === "money" && b.t === "money") return { t: "num", v: a.v / b.v };
      return bad();
  }
}

type FormulaField = {
  id: string;
  name: string;
  type: string;
  aliases?: string[];
  options: { formula?: string | null };
};
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Every formula field's value from a record's stored values (null when it can't be worked
 * out), the same on the server and in the app's offline overlay. Fields are found by name or
 * alias; formulas don't use other formulas, so the order doesn't matter.
 */
export function formulaValues(
  fields: FormulaField[],
  values: Record<string, unknown>,
): Record<string, number | string | null> {
  const asValue = (f: FormulaField): FormulaValue => {
    const v = values[f.id];
    if (v === null || v === undefined) return null;
    if (f.type === "number" && typeof v === "number") return { t: "num", v };
    if (f.type === "money" && typeof v === "number") return { t: "money", v };
    if ((f.type === "date" || f.type === "datetime") && typeof v === "string") {
      const ms = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
      return Number.isNaN(ms) ? null : { t: "date", v: ms };
    }
    return null;
  };
  const find = (name: string) =>
    fields.find((x) => key(x.name) === key(name)) ??
    fields.find((x) => (x.aliases ?? []).some((a) => key(a) === key(name)));
  const out: Record<string, number | string | null> = {};
  for (const f of fields) {
    if (!f.options.formula) continue;
    try {
      const r = evalFormula(parseFormula(f.options.formula), (name) => {
        const g = find(name);
        return g ? asValue(g) : null;
      });
      out[f.id] =
        r === null
          ? null
          : r.t === "date"
            ? new Date(r.v).toISOString().slice(0, 10)
            : r.t === "money"
              ? Math.round(r.v)
              : Math.round(r.v * 1000) / 1000;
    } catch {
      out[f.id] = null;
    }
  }
  return out;
}
