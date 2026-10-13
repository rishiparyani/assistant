// Questions about the data (decision 2026-10-13 "Questions, not SQL"): the assistant fills in
// a short question by names (which list, which filters, group by what, count or add up what),
// and the space's engine checks every name, runs it as the person asking and returns a small
// table that's exact. No SQL, no code: the engine writes its own query from checked parts.
import { z } from "zod";
import {
  FilterInput,
  MAX_QUERY_ROWS,
  QueryMeasure,
  QueryPath,
  SpaceRef,
  type FilterOp,
  type QueryFn,
} from "./spaces.ts";

export const QuerySpec = z.object({
  from: z.string().trim().min(1).max(80).describe("The list (collection) to ask about"),
  where: z.array(FilterInput).max(10).default([]).describe("Only records matching all of these"),
  group_by: z.array(QueryPath).max(2).default([]).describe("Break it down by these (one row per value)"),
  measures: z
    .array(QueryMeasure)
    .min(1)
    .max(6)
    .default([{ fn: "count" }])
    .describe("The columns to work out"),
  sort: z
    .object({ by: z.string().trim().min(1).max(160), dir: z.enum(["asc", "desc"]).default("desc") })
    .optional()
    .describe("Order rows by a column name (default: the first number, biggest first)"),
  limit: z.number().int().min(1).max(MAX_QUERY_ROWS).default(50),
  title: z.string().trim().min(1).max(60).optional().describe('A short title, e.g. "Earnings by venue"'),
});
export type QuerySpec = z.infer<typeof QuerySpec>;
export type QuerySpecInput = z.input<typeof QuerySpec>;

export const QueryInput = SpaceRef.extend(QuerySpec.shape);

export type QueryColumnType = "text" | "number" | "money" | "date" | "datetime";
export interface QueryColumn {
  name: string;
  kind: "group" | "measure";
  type: QueryColumnType;
}
export interface QueryResult {
  title: string;
  collection_id: string;
  collection: string;
  columns: QueryColumn[];
  /** Raw values (money in paise, dates as YYYY-MM-DD) and how each reads ("₹4,500"). */
  rows: { cells: (string | number | null)[]; shown: string[] }[];
  /** Rows left out by the limit. */
  more: number;
  /** Records read. */
  scanned: number;
  /** The question in plain words, from the checked parts. */
  words: string;
}

const FN_WORDS: Record<QueryFn, string> = {
  count: "count",
  sum: "total",
  avg: "average",
  min: "lowest",
  max: "highest",
  count_distinct: "different",
};
/** A column's default name: "Count", "Total Fee", "Average Payouts.Amount". */
export function measureName(m: { fn?: QueryFn; field?: string }): string {
  if (!m.fn || m.fn === "count") return m.field ? `Count of ${m.field}` : "Count";
  const w = FN_WORDS[m.fn];
  return `${w[0]!.toUpperCase()}${w.slice(1)} ${m.field ?? ""}`.trim();
}

const OPS: Partial<Record<FilterOp, string>> = {
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
const shown = (v: unknown): string =>
  Array.isArray(v) ? v.map(shown).join(", ") : typeof v === "string" ? v.replace(/_/g, " ") : String(v ?? "");
export const filterWords = (f: { field: string; op: FilterOp; value?: unknown }) =>
  `${f.field} ${OPS[f.op] ?? f.op}${f.op === "empty" || f.op === "not_empty" ? "" : ` ${shown(f.value)}`}`;

/** "Gigs where Date is in this year, by Venue: Earned (total Fee), Kept ({Earned} - {Paid out})". */
export function queryWords(q: {
  from: string;
  where: { field: string; op: FilterOp; value?: unknown }[];
  group_by: string[];
  measures: {
    name: string;
    fn?: QueryFn;
    field?: string;
    calc?: string;
    where?: { field: string; op: FilterOp; value?: unknown }[];
  }[];
}): string {
  const where = q.where.length ? ` where ${q.where.map(filterWords).join(" and ")}` : "";
  const by = q.group_by.length ? `, by ${q.group_by.join(" and ")}` : "";
  const cols = q.measures
    .map((m) => {
      const what = m.calc
        ? m.calc
        : `${m.fn ? FN_WORDS[m.fn] : "count"}${m.field ? ` ${m.field}` : ""}${
            m.where?.length ? ` where ${m.where.map(filterWords).join(" and ")}` : ""
          }`;
      return m.name === measureName(m) ? m.name : `${m.name} (${what})`;
    })
    .join(", ");
  return `${q.from}${where}${by}: ${cols}`;
}
