// Rules on a collection (universal.md §2 "Check" and "Status flow"; chat-first step 6):
// checks a record must pass to be saved, uniqueness ("only one Selected per Song and
// Instrument"), and status flows (which moves a choice field may make). Data, never code;
// the words people read come from the saved rule.
import { z } from "zod";
import { CollectionRef, FilterInput, SpaceRef, type FilterOp, type RuleFilter } from "./spaces.ts";

export const RULE_KINDS = ["check", "unique", "flow"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const AddRuleInput = CollectionRef.extend({
  kind: z
    .enum(RULE_KINDS)
    .describe(
      '"check": records must meet `require`; "unique": no two records share `fields`; "flow": allowed `moves` of a choice field',
    ),
  require: z
    .array(FilterInput)
    .max(5)
    .optional()
    .describe("check: what every record (or those matching only_if) must meet, e.g. Amount gt 0"),
  fields: z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(3)
    .optional()
    .describe("unique: the fields that together may not repeat, e.g. Song and Instrument"),
  at_most: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .optional()
    .describe("unique: allow up to this many per those fields instead of one (e.g. 3 guests per Host)"),
  of: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("unique with at_most: add up this number field instead of counting records (e.g. Heads)"),
  only_if: z
    .array(FilterInput)
    .max(5)
    .optional()
    .describe("check or unique: apply only to records matching these, e.g. Status is Selected"),
  field: z.string().trim().min(1).max(80).optional().describe("flow: the choice field"),
  moves: z
    .record(z.string(), z.array(z.string()).max(20))
    .optional()
    .describe(
      'flow: from each value, the values it may change to, e.g. {"Requested": ["Selected", "Not this time"]}',
    ),
  message: z.string().trim().max(200).optional().describe("What people see when the rule stops a change"),
});

export const RuleRef = SpaceRef.extend({ rule_id: z.string().trim().min(1).max(40) });

export interface RuleView {
  id: string;
  kind: RuleKind;
  collection_id: string;
  collection: string;
  require: { field_id: string; field: string; op: FilterOp; value: RuleFilter["value"] | null }[];
  fields: { id: string; name: string }[];
  /** unique: how many may share the fields (1: only one), and the number field added up, if any. */
  at_most?: number;
  of?: { id: string; name: string } | null;
  only_if: { field_id: string; field: string; op: FilterOp; value: RuleFilter["value"] | null }[];
  field: { id: string; name: string } | null;
  moves: Record<string, string[]>;
  message: string | null;
  /** The rule in plain words. */
  words: string;
  created_at: string;
}

const OPS: Record<FilterOp, string> = {
  eq: "is",
  ne: "isn't",
  lt: "is less than",
  lte: "is at most",
  gt: "is more than",
  gte: "is at least",
  in: "is one of",
  contains: "contains",
  empty: "is empty",
  not_empty: "isn't empty",
  period: "is in",
};
const show = (v: unknown): string =>
  v === true ? "yes" : v === false ? "no" : Array.isArray(v) ? v.map(show).join(", ") : String(v ?? "");
const cond = (f: { field: string; op: FilterOp; value: unknown }) =>
  `${f.field} ${OPS[f.op] ?? f.op}${f.op === "empty" || f.op === "not_empty" ? "" : ` ${show(f.value)}`}`;

/** The rule in plain words, from its definition. */
export function ruleWords(
  r: Omit<RuleView, "words" | "id" | "created_at" | "collection_id" | "message">,
): string {
  const where = r.only_if.length ? ` when ${r.only_if.map(cond).join(" and ")}` : "";
  if (r.kind === "check") return `In ${r.collection}${where}: ${r.require.map(cond).join(" and ")}`;
  if (r.kind === "unique") {
    const per = r.fields.map((f) => f.name).join(" and ");
    if (r.of) return `In ${r.collection}, at most ${r.at_most ?? 1} ${r.of.name} in all${where} per ${per}`;
    if ((r.at_most ?? 1) > 1) return `In ${r.collection}, at most ${r.at_most} records${where} per ${per}`;
    return `In ${r.collection}, only one record${where} per ${per}`;
  }
  const moves = Object.entries(r.moves)
    .map(([from, to]) => `${from} → ${to.length ? to.join(" or ") : "nothing"}`)
    .join("; ");
  return `${r.field?.name ?? "?"} in ${r.collection} moves only ${moves}`;
}
