// The parts and functions an agent may use in an A2UI card (decision 2026-10-18 "Try A2UI"):
// plain definitions (no drawing), shared by the server (to teach the assistant and check what it
// writes) and the apps (to draw it, "@assistant/cards/native"). Schemas are Zod 3 (`zod/v3`)
// because A2UI's core reads Zod 3; the core recognises a bound property by its description.
//
// Money is always in paise (rule 5): 150000 is ₹1,500.
import { z } from "zod/v3";
import { createFunctionImplementation } from "@a2ui/web_core";

export const A2UI_VERSION = "v0.9";
export const A2UI_CATALOG = "gigspree:cards:v1";

const ref = (def: string, what: string) => `REF:#/$defs/${def}|${what}`;
const pathRef = z.object({ path: z.string() });
const callRef = z.object({ call: z.string(), args: z.record(z.unknown()).optional() });

/** Property types: a literal, `{path}` into the card's data, or `{call, args}` (a function). */
export const A2 = {
  string: (what = "text") => z.union([z.string(), pathRef, callRef]).describe(ref("DynamicString", what)),
  number: (what = "number") => z.union([z.number(), pathRef, callRef]).describe(ref("DynamicNumber", what)),
  boolean: (what = "yes or no") =>
    z.union([z.boolean(), pathRef, callRef]).describe(ref("DynamicBoolean", what)),
  /** Any value (lists for charts and choices). */
  value: (what = "value") =>
    z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.unknown()),
        z.record(z.unknown()),
        pathRef,
        callRef,
      ])
      .describe(ref("DynamicValue", what)),
  /** Children by id, or one part repeated for each item of a list in the data. */
  children: () =>
    z
      .union([z.array(z.string()), z.object({ componentId: z.string(), path: z.string() })])
      .describe(ref("ChildList", "children")),
  /** What a tap does: a function here on the card, or an event the app handles. */
  action: () =>
    z
      .union([
        z.object({ functionCall: z.object({ call: z.string(), args: z.record(z.unknown()).optional() }) }),
        z.object({ event: z.object({ name: z.string(), context: z.record(z.unknown()).optional() }) }),
      ])
      .describe(ref("Action", "what a tap does")),
};

const tone = z.enum(["plain", "muted", "accent", "good", "warn", "danger"]);
const format = z.enum(["money", "number", "percent", "text"]);

export interface PartApi {
  name: string;
  /** One line for the assistant: what it is for. */
  about: string;
  schema: z.ZodTypeAny;
}

/** Every part takes `visible` (hide it when false). */
const part = (name: string, about: string, shape: z.ZodRawShape): PartApi => ({
  name,
  about,
  schema: z.object({ ...shape, visible: A2.boolean("shown when true").optional() }),
});

export const PART_APIS: PartApi[] = [
  // Layout
  part("Column", "Parts one under the other.", {
    children: A2.children(),
    gap: z.enum(["none", "small", "medium", "large"]).optional(),
  }),
  part("Row", "Parts side by side, sharing the width.", {
    children: A2.children(),
    align: z.enum(["start", "center", "end", "spread"]).optional(),
  }),
  part("Grid", "Parts in 2 or 3 equal columns, wrapping (stat tiles).", {
    children: A2.children(),
    columns: z.union([z.literal(2), z.literal(3)]).optional(),
  }),
  part("Card", "A panel with an optional title and subtitle; the usual root.", {
    title: A2.string("title").optional(),
    subtitle: A2.string("subtitle").optional(),
    children: A2.children(),
  }),
  part("Section", "A titled group inside a card (no panel of its own).", {
    title: A2.string("title"),
    children: A2.children(),
  }),
  part("Tabs", "Tabs, each showing one child; which tab is open is the person's.", {
    tabs: z
      .array(z.object({ title: z.string(), child: z.string() }))
      .min(2)
      .max(5),
  }),
  part("Divider", "A thin line.", {}),
  // Content
  part("Text", "Words. Styles: title, heading, body, small, caption.", {
    text: A2.string(),
    style: z.enum(["title", "heading", "body", "small", "caption"]).optional(),
    tone: tone.optional(),
  }),
  part("Stat", "A figure with a label (and a hint under it): totals, counts, averages.", {
    label: A2.string("label"),
    value: A2.value("the figure"),
    format: format.optional(),
    hint: A2.string("a short line under the figure").optional(),
    tone: tone.optional(),
  }),
  part("KeyValue", "One labelled value on a line (details of a record).", {
    label: A2.string("label"),
    value: A2.value("value"),
    format: format.optional(),
  }),
  part("Badge", "A small coloured label (a status).", { text: A2.string(), tone: tone.optional() }),
  part("Progress", "A bar from 0 to 1 with an optional label.", {
    value: A2.number("0 to 1"),
    label: A2.string("label").optional(),
    tone: tone.optional(),
  }),
  part("Notice", "A highlighted line (a tip, a warning).", { text: A2.string(), tone: tone.optional() }),
  // Inputs (each writes into the card's data at the path its value is bound to)
  part("Picker", "Pick one of 2 to 6 options, as a row of buttons (a period, a view).", {
    value: A2.string("the choice"),
    options: z.array(z.string()).min(2).max(6),
  }),
  part("Chips", "Pick any number of options (filters); the value is a list of the picked ones.", {
    value: A2.value("the picked options (a list)"),
    options: z.array(z.string()).min(1).max(10),
  }),
  part("Slider", "A number between min and max.", {
    label: A2.string("label"),
    value: A2.number("the number"),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    format: format.optional(),
  }),
  part("Switch", "On or off, with a label.", {
    label: A2.string("label"),
    value: A2.boolean("on"),
    hint: A2.string("a short line under the label").optional(),
  }),
  part("Radio", "Pick one of a short list, one per line.", {
    label: A2.string("label").optional(),
    value: A2.string("the choice"),
    options: z.array(z.string()).min(2).max(8),
  }),
  part("Field", "A box to type in. kind number or money stores a number (money in paise).", {
    label: A2.string("label"),
    value: A2.value("what is typed"),
    placeholder: z.string().optional(),
    kind: z.enum(["text", "number", "money"]).optional(),
  }),
  part("Button", "A button. confirm asks before it acts.", {
    label: A2.string("label"),
    action: A2.action(),
    style: z.enum(["primary", "secondary", "danger"]).optional(),
    confirm: z.string().optional(),
  }),
  // Lists
  part("List", "Rows, usually one template repeated for each item of a list in the data.", {
    children: A2.children(),
    empty: z.string().optional(),
  }),
  part("ItemRow", "A row: title, subtitle, an amount and a badge; tapping it runs its action.", {
    title: A2.string("title"),
    subtitle: A2.string("second line").optional(),
    amount: A2.number("amount in paise").optional(),
    badge: A2.string("status").optional(),
    badgeTone: A2.string("plain, muted, accent, good, warn or danger").optional(),
    selected: A2.boolean("highlighted").optional(),
    action: A2.action().optional(),
  }),
  part("CheckRow", "A row with a tick that writes yes/no into its item, and an amount.", {
    label: A2.string("label"),
    detail: A2.string("second line").optional(),
    checked: A2.boolean("ticked"),
    amount: A2.number("amount in paise").optional(),
  }),
  // Charts
  part(
    "BarChart",
    "Horizontal bars: from `bars` [{label, value}], or from a list with labelField and valueField.",
    {
      bars: z.array(z.object({ label: A2.string("label"), value: A2.number("value") })).optional(),
      data: A2.value("a list of items").optional(),
      labelField: z.string().optional(),
      valueField: z.string().optional(),
      format: format.optional(),
    },
  ),
  part(
    "LineChart",
    "A line over time: from `points` [{label, value}], or from a list with labelField and valueField.",
    {
      points: z.array(z.object({ label: A2.string("label"), value: A2.number("value") })).optional(),
      data: A2.value("a list of items").optional(),
      labelField: z.string().optional(),
      valueField: z.string().optional(),
      format: format.optional(),
      height: z.number().min(80).max(260).optional(),
    },
  ),
];

// --- Functions: safe calculations the card runs itself ----------------------------------

/** An argument that may be a literal, a path or another call. */
const dyn = <T extends z.ZodTypeAny>(t: T) => z.union([t, pathRef, callRef]);
const list = dyn(z.array(z.unknown()));
const num = dyn(z.number());
const where = z
  .object({
    field: z.string(),
    equals: dyn(z.unknown()).optional(),
    in: dyn(z.array(z.unknown())).optional(),
    not: dyn(z.unknown()).optional(),
  })
  .optional();
type Where = { field: string; equals?: unknown; in?: unknown[]; not?: unknown } | undefined;

const items = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const matches = (r: Record<string, unknown>, w: Where) => {
  if (!w) return true;
  const v = r[w.field];
  // An empty "in" list (no filter chips picked) keeps everything.
  if (Array.isArray(w.in) && w.in.length && !w.in.includes(v)) return false;
  if ("equals" in w && w.equals !== undefined && w.equals !== "" && v !== w.equals) return false;
  if ("not" in w && w.not !== undefined && v === w.not) return false;
  return true;
};

interface FunctionDoc {
  name: string;
  about: string;
}
export const FUNCTION_DOCS: FunctionDoc[] = [];

function fn<S extends z.ZodTypeAny>(
  name: string,
  about: string,
  returnType: "number" | "string" | "boolean" | "array" | "object" | "any" | "void",
  schema: S,
  run: (
    args: z.infer<S>,
    ctx: { set(path: string, v: unknown): void; resolveDynamicValue(v: unknown): unknown; path?: string },
  ) => unknown,
) {
  FUNCTION_DOCS.push({ name, about });
  return createFunctionImplementation(
    { name, returnType, schema } as never,
    ((args: z.infer<S>, ctx: never) => run(args, ctx)) as never,
  );
}

export const FUNCTIONS = [
  fn(
    "sum",
    "sum {list, field, where?}: adds a field over a list (where: {field, equals | in | not}).",
    "number",
    z.object({ list, field: z.string(), where }),
    (a) =>
      items(a.list)
        .filter((r) => matches(r, a.where as Where))
        .reduce((t, r) => t + n(r[a.field]), 0),
  ),
  fn(
    "count",
    "count {list, where?}: how many items.",
    "number",
    z.object({ list, where }),
    (a) => items(a.list).filter((r) => matches(r, a.where as Where)).length,
  ),
  fn(
    "average",
    "average {list, field, where?}.",
    "number",
    z.object({ list, field: z.string(), where }),
    (a) => {
      const rows = items(a.list).filter((r) => matches(r, a.where as Where));
      return rows.length ? rows.reduce((t, r) => t + n(r[a.field]), 0) / rows.length : 0;
    },
  ),
  fn("max", "max {list, field}.", "number", z.object({ list, field: z.string() }), (a) =>
    Math.max(0, ...items(a.list).map((r) => n(r[a.field]))),
  ),
  fn(
    "filter",
    "filter {list, where}: the items that match (for a List or a chart).",
    "array",
    z.object({ list, where }),
    (a) => items(a.list).filter((r) => matches(r, a.where as Where)),
  ),
  fn(
    "groupSum",
    "groupSum {list, by, field, where?}: [{label, value}] totals per value of `by` (for charts).",
    "array",
    z.object({ list, by: z.string(), field: z.string(), where }),
    (a) => {
      const out = new Map<string, number>();
      for (const r of items(a.list).filter((r) => matches(r, a.where as Where)))
        out.set(String(r[a.by] ?? "Other"), (out.get(String(r[a.by] ?? "Other")) ?? 0) + n(r[a.field]));
      return [...out].map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value);
    },
  ),
  fn("add", "add {a, b}.", "number", z.object({ a: num, b: num }), (a) => n(a.a) + n(a.b)),
  fn("subtract", "subtract {a, b}: a − b.", "number", z.object({ a: num, b: num }), (a) => n(a.a) - n(a.b)),
  fn("multiply", "multiply {a, b}.", "number", z.object({ a: num, b: num }), (a) => n(a.a) * n(a.b)),
  fn("divide", "divide {a, b}: a ÷ b (0 when b is 0).", "number", z.object({ a: num, b: num }), (a) =>
    n(a.b) === 0 ? 0 : n(a.a) / n(a.b),
  ),
  fn(
    "round",
    "round {value, places?}.",
    "number",
    z.object({ value: num, places: z.number().optional() }),
    (a) => Math.round(n(a.value) * 10 ** (a.places ?? 0)) / 10 ** (a.places ?? 0),
  ),
  fn(
    "loanPayment",
    "loanPayment {principal, yearlyRatePercent, months}: the monthly instalment (EMI).",
    "number",
    z.object({ principal: num, yearlyRatePercent: num, months: num }),
    (a) => {
      const p = n(a.principal);
      const r = n(a.yearlyRatePercent) / 1200;
      const m = Math.max(1, Math.round(n(a.months)));
      return Math.round(r === 0 ? p / m : (p * r * (1 + r) ** m) / ((1 + r) ** m - 1));
    },
  ),
  fn(
    "growth",
    "growth {start, monthly, yearlyRatePercent, months}: [{label, value}] balance month by month (savings).",
    "array",
    z.object({ start: num, monthly: num, yearlyRatePercent: num, months: num }),
    (a) => {
      const r = n(a.yearlyRatePercent) / 1200;
      const out: { label: string; value: number }[] = [];
      let bal = n(a.start);
      const months = Math.min(600, Math.max(1, Math.round(n(a.months))));
      const every = Math.max(1, Math.round(months / 12));
      for (let i = 1; i <= months; i++) {
        bal = bal * (1 + r) + n(a.monthly);
        if (i % every === 0 || i === months) out.push({ label: `M${i}`, value: Math.round(bal) });
      }
      return out;
    },
  ),
  fn(
    "equals",
    "equals {a, b}: yes when they are the same.",
    "boolean",
    z.object({ a: dyn(z.unknown()), b: dyn(z.unknown()) }),
    (a) => a.a === a.b,
  ),
  fn("not", "not {value}.", "boolean", z.object({ value: dyn(z.unknown()) }), (a) => !a.value),
  fn(
    "includes",
    "includes {list, value}: yes when value is in the list; an empty list lets everything through (for Chips filters on rows' visible).",
    "boolean",
    z.object({ list: dyn(z.array(z.unknown())), value: dyn(z.unknown()) }),
    (a) => !Array.isArray(a.list) || a.list.length === 0 || a.list.includes(a.value),
  ),
  fn(
    "isSet",
    "isSet {value}: yes when it has a value (something is selected).",
    "boolean",
    z.object({ value: dyn(z.unknown()) }),
    (a) => a.value !== undefined && a.value !== null && a.value !== "",
  ),
  fn(
    "pick",
    "pick {when, then, else}: one value or the other.",
    "any",
    z.object({ when: dyn(z.unknown()), then: dyn(z.unknown()), else: dyn(z.unknown()) }),
    (a) => (a.when ? a.then : a.else),
  ),
  fn(
    "text",
    "text {parts: [...]}: joins words and values into one line.",
    "string",
    z.object({ parts: z.array(dyn(z.unknown())) }),
    (a) => a.parts.map((p) => String(p ?? "")).join(""),
  ),
  fn(
    "money",
    'money {value}: ₹ words for paise ("₹1,500").',
    "string",
    z.object({ value: num }),
    (a) => `₹${Math.round(n(a.value) / 100).toLocaleString("en-IN")}`,
  ),
  // Actions (used as a Button's or ItemRow's functionCall)
  fn(
    "set",
    "set {path, value}: writes a value into the card's data (an action).",
    "void",
    z.object({ path: z.string(), value: dyn(z.unknown()) }),
    (a, ctx) => ctx.set(a.path, a.value),
  ),
  fn(
    "toggle",
    "toggle {path}: flips a yes/no in the card's data (an action).",
    "void",
    z.object({ path: z.string() }),
    (a, ctx) => ctx.set(a.path, !ctx.resolveDynamicValue({ path: a.path })),
  ),
  fn(
    "removeItem",
    "removeItem {}: from inside a List row, removes that row's item from its list (an action; pair it with confirm).",
    "void",
    z.object({}),
    (_a, ctx) => {
      const at = /^(.*)\/(\d+)$/.exec(ctx.path ?? "");
      if (!at) return;
      const list = ctx.resolveDynamicValue({ path: at[1] || "/" });
      if (Array.isArray(list))
        ctx.set(
          at[1] || "/",
          list.filter((_, i) => i !== Number(at[2])),
        );
    },
  ),
  fn(
    "select",
    'select {to}: from a row in a List, copies that row\'s item to `to` (e.g. "/selected") (an action).',
    "void",
    z.object({ to: z.string() }),
    (a, ctx) => ctx.set(a.to, ctx.resolveDynamicValue({ path: ctx.path ?? "/" })),
  ),
];
