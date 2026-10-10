// Workflows (docs/design/chat-first.md step 5; universal.md §2 "Automation"): when something
// happens to a record (added, a field changed, a date is near), check it, maybe wait, then do
// something (tell someone, set a field, add a record). Definitions are data, never code. The
// plain words people read are made here from the saved definition, so what they read is what
// runs.
import { z } from "zod";
import { FilterInput, SpaceRef, type FilterOp } from "./spaces.ts";

export const WORKFLOW_EVENTS = ["added", "changed", "date"] as const;
export type WorkflowEvent = (typeof WORKFLOW_EVENTS)[number];

export const WorkflowWhenInput = z.object({
  event: z
    .enum(WORKFLOW_EVENTS)
    .describe(
      '"added": a record is added; "changed": a record (or one field) changes; "date": a date field is near',
    ),
  collection: z.string().trim().min(1).max(80).describe("Collection name or id"),
  field: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('"changed": only when this field changes; "date": the date or date-and-time field (required)'),
  offset_minutes: z
    .number()
    .int()
    .min(-525_600)
    .max(525_600)
    .default(0)
    .describe('"date": minutes before (negative) or after (positive) the date, e.g. -1440 for a day before'),
});

export const WorkflowActionInput = z.discriminatedUnion("do", [
  z.object({
    do: z.literal("notify"),
    text: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('What to say; {Field} puts in a value, e.g. "Big expense: {Amount} on {Category}"'),
    to: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(10)
      .default(["me"])
      .describe('"me", or people you know (names or ids)'),
  }),
  z.object({
    do: z.literal("set"),
    field: z.string().trim().min(1).max(80).describe("A field of the record that triggered it"),
    value: z.unknown().describe("The value to set"),
  }),
  z.object({
    do: z.literal("add"),
    collection: z.string().trim().min(1).max(80),
    values: z
      .record(z.string(), z.unknown())
      .describe("Values for the new record; text may use {Field} from the triggering record"),
  }),
]);

export const CreateWorkflowInput = SpaceRef.extend({
  name: z.string().trim().min(1).max(80),
  when: WorkflowWhenInput,
  check: z.array(FilterInput).max(10).default([]).describe("Run only for records matching all of these"),
  wait_minutes: z
    .number()
    .int()
    .min(0)
    .max(43_200)
    .default(0)
    .describe("Wait this long after it happens (at most 30 days); the check runs again then"),
  then: z.array(WorkflowActionInput).min(1).max(5),
  enabled: z
    .boolean()
    .default(false)
    .describe("Assistants always leave it off; the person turns it on from the card"),
});

export const WorkflowRef = SpaceRef.extend({ workflow_id: z.string().trim().min(1).max(40) });
export const SetWorkflowEnabledInput = WorkflowRef.extend({ enabled: z.boolean() });

/** A workflow as saved: names alongside ids, so the words and diagram need nothing else. */
export interface WorkflowView {
  id: string;
  name: string;
  enabled: boolean;
  when: {
    event: WorkflowEvent;
    collection_id: string;
    collection: string;
    field_id: string | null;
    field: string | null;
    offset_minutes: number;
  };
  check: { field_id: string; field: string; op: FilterOp; value: unknown; shown?: string }[];
  wait_minutes: number;
  then: (
    | { do: "notify"; text: string; to: { user_id: string; name: string }[] }
    | { do: "set"; field_id: string; field: string; value: unknown }
    | { do: "add"; collection_id: string; collection: string; values: Record<string, unknown> }
  )[];
  /** The same definition in plain words, one line per part. */
  words: string[];
  runs: number;
  last_run_at: string | null;
  created_at: string;
}

export interface WorkflowRun {
  id: string;
  at: string;
  record_id: string | null;
  record: string | null;
  ok: boolean;
  /** What it did, or why it didn't ("Done is yes, so nothing to do"). */
  detail: string;
}

export interface WorkflowDetail {
  workflow: WorkflowView;
  history: WorkflowRun[];
}

const OP_WORDS: Record<FilterOp, string> = {
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

/** "2 hours", "1 day", "30 minutes". */
export function durationWords(minutes: number): string {
  const m = Math.abs(minutes);
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (m % 1440 === 0) return unit(m / 1440, "day");
  if (m % 60 === 0) return unit(m / 60, "hour");
  return unit(m, "minute");
}

const show = (v: unknown): string =>
  v === true ? "yes" : v === false ? "no" : Array.isArray(v) ? v.map(show).join(", ") : String(v ?? "");

/** The workflow in plain words, from its definition (never from what anyone said). */
export function workflowWords(
  w: Omit<WorkflowView, "words" | "runs" | "last_run_at" | "created_at" | "id" | "enabled" | "name">,
): string[] {
  const out: string[] = [];
  const c = w.when.collection;
  if (w.when.event === "added") out.push(`When a record is added to ${c}`);
  else if (w.when.event === "changed")
    out.push(w.when.field ? `When ${w.when.field} changes in ${c}` : `When a record in ${c} changes`);
  else {
    const off = w.when.offset_minutes;
    out.push(
      off === 0
        ? `At the ${w.when.field} of each record in ${c}`
        : `${durationWords(off)} ${off < 0 ? "before" : "after"} the ${w.when.field} of each record in ${c}`,
    );
  }
  for (const f of w.check)
    out.push(
      `Only if ${f.field} ${OP_WORDS[f.op] ?? f.op}${f.op === "empty" || f.op === "not_empty" ? "" : ` ${f.shown ?? show(f.value)}`}`,
    );
  if (w.wait_minutes) out.push(`Wait ${durationWords(w.wait_minutes)}, then check again`);
  for (const a of w.then) {
    if (a.do === "notify") out.push(`Tell ${a.to.map((p) => p.name).join(", ")}: “${a.text}”`);
    else if (a.do === "set") out.push(`Set ${a.field} to ${show(a.value)}`);
    else
      out.push(
        `Add a record to ${a.collection}${
          Object.keys(a.values).length
            ? ` (${Object.entries(a.values)
                .map(([k, v]) => `${k}: ${show(v)}`)
                .join(", ")})`
            : ""
        }`,
      );
  }
  return out;
}
