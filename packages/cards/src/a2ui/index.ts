// A2UI cards (decision 2026-10-18 "Try A2UI"): the catalogue, the card the assistant writes
// (parts + data), the messages it becomes, a check in words, and the assistant's guide.
import { Catalog, MessageProcessor, getKnownSchemaKeys } from "@a2ui/web_core";
import { A2UI_CATALOG, A2UI_VERSION, FUNCTIONS, FUNCTION_DOCS, PART_APIS } from "./catalog.ts";

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
    ...(card.data ? [{ version: v, updateDataModel: { surfaceId, path: "/", value: card.data } }] : []),
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
    'Buttons and rows act with {functionCall: {call: "set", args: {path, value}}} (or toggle, select) on the card itself.',
    'Example: {"title":"Savings","parts":[{"id":"root","component":"Card","title":"Savings plan","children":["monthly","total","chart"]},{"id":"monthly","component":"Slider","label":"Each month","value":{"path":"/monthly"},"min":100000,"max":5000000,"step":50000,"format":"money"},{"id":"total","component":"Stat","label":"In a year","format":"money","value":{"call":"multiply","args":{"a":{"path":"/monthly"},"b":12}}},{"id":"chart","component":"LineChart","format":"money","points":[],"data":{"call":"growth","args":{"start":0,"monthly":{"path":"/monthly"},"yearlyRatePercent":7,"months":12}},"labelField":"label","valueField":"value"}],"data":{"monthly":1000000}}',
  ].join("\n\n");
}
export * from "./demos.ts";
