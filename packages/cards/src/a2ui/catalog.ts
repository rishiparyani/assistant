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
const format = z.enum(["money", "number", "percent", "text", "date"]);
/** A part's colour: one of the app's (drawn in its light and dark forms). */
export const COLOURS = [
  "accent",
  "blue",
  "green",
  "teal",
  "orange",
  "purple",
  "pink",
  "red",
  "grey",
  "good",
  "warn",
  "danger",
] as const;
const colour = z.enum(COLOURS);
/** An icon is one emoji (drawn in a soft square of its colour). */
const icon = () => z.string().max(8).describe("one emoji");
/** Fields of a list's items to read (a chart's label and value). */
const field = () => z.string().max(80);

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
  part("Card", "A panel with an optional title, subtitle and icon; the usual root. colour tints it.", {
    title: A2.string("title").optional(),
    subtitle: A2.string("subtitle").optional(),
    icon: icon().optional(),
    colour: colour.optional(),
    children: A2.children(),
  }),
  part("Section", "A titled group inside a card (no panel of its own); action shows a link on the right.", {
    title: A2.string("title"),
    icon: icon().optional(),
    actionLabel: z.string().max(30).optional(),
    action: A2.action().optional(),
    children: A2.children(),
  }),
  part("Accordion", "A row that opens to show its children (details, more options).", {
    title: A2.string("title"),
    subtitle: A2.string("second line").optional(),
    icon: icon().optional(),
    open: z.boolean().optional(),
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
  part("Text", "Words. Styles: display (huge), title, heading, body, small, caption.", {
    text: A2.string(),
    style: z.enum(["display", "title", "heading", "body", "small", "caption"]).optional(),
    tone: tone.optional(),
    align: z.enum(["start", "center", "end"]).optional(),
  }),
  part(
    "Hero",
    "The headline figure of a card, big: a label, the figure, a change against before (+12% ↑) and a small trend line.",
    {
      label: A2.string("label"),
      value: A2.value("the figure"),
      format: format.optional(),
      change: A2.number("percent change, e.g. 12 or -8").optional(),
      changeLabel: A2.string('what the change compares, e.g. "vs last month"').optional(),
      goodWhen: z.enum(["up", "down"]).optional(),
      icon: icon().optional(),
      colour: colour.optional(),
      trend: A2.value("a list of numbers, or of items read with trendField").optional(),
      trendField: field().optional(),
    },
  ),
  part("Stat", "A figure with a label (and a hint under it): totals, counts, averages.", {
    label: A2.string("label"),
    value: A2.value("the figure"),
    format: format.optional(),
    hint: A2.string("a short line under the figure").optional(),
    tone: tone.optional(),
    icon: icon().optional(),
    colour: colour.optional(),
    change: A2.number("percent change").optional(),
    goodWhen: z.enum(["up", "down"]).optional(),
    trend: A2.value("a list of numbers, or of items read with trendField").optional(),
    trendField: field().optional(),
  }),
  part(
    "Tile",
    "A small square with an icon, a figure and a label (a grid of these reads like a phone's widgets).",
    {
      icon: icon().optional(),
      label: A2.string("label"),
      value: A2.value("the figure").optional(),
      format: format.optional(),
      colour: colour.optional(),
      action: A2.action().optional(),
    },
  ),
  part("Icon", "An emoji in a soft square of a colour.", {
    icon: icon(),
    colour: colour.optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
  }),
  part("Avatar", "A person's initials in a circle of their own colour.", {
    name: A2.string("their name"),
    size: z.enum(["small", "medium", "large"]).optional(),
  }),
  part("AvatarStack", "Overlapping initials of several people (who's in).", {
    names: A2.value("a list of names"),
    max: z.number().min(1).max(8).optional(),
  }),
  part("KeyValue", "One labelled value on a line (details of a record).", {
    label: A2.string("label"),
    value: A2.value("value"),
    format: format.optional(),
  }),
  part("Badge", "A small coloured label (a status).", {
    text: A2.string(),
    tone: tone.optional(),
    icon: icon().optional(),
  }),
  part(
    "Progress",
    'A bar from 0 to 1 with an optional label; with current and target it reads "₹8,000 of ₹10,000" (a budget).',
    {
      value: A2.number("0 to 1"),
      label: A2.string("label").optional(),
      tone: tone.optional(),
      current: A2.number("how much so far").optional(),
      target: A2.number("the goal").optional(),
      format: format.optional(),
    },
  ),
  part("ProgressRing", "A ring filled from 0 to 1 with the share (or a label) in the middle.", {
    value: A2.number("0 to 1"),
    label: A2.string("under the ring").optional(),
    centre: A2.string("in the middle (default: the percentage)").optional(),
    colour: colour.optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
  }),
  part("Notice", "A highlighted box (a tip, a warning) with an optional title and icon.", {
    text: A2.string(),
    title: A2.string("title").optional(),
    icon: icon().optional(),
    tone: tone.optional(),
  }),
  part("Countdown", 'Days until a date, big ("12 days"), with a label.', {
    label: A2.string("label"),
    date: A2.string("the date, YYYY-MM-DD"),
    icon: icon().optional(),
    colour: colour.optional(),
  }),
  part("Steps", "A row of numbered steps; those before `current` are done (a process, a plan).", {
    steps: z
      .array(z.object({ title: z.string(), detail: z.string().optional() }))
      .min(2)
      .max(8),
    current: A2.number("the step now, from 0"),
  }),
  // Inputs (each writes into the card's data at the path its value is bound to)
  part("Picker", "Pick one of 2 to 6 options, as a row of buttons (a period, a view).", {
    value: A2.string("the choice"),
    options: z.array(z.string()).min(2).max(6),
  }),
  part("Segmented", "Pick one of 2 to 4 short options in a compact switch (Week | Month | Year).", {
    value: A2.string("the choice"),
    options: z.array(z.string()).min(2).max(4),
  }),
  part("Search", "A search box; filter a list with the search function on its value.", {
    value: A2.string("what is typed"),
    placeholder: z.string().optional(),
  }),
  part("Stepper", "A number with − and + buttons (people, quantities).", {
    label: A2.string("label"),
    value: A2.number("the number"),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    format: format.optional(),
  }),
  part("Stars", "A rating from 0 to 5 stars.", {
    label: A2.string("label").optional(),
    value: A2.number("the rating"),
    max: z.number().min(3).max(10).optional(),
  }),
  part("DateField", "Pick a day on a small month calendar; the value is YYYY-MM-DD.", {
    label: A2.string("label"),
    value: A2.string("the day"),
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
  part(
    "ItemRow",
    "A row: icon or initials, title, subtitle, an amount and a badge; tapping it runs its action.",
    {
      title: A2.string("title"),
      subtitle: A2.string("second line").optional(),
      icon: icon().optional(),
      avatar: A2.string("a person's name, drawn as initials").optional(),
      date: A2.string("a day (YYYY-MM-DD) shown as a small date tile").optional(),
      colour: colour.optional(),
      amount: A2.number("amount in paise").optional(),
      badge: A2.string("status").optional(),
      badgeTone: A2.string("plain, muted, accent, good, warn or danger").optional(),
      selected: A2.boolean("highlighted").optional(),
      action: A2.action().optional(),
    },
  ),
  part("CheckRow", "A row with a tick that writes yes/no into its item, and an amount.", {
    label: A2.string("label"),
    detail: A2.string("second line").optional(),
    checked: A2.boolean("ticked"),
    amount: A2.number("amount in paise").optional(),
  }),
  // Charts
  part(
    "BarChart",
    'Horizontal bars: from `bars` [{label, value}], or from a list with labelField and valueField. multicolour gives each bar its own colour. With `selected` bound to a path (e.g. {path: "/picked"}), tapping a bar writes its label there (tap again to clear) and the other bars dim: pair it with a filter on that path to show what\'s inside the tapped bar.',
    {
      bars: z.array(z.object({ label: A2.string("label"), value: A2.number("value") })).optional(),
      data: A2.value("a list of items").optional(),
      labelField: z.string().optional(),
      valueField: z.string().optional(),
      format: format.optional(),
      colour: colour.optional(),
      multicolour: z.boolean().optional(),
      selected: A2.string("the tapped bar's label").optional(),
    },
  ),
  part(
    "ColumnChart",
    "Upright columns over time or categories, from a list with labelField and one value field, or several `fields` stacked (with a legend).",
    {
      data: A2.value("a list of items"),
      labelField: field(),
      valueField: field().optional(),
      fields: z
        .array(z.object({ field: field(), label: z.string(), colour: colour.optional() }))
        .max(5)
        .optional(),
      format: format.optional(),
      colour: colour.optional(),
      height: z.number().min(100).max(280).optional(),
    },
  ),
  part(
    "PieChart",
    "A donut (or a pie) of shares, from `slices` [{label, value}] or a list with labelField and valueField; the total sits in the middle, a legend below.",
    {
      slices: z.array(z.object({ label: A2.string("label"), value: A2.number("value") })).optional(),
      data: A2.value("a list of items").optional(),
      labelField: field().optional(),
      valueField: field().optional(),
      format: format.optional(),
      donut: z.boolean().optional(),
      centre: A2.string("in the middle (default: the total)").optional(),
    },
  ),
  part("Sparkline", "A small trend line with no axes (beside a figure, in a row).", {
    data: A2.value("a list of numbers, or of items read with valueField"),
    valueField: field().optional(),
    colour: colour.optional(),
    height: z.number().min(20).max(80).optional(),
  }),
  part(
    "Heatmap",
    "Days as small squares over the last weeks, darker for more (habits, activity, spending by day).",
    {
      data: A2.value("a list of items"),
      dateField: field(),
      valueField: field().optional(),
      weeks: z.number().min(4).max(26).optional(),
      colour: colour.optional(),
      label: z.string().max(40).optional(),
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
      colour: colour.optional(),
      compare: z.array(z.object({ label: A2.string("label"), value: A2.number("value") })).optional(),
      compareData: A2.value("a second list read with the same fields (last month), drawn dotted").optional(),
      compareLabel: z.string().max(30).optional(),
      label: z.string().max(30).optional(),
    },
  ),
  // Lists drawn whole
  part(
    "Table",
    "Rows and columns from a list: columns [{label, field, format?}]; total adds a sum row for number and money columns.",
    {
      data: A2.value("a list of items"),
      columns: z
        .array(
          z.object({
            label: z.string(),
            field: field(),
            format: format.optional(),
            align: z.enum(["start", "end"]).optional(),
          }),
        )
        .min(1)
        .max(6),
      total: z.boolean().optional(),
      max: z.number().min(1).max(100).optional(),
      empty: z.string().optional(),
    },
  ),
  part("Timeline", "Items down a line with dots, newest or soonest first (what happened, what's coming).", {
    data: A2.value("a list of items"),
    titleField: field(),
    detailField: field().optional(),
    dateField: field().optional(),
    amountField: field().optional(),
    max: z.number().min(1).max(50).optional(),
    empty: z.string().optional(),
  }),
  part(
    "Calendar",
    "A month of days; days with items get a dot (or their count). value (a path) is the day tapped (YYYY-MM-DD), for a list of that day's items.",
    {
      data: A2.value("a list of items").optional(),
      dateField: field().optional(),
      value: A2.string("the day picked").optional(),
      month: A2.string("YYYY-MM (default: this month)").optional(),
      colour: colour.optional(),
    },
  ),
  part(
    "Board",
    "Columns of cards by a field's value (To do | Doing | Done). With data as a path, each card has a → that moves it to the next column (saved to the record).",
    {
      data: A2.value("a list of items"),
      groupField: field(),
      columns: z.array(z.string()).min(2).max(5),
      titleField: field(),
      subtitleField: field().optional(),
      amountField: field().optional(),
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
    above: num.optional(),
    below: num.optional(),
    contains: dyn(z.string()).optional(),
  })
  .optional();
type Where =
  | {
      field: string;
      equals?: unknown;
      in?: unknown[];
      not?: unknown;
      above?: unknown;
      below?: unknown;
      contains?: unknown;
    }
  | undefined;

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
  if (w.above !== undefined && w.above !== null && !(n(v) > n(w.above))) return false;
  if (w.below !== undefined && w.below !== null && !(n(v) < n(w.below))) return false;
  if (
    typeof w.contains === "string" &&
    w.contains &&
    !String(v ?? "")
      .toLowerCase()
      .includes(w.contains.toLowerCase())
  )
    return false;
  return true;
};

/** A day from a value: "2026-10-19", an ISO time, or nothing. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  // A time: the day it is on this device (an ISO time in UTC can be the next day in India).
  if (v.length > 10 && v.includes("T")) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return localDay(d);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}
/** A date as YYYY-MM-DD on this device. */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthOf = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return localDay(d).slice(0, 7);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    "sum {list, field, where?}: adds a field over a list (where: {field, equals | in | not | above | below | contains}).",
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
    "size",
    "size {list}: how many things a list holds, of any kind (picked Chips, names, items).",
    "number",
    z.object({ list }),
    (a) => (Array.isArray(a.list) ? a.list.length : 0),
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
  fn(
    "groupCount",
    "groupCount {list, by, where?}: [{label, value}] how many per value of `by` (for charts).",
    "array",
    z.object({ list, by: z.string(), where }),
    (a) => {
      const out = new Map<string, number>();
      for (const r of items(a.list).filter((r) => matches(r, a.where as Where)))
        out.set(String(r[a.by] ?? "Other"), (out.get(String(r[a.by] ?? "Other")) ?? 0) + 1);
      return [...out].map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value);
    },
  ),
  fn(
    "byMonth",
    'byMonth {list, dateField, field?, months?}: [{label: "Oct", value}] per month for the last `months` (6), summing `field` or counting.',
    "array",
    z.object({ list, dateField: z.string(), field: z.string().optional(), months: z.number().optional() }),
    (a) => {
      const count = Math.min(24, Math.max(1, Math.round(a.months ?? 6)));
      const keys = Array.from({ length: count }, (_, i) => monthOf(i - count + 1));
      const totals = new Map(keys.map((k) => [k, 0]));
      for (const r of items(a.list)) {
        const k = dayOf(r[a.dateField])?.slice(0, 7);
        if (k && totals.has(k)) totals.set(k, totals.get(k)! + (a.field ? n(r[a.field]) : 1));
      }
      return keys.map((k) => ({ label: MONTHS[Number(k.slice(5)) - 1]!, value: totals.get(k)! }));
    },
  ),
  fn(
    "inMonth",
    'inMonth {list, dateField, month}: the items in a month: "this", "last" or "YYYY-MM".',
    "array",
    z.object({ list, dateField: z.string(), month: dyn(z.string()) }),
    (a) => {
      const m =
        a.month === "last" ? monthOf(-1) : a.month === "this" || !a.month ? monthOf(0) : String(a.month);
      return items(a.list).filter((r) => dayOf(r[a.dateField])?.startsWith(m));
    },
  ),
  fn(
    "search",
    "search {list, text, fields?}: the items with the text in any of `fields` (or any field); empty text keeps all.",
    "array",
    z.object({ list, text: dyn(z.string()), fields: z.array(z.string()).optional() }),
    (a) => {
      const q = String(a.text ?? "")
        .trim()
        .toLowerCase();
      if (!q) return items(a.list);
      return items(a.list).filter((r) =>
        (a.fields?.length ? a.fields.map((f) => r[f]) : Object.values(r)).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    },
  ),
  fn(
    "sortBy",
    "sortBy {list, field, desc?}: the items in order of a field (dates, amounts, names).",
    "array",
    z.object({ list, field: dyn(z.string()), desc: dyn(z.boolean()).optional() }),
    (a) => {
      const f = String(a.field);
      const out = [...items(a.list)].sort((x, y) => {
        const p = x[f];
        const q = y[f];
        if (typeof p === "number" || typeof q === "number") return n(p) - n(q);
        return String(p ?? "").localeCompare(String(q ?? ""));
      });
      return a.desc ? out.reverse() : out;
    },
  ),
  fn("take", "take {list, count}: the first few items.", "array", z.object({ list, count: num }), (a) =>
    items(a.list).slice(0, Math.max(0, Math.round(n(a.count)))),
  ),
  fn("min", "min {list, field}.", "number", z.object({ list, field: z.string() }), (a) => {
    const v = items(a.list).map((r) => n(r[a.field]));
    return v.length ? Math.min(...v) : 0;
  }),
  fn(
    "percent",
    "percent {a, b}: a as a percentage of b (0 when b is 0).",
    "number",
    z.object({ a: num, b: num }),
    (a) => (n(a.b) === 0 ? 0 : (n(a.a) / n(a.b)) * 100),
  ),
  fn(
    "change",
    "change {now, before}: the percent change from before to now (for Hero and Stat change).",
    "number",
    z.object({ now: num, before: num }),
    (a) =>
      n(a.before) === 0 ? 0 : Math.round(((n(a.now) - n(a.before)) / Math.abs(n(a.before))) * 1000) / 10,
  ),
  fn(
    "daysUntil",
    "daysUntil {date}: whole days from today to a date (negative when past).",
    "number",
    z.object({ date: dyn(z.string()) }),
    (a) => {
      const d = dayOf(a.date);
      if (!d) return 0;
      return Math.round(
        (Date.parse(`${d}T00:00:00`) - Date.parse(`${localDay(new Date())}T00:00:00`)) / 86_400_000,
      );
    },
  ),
  fn(
    "dateText",
    'dateText {date, style?}: a date in words: "Mon 19 Oct" (short), "19 Oct 2026" (long), "Today"/"Tomorrow" when near.',
    "string",
    z.object({ date: dyn(z.unknown()), style: z.enum(["short", "long"]).optional() }),
    (a) => {
      const d = dayOf(a.date);
      if (!d) return "";
      const today = localDay(new Date());
      const tomorrow = localDay(new Date(Date.now() + 86_400_000));
      if (d === today) return "Today";
      if (d === tomorrow) return "Tomorrow";
      const at = new Date(`${d}T00:00:00`);
      const mon = MONTHS[at.getMonth()]!;
      return a.style === "long"
        ? `${at.getDate()} ${mon} ${at.getFullYear()}`
        : `${DAYS[at.getDay()]} ${at.getDate()} ${mon}`;
    },
  ),
  fn("today", "today {}: today's date, YYYY-MM-DD.", "string", z.object({}), () => localDay(new Date())),
  fn(
    "greater",
    "greater {a, b}: yes when a > b.",
    "boolean",
    z.object({ a: num, b: num }),
    (a) => n(a.a) > n(a.b),
  ),
  fn("less", "less {a, b}: yes when a < b.", "boolean", z.object({ a: num, b: num }), (a) => n(a.a) < n(a.b)),
  fn(
    "and",
    "and {values: [...]}: yes when all are.",
    "boolean",
    z.object({ values: z.array(dyn(z.unknown())) }),
    (a) => a.values.every(Boolean),
  ),
  fn(
    "or",
    "or {values: [...]}: yes when any is.",
    "boolean",
    z.object({ values: z.array(dyn(z.unknown())) }),
    (a) => a.values.some(Boolean),
  ),
  fn(
    "first",
    "first {list, field?}: the first item (or its field).",
    "any",
    z.object({ list, field: z.string().optional() }),
    (a) => {
      const r = items(a.list)[0];
      return r ? (a.field ? r[a.field] : r) : null;
    },
  ),
  fn(
    "pluck",
    "pluck {list, field}: [values] one field of each item (a Sparkline's numbers, an AvatarStack's names).",
    "array",
    z.object({ list, field: z.string() }),
    (a) => items(a.list).map((r) => r[a.field]),
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
    "removeItem {}: from inside a List row, removes that row's item from its list (an action; pair it with confirm). On a list filled from the person's list it deletes that record (it goes to Recently deleted).",
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
    "addItem",
    "addItem {to, from?, item?}: adds an item to the list at `to` (an action): the object at `from` (a draft the card's Fields fill, e.g. \"/draft\", emptied after) or `item`. On a list filled from the person's list it becomes a new record (fields by name).",
    "void",
    z.object({ to: z.string(), from: z.string().optional(), item: z.record(z.unknown()).optional() }),
    (a, ctx) => {
      const draft = a.from ? ctx.resolveDynamicValue({ path: a.from }) : a.item;
      if (!draft || typeof draft !== "object" || Array.isArray(draft)) return;
      // Nothing typed: nothing to add.
      if (!Object.values(draft).some((v) => v !== "" && v !== null && v !== undefined)) return;
      const list = ctx.resolveDynamicValue({ path: a.to });
      ctx.set(a.to, [...(Array.isArray(list) ? list : []), { ...(draft as object) }]);
      if (a.from) ctx.set(a.from, {});
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

// --- Actions a card's button may ask the app to do (decision 2026-10-19 "Buttons that act") ---
// Each is one of the app's own operations, checked by the server as if the person did it from a
// screen; the app always shows what it will do in plain words and runs it only after Confirm.
// A button names one with {event: {name, context: {...args}}}; args may be paths into the data.

export interface CardAction {
  method: "POST";
  /** The operation's address; ":name" parts come from the args. */
  path: string;
  /** Args it needs (the rest are optional). */
  needs: string[];
  /** What it will do, for the confirm step: {arg} is filled in, whole (never shortened). */
  says: string;
  about: string;
  /** Names the app looks up before asking (which chat, which record), so the confirm step
   *  says where it goes; a lookup that fails stops the action. {as} is the word in `says`. */
  names?: { arg: string; path: string; field: "name" | "title"; as: string }[];
}

export const CARD_ACTIONS: Record<string, CardAction> = {
  post_message: {
    method: "POST",
    path: "/api/groups/:group_id/messages",
    needs: ["group_id", "text"],
    says: "Send “{text}” to {chat}",
    names: [{ arg: "group_id", path: "/api/groups/:group_id", field: "name", as: "chat" }],
    about: "post_message {group_id, text}: writes in a group chat (ids from list_groups).",
  },
  ask_everyone: {
    method: "POST",
    path: "/api/groups/:group_id/polls",
    needs: ["group_id", "question"],
    says: "Ask {chat}: “{question}”",
    names: [{ arg: "group_id", path: "/api/groups/:group_id", field: "name", as: "chat" }],
    about: "ask_everyone {group_id, question, options?}: a poll in a group chat.",
  },
  remind_waiting: {
    method: "POST",
    path: "/api/waiting/:wait_id/nudge",
    needs: ["wait_id"],
    says: "Ask again the people this is waiting on",
    about:
      "remind_waiting {wait_id}: asks again, now, the people a process is waiting on (ids from whats_waiting).",
  },
  add_to_calendar: {
    method: "POST",
    path: "/api/connectors/google-calendar/events",
    needs: ["title", "start"],
    says: "Add “{title}” to your calendar ({start})",
    about:
      "add_to_calendar {title, start, end?, place?}: an event in the person's Google Calendar (start YYYY-MM-DDTHH:MM).",
  },
  remember: {
    method: "POST",
    path: "/api/memories",
    needs: ["text"],
    says: "Remember: “{text}”",
    about: "remember {text}: one fact or preference the assistant keeps.",
  },
  comment: {
    method: "POST",
    path: "/api/records/:record_id/comments",
    needs: ["record_id", "body"],
    says: "Comment on “{record}”: “{body}”",
    names: [{ arg: "record_id", path: "/api/records/:record_id", field: "title", as: "record" }],
    about: 'comment {record_id, body}: a comment on a record (inside a row, {path: "id"}).',
  },
};

/** One of the card actions by name (only the app's own: not "constructor" and the like). */
export const cardAction = (name: unknown): CardAction | undefined =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(CARD_ACTIONS, name)
    ? CARD_ACTIONS[name]
    : undefined;

/** The confirm step's words for an action, its args (and looked-up names) filled in whole. */
export function actionWords(name: string, args: Record<string, unknown>): string {
  const a = cardAction(name);
  if (!a) return name;
  return a.says.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = args[k];
    return v === undefined || v === null ? "" : String(v);
  });
}
