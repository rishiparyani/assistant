// A2UI cards (decision 2026-10-18 "Try A2UI"): the catalogue, the card the assistant writes
// (parts + data), the messages it becomes, a check in words, and the assistant's guide.
import { Catalog, MessageProcessor, getKnownSchemaKeys } from "@a2ui/web_core";
import {
  A2UI_CATALOG,
  A2UI_VERSION,
  CARD_ACTIONS,
  FUNCTIONS,
  FUNCTION_DOCS,
  PART_APIS,
  cardAction,
} from "./catalog.ts";

export * from "./catalog.ts";

/** One part of a card: an id, its kind, and its properties. */
export type A2Part = { id: string; component: string } & Record<string, unknown>;

/** What the assistant writes: the parts (one with id "root") and the data they bind to. */
export interface A2Card {
  title?: string;
  parts: A2Part[];
  data?: Record<string, unknown>;
}

export const MAX_PARTS = 120;
/** Inputs and the property each writes: it must be bound to a path. */
export const INPUTS: Record<string, string> = {
  Picker: "value",
  Chips: "value",
  Slider: "value",
  Switch: "value",
  Radio: "value",
  Field: "value",
  CheckRow: "checked",
  Segmented: "value",
  Search: "value",
  Stepper: "value",
  Stars: "value",
  DateField: "value",
};
const MAX_DATA_CHARS = 60_000;

/** The catalogue A2UI's core checks cards against (parts + functions). */
export function makeCatalog<P extends { name: string; schema: unknown }>(parts?: P[]) {
  return new Catalog(A2UI_CATALOG, A2UI_VERSION, (parts ?? PART_APIS) as never[], FUNCTIONS as never[]);
}

/** A card as A2UI messages: the surface, then the parts (one by one, so they can stream), then the data. */
export function cardMessages(card: A2Card, surfaceId: string, oneByOne = false): object[] {
  const v = A2UI_VERSION;
  const parts = card.parts.map((p) => ({ ...p }));
  return [
    { version: v, createSurface: { surfaceId, catalogId: A2UI_CATALOG } },
    ...(oneByOne
      ? parts.map((c) => ({ version: v, updateComponents: { surfaceId, components: [c] } }))
      : [{ version: v, updateComponents: { surfaceId, components: parts } }]),
    // A copy: the core changes its data in place, and the card it came from must stay as written.
    ...(card.data
      ? [
          {
            version: v,
            updateDataModel: {
              surfaceId,
              path: "/",
              value: JSON.parse(JSON.stringify(card.data)) as unknown,
            },
          },
        ]
      : []),
  ];
}

const childIds = (p: A2Part): string[] => {
  const out: string[] = [];
  const c = p.children;
  if (Array.isArray(c)) out.push(...c.filter((x): x is string => typeof x === "string"));
  else if (c && typeof c === "object" && typeof (c as { componentId?: unknown }).componentId === "string")
    out.push((c as { componentId: string }).componentId);
  if (Array.isArray(p.tabs))
    for (const t of p.tabs)
      if (t && typeof (t as { child?: unknown }).child === "string") out.push((t as { child: string }).child);
  return out;
};

/**
 * What's wrong with a card, in words the assistant can act on ([] = fine): unknown parts or
 * properties, missing children, no root, too big, and anything A2UI's core refuses.
 */
export function cardProblems(card: A2Card): string[] {
  const out: string[] = [];
  if (!card || !Array.isArray(card.parts)) return ["parts must be a list"];
  if (card.parts.length > MAX_PARTS)
    out.push(`A card has at most ${MAX_PARTS} parts (this has ${card.parts.length})`);
  if (card.data && JSON.stringify(card.data).length > MAX_DATA_CHARS) out.push("The card's data is too big");
  const byId = new Map<string, A2Part>();
  for (const p of card.parts) {
    if (!p || typeof p.id !== "string" || typeof p.component !== "string") {
      out.push("Every part needs an id and a component");
      continue;
    }
    if (byId.has(p.id)) out.push(`Two parts have the id "${p.id}"`);
    byId.set(p.id, p);
    const api = PART_APIS.find((a) => a.name === p.component);
    if (!api) {
      out.push(`"${p.component}" isn't a part (parts: ${PART_APIS.map((a) => a.name).join(", ")})`);
      continue;
    }
    const known = getKnownSchemaKeys(api.schema as never);
    for (const k of Object.keys(p))
      if (k !== "id" && k !== "component" && known && !known.has(k))
        out.push(`${p.component} "${p.id}" has no property "${k}" (it takes ${[...known].join(", ")})`);
  }
  if (!byId.has("root")) out.push('One part must have the id "root"');
  // An input writes into the data at its path: given a literal it couldn't change anything.
  for (const p of byId.values()) {
    const prop = INPUTS[p.component];
    const v = prop ? p[prop] : undefined;
    if (prop && !(v && typeof v === "object" && typeof (v as { path?: unknown }).path === "string"))
      out.push(
        `${p.component} "${p.id}": ${prop} must be {path: "..."} into the data, so the person's choice is kept`,
      );
  }
  // Deleting a record takes two taps: removeItem only on a Button that asks first.
  for (const p of byId.values()) {
    const a = (p as { action?: { functionCall?: { call?: unknown } } }).action;
    if (
      a?.functionCall?.call === "removeItem" &&
      !(p.component === "Button" && typeof p.confirm === "string" && p.confirm)
    )
      out.push(`${p.component} "${p.id}": removeItem only on a Button with confirm (deleting asks first)`);
  }
  // A button that asks the app to act names one of its actions, with what that action needs.
  for (const p of byId.values()) {
    const ev = (p as { action?: { event?: { name?: unknown; context?: Record<string, unknown> } } }).action
      ?.event;
    if (!ev) continue;
    const a = cardAction(ev.name);
    if (!a) {
      out.push(
        `${p.component} "${p.id}": the action "${String(ev.name)}" isn't one (actions: ${Object.keys(CARD_ACTIONS).join(", ")})`,
      );
      continue;
    }
    const missing = a.needs.filter((k) => ev.context?.[k] === undefined || ev.context?.[k] === "");
    if (missing.length)
      out.push(`${p.component} "${p.id}": ${String(ev.name)} needs ${missing.join(", ")} in its context`);
  }
  // Every function a part calls must exist (the core only finds out when it runs).
  const names = new Set(FUNCTION_DOCS.map((f) => f.name));
  const calls = (v: unknown, at: string): void => {
    if (Array.isArray(v)) return v.forEach((x) => calls(x, at));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.call === "string" && !names.has(o.call))
      out.push(`"${at}" calls "${o.call}", which isn't a function (functions: ${[...names].join(", ")})`);
    for (const x of Object.values(o)) calls(x, at);
  };
  for (const p of byId.values()) calls(p, p.id);
  for (const p of byId.values())
    for (const c of childIds(p))
      if (!byId.has(c)) out.push(`"${p.id}" names a child "${c}" that isn't in the card`);
  if (out.length) return out;
  // The core's own checks: each part's properties, references, cycles, functions.
  try {
    const processor = new MessageProcessor([makeCatalog()]);
    processor.processMessages(cardMessages(card, "check") as never);
    const surface = processor.model.surfacesMap.get("check");
    const cycles = surface?.componentsModel.detectCycles?.({ rootId: "root" });
    if (Array.isArray(cycles) && cycles.length) out.push("Parts can't contain themselves");
  } catch (e) {
    out.push(e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400));
  }
  return out;
}

/** The assistant's guide to cards: every part and function in a line, the rules, one example. */
export function cardGuide(): string {
  const parts = PART_APIS.map((a) => {
    const keys = getKnownSchemaKeys(a.schema as never);
    return `- ${a.name}: ${a.about} Props: ${[...(keys ?? [])].filter((k) => k !== "visible").join(", ")}.`;
  }).join("\n");
  const fns = FUNCTION_DOCS.map((f) => `- ${f.about}`).join("\n");
  return [
    'A card is {title, parts, data}. parts is a flat list of {id, component, ...props}; one part has id "root" (usually a Card). Containers name their children by id (children: ["a", "b"]), or repeat one part for each item of a list in the data: children: {componentId: "row", path: "/items"} (inside the repeated part, paths without a leading "/" are the item\'s own fields, e.g. {path: "title"}).',
    'Props take a literal, {path: "/x"} (the card\'s data; inputs write back to it, so a Picker bound to /period changes everything that reads /period), or {call: "fn", args: {...}} (args may themselves be paths or calls). Money is in paise (₹1,500 = 150000). Every part takes visible (yes/no, often a call).',
    "Parts:\n" + parts,
    "Functions:\n" + fns,
    "Actions (a Button asks the app to do one with {event: {name, context: {...args}}}; args may be paths; the person always confirms first):\n" +
      Object.values(CARD_ACTIONS)
        .map((a) => `- ${a.about}`)
        .join("\n"),
    'Buttons and rows act with {functionCall: {call: "set", args: {path, value}}} (or toggle, select) on the card itself.',
    'On a list filled from the person\'s list (sources), changing an item\'s field saves to that record; to add one, give Fields bound to a draft ({path: "/draft/Title"}, field names as in the list) and a Button {functionCall: {call: "addItem", args: {to: "/items", from: "/draft"}}}; to delete one, a Button in its row with confirm and {functionCall: {call: "removeItem", args: {}}}. One row at a time.',
    "Design like a polished phone app, not a plain list: open with a Hero (the headline figure, its change against before and a trend) or a Countdown; put 2 or 3 Tiles or Stats in a Grid; give the Card an icon (one emoji) and, when it suits, a colour; pick the chart that fits (PieChart for shares, ColumnChart for months or categories over time, LineChart for a running trend, Heatmap for days, BarChart for a ranking, ProgressRing or Progress with current and target for a goal or budget); show records as a Table, a Timeline, a Board or rows with icons, initials or date tiles; put more than three sections in Tabs or Accordions. Choices (Segmented, Search, Chips, Stepper, Stars, DateField) are bound to paths, and everything that depends on them reads those paths.",
    "Answers that are small tools (chats-home.md 6): a spending answer can be a BarChart of groupSum with selected bound to a path, and a Table filtered on that path (the tapped category's biggest few); a bill to split can be Chips of who shared (bound to a list), a Segmented tip, and a Stat of each share (the total with tip, divided by size of the picked list), with a Button to add it to the person's expenses.",
    'Example: {"title":"Savings","parts":[{"id":"root","component":"Card","title":"Savings plan","icon":"🌱","colour":"green","children":["monthly","hero","ring"]},{"id":"monthly","component":"Slider","label":"Each month","value":{"path":"/monthly"},"min":100000,"max":5000000,"step":50000,"format":"money"},{"id":"hero","component":"Hero","label":"In two years","format":"money","colour":"green","value":{"call":"max","args":{"list":{"call":"growth","args":{"start":0,"monthly":{"path":"/monthly"},"yearlyRatePercent":7,"months":24}},"field":"value"}},"trend":{"call":"growth","args":{"start":0,"monthly":{"path":"/monthly"},"yearlyRatePercent":7,"months":24}},"trendField":"value"},{"id":"ring","component":"ProgressRing","label":"Of the goal","colour":"green","value":{"call":"divide","args":{"a":{"call":"multiply","args":{"a":{"path":"/monthly"},"b":24}},"b":{"path":"/goal"}}}}],"data":{"monthly":1000000,"goal":30000000}}',
  ].join("\n\n");
}
export * from "./demos.ts";
