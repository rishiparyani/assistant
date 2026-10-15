// Formulas (universal.md §2 "Formula"; chat-first step 6; decision 2026-10-15 "Toward Excel"):
// a small, safe language for calculated fields, e.g. "{Fee} - {Paid}", "{Date} + 7",
// "if({Paid} >= {Fee}, "Paid", "Due")", "{Client.Rate} * {Hours}", "today() - {Date}".
// Fields go in braces ({Fee}, or {Link.Field} for a field of the one linked record); numbers,
// "text", true/false, + - * /, comparisons (= <> < <= > >=), and / or / not and a fixed set
// of functions are all there is. No code, no loops, bounded size. The same code runs on the
// server (stored values, worked out in the write) and on the device (the offline overlay).

export type FormulaType = "num" | "money" | "date" | "text" | "bool";

export type FormulaNode =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "field"; name: string }
  | { k: "op"; op: "+" | "-" | "*" | "/"; a: FormulaNode; b: FormulaNode }
  | { k: "neg"; a: FormulaNode }
  | { k: "cmp"; op: "=" | "<>" | "<" | "<=" | ">" | ">="; a: FormulaNode; b: FormulaNode }
  | { k: "and" | "or"; a: FormulaNode; b: FormulaNode }
  | { k: "not"; a: FormulaNode }
  | { k: "call"; fn: FormulaFn; args: FormulaNode[] };

export class FormulaError extends Error {}

const MAX_LENGTH = 500;
const MAX_NODES = 120;
/** Text while calculating is cut here (a chain of joins can't grow without bound). */
const MAX_TEXT = 2_000;
/** A text formula's stored result: a text field's own limit. */
export const MAX_FORMULA_TEXT = 500;

/** The functions, lower-case, with how many arguments each takes ([least, most]). */
export const FORMULA_FNS = {
  if: [3, 3],
  and: [2, 10],
  or: [2, 10],
  not: [1, 1],
  blank: [1, 1],
  ifblank: [2, 2],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
  abs: [1, 1],
  min: [1, 10],
  max: [1, 10],
  sum: [1, 10],
  avg: [1, 10],
  len: [1, 1],
  upper: [1, 1],
  lower: [1, 1],
  trim: [1, 1],
  join: [1, 10],
  text: [1, 1],
  contains: [2, 2],
  today: [0, 0],
  year: [1, 1],
  month: [1, 1],
  day: [1, 1],
  weekday: [1, 1],
  date: [3, 3],
} as const;
export type FormulaFn = keyof typeof FORMULA_FNS;

/** The functions in one line, for the assistant's tool text and the help. */
export const FORMULA_HELP =
  '{Field} or {Link.Field}; numbers, "text", true/false; + - * /; = <> < <= > >=; and, or, not; ' +
  "if(test, then, else), blank(x), ifblank(x, instead), round(x, places), floor, ceil, abs, min, max, " +
  "sum, avg, len, upper, lower, trim, join(a, b, …), text(x), contains(text, part), today(), " +
  "year, month, day, weekday(date), date(y, m, d). A date plus a number is days later; two dates " +
  "subtract to days; money with a plain number counts the number as rupees.";

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
  /** A word at the cursor (letters, digits, _), without moving. */
  const peekWord = (): string => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    return m ? m[0] : "";
  };
  const keyword = (w: string): boolean => {
    skip();
    const got = peekWord();
    if (got.toLowerCase() !== w) return false;
    i += got.length;
    return true;
  };
  const orExpr = (): FormulaNode => {
    let left = andExpr();
    while (keyword("or")) left = node({ k: "or", a: left, b: andExpr() });
    return left;
  };
  const andExpr = (): FormulaNode => {
    let left = notExpr();
    while (keyword("and")) left = node({ k: "and", a: left, b: notExpr() });
    return left;
  };
  const notExpr = (): FormulaNode => {
    if (keyword("not")) return node({ k: "not", a: notExpr() });
    return cmpExpr();
  };
  const cmpExpr = (): FormulaNode => {
    const left = addExpr();
    skip();
    const two = text.slice(i, i + 2);
    const one = text[i];
    const op =
      two === "<>" || two === "<=" || two === ">=" || two === "!="
        ? two
        : one === "=" || one === "<" || one === ">"
          ? one
          : null;
    if (!op) return left;
    i += op.length;
    if (text[i] === "=" && op === "=") i++; // "==" is fine too
    return node({ k: "cmp", op: op === "!=" ? "<>" : op, a: left, b: addExpr() });
  };
  const addExpr = (): FormulaNode => {
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
      const inner = orExpr();
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
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError('A quote isn\'t closed; text goes in quotes, e.g. "Paid"');
      const v = text.slice(i + 1, end);
      i = end + 1;
      return node({ k: "str", v });
    }
    const m = /^\d+(\.\d+)?/.exec(text.slice(i));
    if (m) {
      i += m[0].length;
      return node({ k: "num", v: Number(m[0]) });
    }
    const word = peekWord();
    if (word) {
      const lower = word.toLowerCase();
      if (lower === "true" || lower === "false") {
        i += word.length;
        return node({ k: "bool", v: lower === "true" });
      }
      if (!(lower in FORMULA_FNS))
        throw new FormulaError(
          `No function "${word}"; fields go in braces, e.g. {${word}}. Functions: ${Object.keys(FORMULA_FNS).join(", ")}`,
        );
      i += word.length;
      skip();
      if (text[i] !== "(") throw new FormulaError(`${word} needs brackets, e.g. ${word}(…)`);
      i++;
      const args: FormulaNode[] = [];
      skip();
      if (text[i] === ")") i++;
      else
        for (;;) {
          args.push(orExpr());
          skip();
          if (text[i] === ",") {
            i++;
            continue;
          }
          if (text[i] === ")") {
            i++;
            break;
          }
          throw new FormulaError(`Expected , or ) in ${word}(…)`);
        }
      const fn = lower as FormulaFn;
      const [least, most] = FORMULA_FNS[fn];
      if (args.length < least || args.length > most)
        throw new FormulaError(
          least === most
            ? `${fn} takes ${least} argument${least === 1 ? "" : "s"}`
            : `${fn} takes ${least} to ${most} arguments`,
        );
      return node({ k: "call", fn, args });
    }
    throw new FormulaError(
      c === undefined
        ? "The formula ends too soon"
        : `Didn't expect "${c}" there; use {Field}, numbers, "text" and + - * /`,
    );
  };
  const tree = orExpr();
  skip();
  if (i < text.length) throw new FormulaError(`Didn't expect "${text[i]}" there`);
  return tree;
}

/** Field names a formula uses ("Client.Rate" for a field through a link). */
export function formulaFields(n: FormulaNode): string[] {
  switch (n.k) {
    case "field":
      return [n.name];
    case "op":
    case "cmp":
    case "and":
    case "or":
      return [...formulaFields(n.a), ...formulaFields(n.b)];
    case "neg":
    case "not":
      return formulaFields(n.a);
    case "call":
      return n.args.flatMap(formulaFields);
    default:
      return [];
  }
}

/** Whether a formula changes with the day (today()), so stored values need a daily refresh. */
export function formulaUsesToday(n: FormulaNode): boolean {
  switch (n.k) {
    case "call":
      return n.fn === "today" || n.args.some(formulaUsesToday);
    case "op":
    case "cmp":
    case "and":
    case "or":
      return formulaUsesToday(n.a) || formulaUsesToday(n.b);
    case "neg":
    case "not":
      return formulaUsesToday(n.a);
    default:
      return false;
  }
}

/** What a value is while calculating: a number, money in paise, a day (ms at UTC midnight), text or yes/no. */
export type FormulaValue =
  { t: "num" | "money" | "date"; v: number } | { t: "text"; v: string } | { t: "bool"; v: boolean } | null;

const DAY = 86_400_000;
const IST = 330 * 60_000;
const kindWords: Record<FormulaType, string> = {
  num: "a number",
  money: "money",
  date: "a date",
  text: "text",
  bool: "yes/no",
};
const word = (t: FormulaType) => kindWords[t];

/** The formula type of a field, or null when a formula can't read it directly. */
export function formulaTypeOf(fieldType: string): FormulaType | null {
  switch (fieldType) {
    case "number":
      return "num";
    case "money":
      return "money";
    case "date":
    case "datetime":
      return "date";
    case "text":
    case "long_text":
    case "choice":
    case "multi_choice":
    case "person":
      return "text";
    case "boolean":
      return "bool";
    default:
      return null;
  }
}

/**
 * Works out a formula's type from its parts without any values (so a saved formula is known
 * to fit its field, both sides of an if agree, and nothing adds text to money). `get` gives a
 * field's type, or throws for a field that doesn't exist.
 */
export function inferType(n: FormulaNode, get: (name: string) => FormulaType): FormulaType {
  const same = (xs: FormulaType[], what: string): FormulaType => {
    const first = xs[0]!;
    for (const x of xs)
      if (x !== first) throw new FormulaError(`${what} mixes ${word(first)} and ${word(x)}`);
    return first;
  };
  const numeric = (t: FormulaType, what: string) => {
    if (t !== "num" && t !== "money")
      throw new FormulaError(`${what} needs a number or money, not ${word(t)}`);
    return t;
  };
  switch (n.k) {
    case "num":
      return "num";
    case "str":
      return "text";
    case "bool":
      return "bool";
    case "field":
      return get(n.name);
    case "neg": {
      const a = inferType(n.a, get);
      if (a !== "num" && a !== "money") throw new FormulaError(`Can't make ${word(a)} negative`);
      return a;
    }
    case "op":
      return arithmeticType(n.op, inferType(n.a, get), inferType(n.b, get));
    case "cmp": {
      const a = inferType(n.a, get);
      const b = inferType(n.b, get);
      const ok = a === b || (a === "num" && b === "money") || (a === "money" && b === "num");
      if (!ok) throw new FormulaError(`Can't compare ${word(a)} with ${word(b)}`);
      return "bool";
    }
    case "and":
    case "or": {
      for (const x of [n.a, n.b]) {
        const t = inferType(x, get);
        if (t !== "bool") throw new FormulaError(`${n.k} needs yes/no on both sides, not ${word(t)}`);
      }
      return "bool";
    }
    case "not": {
      const t = inferType(n.a, get);
      if (t !== "bool") throw new FormulaError(`not needs yes/no, not ${word(t)}`);
      return "bool";
    }
    case "call": {
      const ts = n.args.map((a) => inferType(a, get));
      switch (n.fn) {
        case "if":
          if (ts[0] !== "bool") throw new FormulaError(`if's test must be yes/no, not ${word(ts[0]!)}`);
          return same([ts[1]!, ts[2]!], "if's then and else");
        case "and":
        case "or":
          for (const t of ts)
            if (t !== "bool") throw new FormulaError(`${n.fn} needs yes/no arguments, not ${word(t)}`);
          return "bool";
        case "not":
          if (ts[0] !== "bool") throw new FormulaError(`not needs yes/no, not ${word(ts[0]!)}`);
          return "bool";
        case "blank":
          return "bool";
        case "ifblank":
          return same(ts, "ifblank");
        case "round":
          if (ts.length === 2 && ts[1] !== "num") throw new FormulaError("round's places must be a number");
          return numeric(ts[0]!, "round");
        case "floor":
        case "ceil":
        case "abs":
          return numeric(ts[0]!, n.fn);
        case "min":
        case "max": {
          const t = same(ts, n.fn);
          if (t === "text" || t === "bool") throw new FormulaError(`${n.fn} needs numbers, money or dates`);
          return t;
        }
        case "sum":
        case "avg":
          return numeric(same(ts, n.fn), n.fn);
        case "len":
          if (ts[0] !== "text") throw new FormulaError("len needs text");
          return "num";
        case "upper":
        case "lower":
        case "trim":
          if (ts[0] !== "text") throw new FormulaError(`${n.fn} needs text`);
          return "text";
        case "join":
        case "text":
          return "text";
        case "contains":
          if (ts[0] !== "text" || ts[1] !== "text") throw new FormulaError("contains needs text and text");
          return "bool";
        case "today":
          return "date";
        case "year":
        case "month":
        case "day":
        case "weekday":
          if (ts[0] !== "date") throw new FormulaError(`${n.fn} needs a date`);
          return "num";
        case "date":
          for (const t of ts)
            if (t !== "num") throw new FormulaError("date needs three numbers: year, month, day");
          return "date";
      }
    }
  }
}

function arithmeticType(op: "+" | "-" | "*" | "/", a: FormulaType, b: FormulaType): FormulaType {
  const bad = () => {
    throw new FormulaError(
      `Can't ${op === "+" ? "add" : op === "-" ? "subtract" : op === "*" ? "multiply" : "divide"} ${word(a)} and ${word(b)}`,
    );
  };
  switch (op) {
    case "+":
    case "-":
      if (a === b && (a === "num" || a === "money")) return a;
      if (a === "date" && b === "num") return "date";
      if (op === "+" && a === "num" && b === "date") return "date";
      if (op === "-" && a === "date" && b === "date") return "num";
      if ((a === "money" && b === "num") || (a === "num" && b === "money")) return "money";
      return bad();
    case "*":
      if (a === "num" && b === "num") return "num";
      if ((a === "money" && b === "num") || (a === "num" && b === "money")) return "money";
      return bad();
    case "/":
      if (a === "num" && b === "num") return "num";
      if (a === "money" && b === "num") return "money";
      if (a === "money" && b === "money") return "num";
      return bad();
  }
}

/** The day in India that `now` falls on, as UTC midnight (what today() gives). */
export const todayIST = (now: number) => Math.floor((now + IST) / DAY) * DAY;

const cut = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);

/** A value shown as text, as the app shows it (money with ₹, a date as yyyy-mm-dd). */
function asText(v: FormulaValue): string {
  if (!v) return "";
  switch (v.t) {
    case "text":
      return v.v;
    case "bool":
      return v.v ? "Yes" : "No";
    case "date":
      return new Date(v.v).toISOString().slice(0, 10);
    case "money": {
      const rupees = Math.round(v.v) / 100;
      const neg = rupees < 0;
      const [whole, frac] = Math.abs(rupees).toFixed(2).split(".");
      // Indian grouping: 12,34,567.
      const last3 = whole!.slice(-3);
      const rest = whole!.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
      const body = (rest ? `${rest},${last3}` : last3) + (frac === "00" ? "" : `.${frac}`);
      return `${neg ? "-" : ""}₹${body}`;
    }
    case "num":
      return String(Math.round(v.v * 1000) / 1000);
  }
}

/**
 * Calculates a formula from field values (already typed). Money stays in paise; a date plus
 * a number moves it by days; two dates subtract to a number of days. Empty in, empty out for
 * arithmetic; comparisons with an empty value are no (except = empty); and/or take empty as
 * no; functions say what they do with empties.
 */
export function evalFormula(
  n: FormulaNode,
  get: (name: string) => FormulaValue,
  ctx: { now?: number } = {},
): FormulaValue {
  const ev = (x: FormulaNode) => evalFormula(x, get, ctx);
  const truth = (v: FormulaValue): boolean => (v?.t === "bool" ? v.v : false);
  switch (n.k) {
    case "num":
      return { t: "num", v: n.v };
    case "str":
      return { t: "text", v: n.v };
    case "bool":
      return { t: "bool", v: n.v };
    case "field":
      return get(n.name);
    case "neg": {
      const a = ev(n.a);
      if (!a) return null;
      if (a.t !== "num" && a.t !== "money") throw new FormulaError(`Can't make ${word(a.t)} negative`);
      return { t: a.t, v: -a.v };
    }
    case "op":
      return arithmetic(n.op, ev(n.a), ev(n.b));
    case "cmp":
      return { t: "bool", v: compare(n.op, ev(n.a), ev(n.b)) };
    case "and":
      return { t: "bool", v: truth(ev(n.a)) && truth(ev(n.b)) };
    case "or":
      return { t: "bool", v: truth(ev(n.a)) || truth(ev(n.b)) };
    case "not":
      return { t: "bool", v: !truth(ev(n.a)) };
    case "call":
      return call(n.fn, n.args, ev, ctx.now ?? Date.now());
  }
}

function arithmetic(op: "+" | "-" | "*" | "/", a: FormulaValue, b: FormulaValue): FormulaValue {
  if (!a || !b) return null;
  const t = arithmeticType(op, a.t, b.t);
  const av = a.v as number;
  const bv = b.v as number;
  switch (op) {
    case "+":
    case "-": {
      const sign = op === "+" ? 1 : -1;
      if (a.t === "date" && b.t === "num") return { t: "date", v: av + sign * Math.round(bv) * DAY };
      if (a.t === "num" && b.t === "date") return { t: "date", v: bv + Math.round(av) * DAY };
      if (a.t === "date" && b.t === "date") return { t: "num", v: Math.round((av - bv) / DAY) };
      // A plain number with money counts as rupees.
      if (a.t === "money" && b.t === "num") return { t: "money", v: av + sign * Math.round(bv * 100) };
      if (a.t === "num" && b.t === "money") return { t: "money", v: Math.round(av * 100) + sign * bv };
      return { t, v: av + sign * bv } as FormulaValue;
    }
    case "*":
      return { t, v: t === "money" ? Math.round(av * bv) : av * bv } as FormulaValue;
    case "/":
      if (bv === 0) return null;
      if (a.t === "money" && b.t === "num") return { t: "money", v: Math.round(av / bv) };
      return { t: "num", v: av / bv };
  }
}

function compare(op: "=" | "<>" | "<" | "<=" | ">" | ">=", a: FormulaValue, b: FormulaValue): boolean {
  if (!a || !b) {
    if (op === "=") return !a && !b;
    if (op === "<>") return !!a !== !!b;
    return false;
  }
  let x: number | string = a.v as number | string;
  let y: number | string = b.v as number | string;
  if (a.t === "text" && b.t === "text") {
    x = a.v.toLowerCase();
    y = b.v.toLowerCase();
  } else if (a.t === "bool" && b.t === "bool") {
    x = a.v ? 1 : 0;
    y = b.v ? 1 : 0;
  } else if (a.t === "num" && b.t === "money") x = Math.round((a.v as number) * 100);
  else if (a.t === "money" && b.t === "num") y = Math.round((b.v as number) * 100);
  else if (a.t !== b.t) throw new FormulaError(`Can't compare ${word(a.t)} with ${word(b.t)}`);
  switch (op) {
    case "=":
      return x === y;
    case "<>":
      return x !== y;
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
  }
}

function call(
  fn: FormulaFn,
  args: FormulaNode[],
  ev: (n: FormulaNode) => FormulaValue,
  now: number,
): FormulaValue {
  const truth = (v: FormulaValue): boolean => (v?.t === "bool" ? v.v : false);
  const numbers = (vs: FormulaValue[], what: string) => {
    const xs = vs.filter((v): v is NonNullable<FormulaValue> => !!v);
    for (const x of xs)
      if (x.t === "text" || x.t === "bool") throw new FormulaError(`${what} needs numbers, money or dates`);
    return xs as { t: "num" | "money" | "date"; v: number }[];
  };
  switch (fn) {
    case "if":
      return truth(ev(args[0]!)) ? ev(args[1]!) : ev(args[2]!);
    case "and":
      return { t: "bool", v: args.every((a) => truth(ev(a))) };
    case "or":
      return { t: "bool", v: args.some((a) => truth(ev(a))) };
    case "not":
      return { t: "bool", v: !truth(ev(args[0]!)) };
    case "blank": {
      const v = ev(args[0]!);
      return { t: "bool", v: !v || (v.t === "text" && v.v.trim() === "") };
    }
    case "ifblank": {
      const v = ev(args[0]!);
      return !v || (v.t === "text" && v.v.trim() === "") ? ev(args[1]!) : v;
    }
    case "round":
    case "floor":
    case "ceil":
    case "abs": {
      const v = ev(args[0]!);
      if (!v) return null;
      if (v.t !== "num" && v.t !== "money") throw new FormulaError(`${fn} needs a number or money`);
      const places = args[1] ? ev(args[1]) : null;
      const p = places?.t === "num" ? Math.max(0, Math.min(6, Math.round(places.v))) : 0;
      // Money rounds to rupees (paise are the 100ths), plain numbers to the places asked.
      const unit = v.t === "money" ? 100 / 10 ** p : 1 / 10 ** p;
      const x = v.v / unit;
      const r =
        fn === "abs"
          ? Math.abs(v.v)
          : (fn === "round" ? Math.round(x) : fn === "floor" ? Math.floor(x) : Math.ceil(x)) * unit;
      return { t: v.t, v: v.t === "money" ? Math.round(r) : Math.round(r * 1e9) / 1e9 };
    }
    case "min":
    case "max": {
      const xs = numbers(args.map(ev), fn);
      if (!xs.length) return null;
      const t = xs[0]!.t;
      for (const x of xs) if (x.t !== t) throw new FormulaError(`${fn} mixes ${word(t)} and ${word(x.t)}`);
      const v = xs.map((x) => x.v).reduce((a, b) => (fn === "min" ? Math.min(a, b) : Math.max(a, b)));
      return { t, v };
    }
    case "sum":
    case "avg": {
      const xs = numbers(args.map(ev), fn);
      if (!xs.length) return fn === "sum" ? { t: "num", v: 0 } : null;
      const t = xs[0]!.t;
      for (const x of xs) {
        if (x.t === "date") throw new FormulaError(`${fn} needs numbers or money, not dates`);
        if (x.t !== t) throw new FormulaError(`${fn} mixes ${word(t)} and ${word(x.t)}`);
      }
      const total = xs.reduce((a, x) => a + x.v, 0);
      const v = fn === "sum" ? total : total / xs.length;
      return { t, v: t === "money" ? Math.round(v) : v };
    }
    case "len":
      return { t: "num", v: asText(ev(args[0]!)).length };
    case "upper":
      return { t: "text", v: cut(asText(ev(args[0]!)).toUpperCase()) };
    case "lower":
      return { t: "text", v: cut(asText(ev(args[0]!)).toLowerCase()) };
    case "trim":
      return { t: "text", v: cut(asText(ev(args[0]!)).trim()) };
    case "join":
      return { t: "text", v: cut(args.map((a) => asText(ev(a))).join("")) };
    case "text":
      return { t: "text", v: cut(asText(ev(args[0]!))) };
    case "contains": {
      const hay = asText(ev(args[0]!)).toLowerCase();
      const part = asText(ev(args[1]!)).toLowerCase();
      return { t: "bool", v: part !== "" && hay.includes(part) };
    }
    case "today":
      return { t: "date", v: todayIST(now) };
    case "year":
    case "month":
    case "day":
    case "weekday": {
      const v = ev(args[0]!);
      if (!v) return null;
      if (v.t !== "date") throw new FormulaError(`${fn} needs a date`);
      const d = new Date(v.v);
      // weekday: 1 is Monday … 7 is Sunday.
      const n =
        fn === "year"
          ? d.getUTCFullYear()
          : fn === "month"
            ? d.getUTCMonth() + 1
            : fn === "day"
              ? d.getUTCDate()
              : ((d.getUTCDay() + 6) % 7) + 1;
      return { t: "num", v: n };
    }
    case "date": {
      const [y, m, d] = args.map(ev);
      if (!y || !m || !d) return null;
      if (y.t !== "num" || m.t !== "num" || d.t !== "num") throw new FormulaError("date needs three numbers");
      const ms = Date.UTC(Math.round(y.v), Math.round(m.v) - 1, Math.round(d.v));
      return Number.isNaN(ms) ? null : { t: "date", v: ms };
    }
  }
}

export type FormulaField = {
  id: string;
  name: string;
  type: string;
  aliases?: string[];
  options: { formula?: string | null; target?: string | null; many?: boolean };
};
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A stored value as a formula sees it, by its field's type. */
export function formulaValueOf(f: Pick<FormulaField, "type">, v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  switch (f.type) {
    case "number":
      return typeof v === "number" ? { t: "num", v } : null;
    case "money":
      return typeof v === "number" ? { t: "money", v } : null;
    case "date":
    case "datetime": {
      if (typeof v !== "string") return null;
      const ms = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
      return Number.isNaN(ms) ? null : { t: "date", v: ms };
    }
    case "text":
    case "long_text":
    case "choice":
      return typeof v === "string" ? { t: "text", v } : null;
    case "multi_choice":
      return Array.isArray(v) ? { t: "text", v: v.join(", ") } : null;
    case "person":
      return typeof v === "object" && v && "name" in v
        ? { t: "text", v: String((v as { name: unknown }).name) }
        : null;
    case "boolean":
      return { t: "bool", v: !!v };
    default:
      return null;
  }
}

/** A formula's result as it's stored on the record. */
export function storedFormulaValue(r: FormulaValue): number | string | boolean | null {
  if (r === null) return null;
  switch (r.t) {
    case "date":
      return new Date(r.v).toISOString().slice(0, 10);
    case "money":
      return Math.round(r.v);
    case "num":
      return Math.round(r.v * 1000) / 1000;
    case "text":
      return r.v.length > MAX_FORMULA_TEXT ? r.v.slice(0, MAX_FORMULA_TEXT) : r.v;
    case "bool":
      return r.v;
  }
}

/** The one record a link field points at, for {Link.Field}: its fields and stored values. */
export type LinkedRecord = { fields: FormulaField[]; values: Record<string, unknown> };

/** Finds a field by name or alias. */
export function findFormulaField<F extends FormulaField>(fields: F[], name: string): F | undefined {
  return (
    fields.find((x) => key(x.name) === key(name)) ??
    fields.find((x) => (x.aliases ?? []).some((a) => key(a) === key(name)))
  );
}

/**
 * Splits "Client.Rate" into the link field and the field on the linked record, when the
 * name isn't a field of its own. Null when it's a plain field name.
 */
export function splitPath(fields: FormulaField[], name: string): { link: FormulaField; rest: string } | null {
  if (findFormulaField(fields, name)) return null;
  const dot = name.indexOf(".");
  if (dot < 0) return null;
  const link = findFormulaField(fields, name.slice(0, dot));
  return link && link.type === "link" ? { link, rest: name.slice(dot + 1).trim() } : null;
}

/** Whether a formula reads through a link ({Client.Rate}), by the list's fields. */
export function formulaUsesLink(fields: FormulaField[], formula: string): boolean {
  try {
    return formulaFields(parseFormula(formula)).some((name) => !!splitPath(fields, name));
  } catch {
    return false;
  }
}

/**
 * Every formula field's value from a record's stored values (null when it can't be worked
 * out), the same on the server and in the app's offline overlay. Fields are found by name or
 * alias; a formula may use other formulas (worked out first; a loop gives empty) and, with
 * `linked`, a field of the one record a link points at ({Client.Rate}). Without `linked`
 * (the device, offline), a formula that reads through a link keeps its stored value.
 */
export function formulaValues(
  fields: FormulaField[],
  values: Record<string, unknown>,
  opts: { linked?: (link: FormulaField) => LinkedRecord | null; now?: number } = {},
): Record<string, number | string | boolean | null> {
  const done = new Map<string, FormulaValue>();
  const busy = new Set<string>();
  const valueOf = (f: FormulaField): FormulaValue => {
    if (!f.options.formula || f.type === "link") return formulaValueOf(f, values[f.id]);
    if (done.has(f.id)) return done.get(f.id)!;
    if (busy.has(f.id)) return null; // a loop
    if (!opts.linked && formulaUsesLink(fields, f.options.formula)) return formulaValueOf(f, values[f.id]);
    busy.add(f.id);
    let r: FormulaValue;
    try {
      r = evalFormula(parseFormula(f.options.formula), get, { now: opts.now });
    } catch {
      r = null;
    }
    busy.delete(f.id);
    done.set(f.id, r);
    return r;
  };
  const get = (name: string): FormulaValue => {
    const own = findFormulaField(fields, name);
    if (own) return valueOf(own);
    const path = splitPath(fields, name);
    if (!path || !opts.linked) return null;
    const far = opts.linked(path.link);
    if (!far) return null;
    const f = findFormulaField(far.fields, path.rest);
    return f && f.type !== "link" ? formulaValueOf(f, far.values[f.id]) : null;
  };
  const out: Record<string, number | string | boolean | null> = {};
  for (const f of fields) {
    if (!f.options.formula || f.type === "link") continue;
    out[f.id] = storedFormulaValue(valueOf(f));
  }
  return out;
}
