// Workflows (docs/design/chat-first.md step 5; universal.md §2 "Automation"): when something
// happens to a record (added, a field changed, a date is near), check it, maybe wait, then do
// something (tell someone, set a field, add a record). Definitions are data, never code. The
// plain words people read are made here from the saved definition, so what they read is what
// runs.
//
// Processes (home-first.md §2 point 9) are workflows with steps that belong to people: an
// "ask" step waits for the people asked to answer (nudging them after a while), keeps the
// answer on the record, and only then goes on; a "repeat" step loops back while a condition
// holds. Same engine, plus "who" and "waiting on".
import { z } from "zod";
import { FilterInput, SpaceRef, type FilterOp, type SharedWithMe } from "./spaces.ts";

export const WORKFLOW_EVENTS = ["added", "changed", "date", "schedule"] as const;
export type WorkflowEvent = (typeof WORKFLOW_EVENTS)[number];

/** Schedules (decision 2026-10-13 "Flows on a schedule, over many records, with branches"). */
export const SCHEDULE_EVERY = ["day", "week", "month"] as const;
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WorkflowWhenInput = z.object({
  event: z
    .enum(WORKFLOW_EVENTS)
    .describe(
      '"added": a record is added; "changed": a record (or one field) changes; "date": a date field is near; "schedule": every day, week or month at a time',
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
  every: z.enum(SCHEDULE_EVERY).optional().describe('"schedule": how often'),
  days: z
    .array(z.enum(WEEKDAYS))
    .min(1)
    .max(7)
    .optional()
    .describe('"schedule" every week: which days, e.g. ["fri"]'),
  day_of_month: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe('"schedule" every month: the day (31 means the last day of each month)'),
  at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like 18:00")
    .optional()
    .describe('"schedule": the time, India time, e.g. "18:00" (default 09:00)'),
});

const NotifyAction = z.object({
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
    .describe(
      '"me", people you know (names or ids), {Field} for the person in that person field of the record, or {Link.Field} for the people in a person field of linked records (e.g. {Lineup.Player})',
    ),
});
const SetAction = z.object({
  do: z.literal("set"),
  field: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("A field of the record that triggered it (or, with via, of the linked records)"),
  value: z.unknown().describe("The value to set"),
  via: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .optional()
    .describe('Set it on linked records instead: a link field, or a list that links here (e.g. "Events")'),
  where: z
    .array(FilterInput)
    .max(5)
    .optional()
    .describe("With via: only the linked records matching all of these"),
});
const AddAction = z.object({
  do: z.literal("add"),
  collection: z.string().trim().min(1).max(80),
  values: z
    .record(z.string(), z.unknown())
    .describe("Values for the new record; text may use {Field} from the triggering record"),
});
/** Count or total a list's records (those matching `where`), maybe broken down by a field. */
const SummaryAction = z.object({
  do: z.literal("summary"),
  collection: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("The list to look at (default: the workflow's list)"),
  where: z
    .array(FilterInput)
    .max(5)
    .default([])
    .describe("Only records matching these, e.g. Date period this_week"),
  sum: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("A number or money field to add up (left out: count the records)"),
  by: z.string().trim().min(1).max(80).optional().describe("A field to break it down by, e.g. Category"),
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9]{0,23}$/, "one word, e.g. Week")
    .default("Summary")
    .describe("Later messages use {Name.total}, {Name.count} and {Name.by}, e.g. {Summary.total}"),
});
/** The same steps for every matching record (at most 200 at a time). */
const ForEachAction = z.object({
  do: z.literal("for_each"),
  collection: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("The list to go through (default: the workflow's list)"),
  where: z.array(FilterInput).min(1).max(5).describe("Which records, e.g. Paid is no and Date period past"),
  then: z
    .array(z.discriminatedUnion("do", [NotifyAction, SetAction, AddAction]))
    .min(1)
    .max(3)
    .describe("What to do for each; {Field} is that record's value"),
});
/**
 * "If this, else that": the record's fields (or a summary made earlier, e.g. Week.total)
 * decide which steps run.
 */
const IfAction = z.object({
  do: z.literal("if"),
  if: z
    .array(FilterInput)
    .min(1)
    .max(5)
    .describe(
      'All of these must hold: the record\'s fields, or a summary made in an earlier step ("Week.total", "Week.count") compared with a number',
    ),
  then: z
    .array(z.discriminatedUnion("do", [NotifyAction, SetAction, AddAction]))
    .min(1)
    .max(3)
    .describe("What to do when it holds"),
  else: z
    .array(z.discriminatedUnion("do", [NotifyAction, SetAction, AddAction]))
    .max(3)
    .default([])
    .describe("What to do otherwise (may be empty)"),
});
export const WorkflowActionInput = z.discriminatedUnion("do", [
  NotifyAction,
  SetAction,
  AddAction,
  SummaryAction,
  ForEachAction,
  IfAction,
  z.object({
    do: z.literal("ask"),
    who: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(10)
      .describe(
        'Who to ask: "me", people you know (names or ids), {Field} for the person in that field of the record, or {Link.Field} for the people in a person field of linked records',
      ),
    text: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe('The question; {Field} puts in a value, e.g. "Can you play {Title} on {Date}?"'),
    choices: z
      .array(z.string().trim().min(1).max(40))
      .min(2)
      .max(6)
      .optional()
      .describe('Answers to tap, e.g. ["Yes", "No"]; left out, they write an answer'),
    save_to: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe(
        "A text or choice field of the record that keeps the answer, so later steps and checks can use it",
      ),
    nudge_minutes: z
      .number()
      .int()
      .min(5)
      .max(43_200)
      .optional()
      .describe("Ask again every so long while there's no answer (at most 30 days apart)"),
    until: z
      .enum(["all", "first"])
      .default("all")
      .describe('"all": go on once everyone asked has answered; "first": once anyone has'),
  }),
  z.object({
    do: z.literal("repeat"),
    if: z.array(FilterInput).min(1).max(5).describe("Go back while the record matches all of these"),
    from: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("The step to go back to (1 is the first step after the check)"),
    at_most: z.number().int().min(1).max(20).default(3).describe("How many times at most"),
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
  then: z.array(WorkflowActionInput).min(1).max(6),
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
    /** "schedule": how often and when (India time). */
    schedule?: WorkflowSchedule;
  };
  check: { field_id: string; field: string; op: FilterOp; value: unknown; shown?: string }[];
  wait_minutes: number;
  then: (
    | SimpleStepView
    | {
        do: "ask";
        text: string;
        choices: string[] | null;
        who: { user_id: string; name: string }[];
        save_to_id: string | null;
        save_to: string | null;
        nudge_minutes: number | null;
        until: "all" | "first";
      }
    | {
        do: "repeat";
        if: CondView[];
        from: number;
        at_most: number;
      }
    | {
        do: "summary";
        collection_id: string;
        collection: string;
        where: CondView[];
        sum_id: string | null;
        sum: string | null;
        by_id: string | null;
        by: string | null;
        name: string;
      }
    | { do: "for_each"; collection_id: string; collection: string; where: CondView[]; then: SimpleStepView[] }
    | { do: "if"; if: CondView[]; then: SimpleStepView[]; else: SimpleStepView[] }
  )[];
  /** The same definition in plain words, one line per part. */
  words: string[];
  runs: number;
  last_run_at: string | null;
  created_at: string;
}

/** When a scheduled workflow runs (India time). */
export interface WorkflowSchedule {
  every: (typeof SCHEDULE_EVERY)[number];
  /** every week: the days. */
  days: Weekday[];
  /** every month: the day (31: the last day). */
  day_of_month: number | null;
  /** "HH:MM". */
  at: string;
}
/** A condition: a field, or a summary from an earlier step ("Week.total", field_id ""). */
export type CondView = { field_id: string; field: string; op: FilterOp; value: unknown; shown?: string };
/** Steps that need nothing but a record (also the steps inside "for each"). */
export type SimpleStepView =
  | { do: "notify"; text: string; to: { user_id: string; name: string }[] }
  | {
      do: "set";
      field_id: string;
      field: string;
      value: unknown;
      /** Set on the records linked through this (a link field, or a list linking here). */
      via?: string;
      where?: { field_id: string; field: string; op: FilterOp; value: unknown; shown?: string }[];
    }
  | { do: "add"; collection_id: string; collection: string; values: Record<string, unknown> };

export interface WorkflowRun {
  id: string;
  at: string;
  record_id: string | null;
  record: string | null;
  ok: boolean;
  /** What it did, or why it didn't ("Done is yes, so nothing to do"). */
  detail: string;
}

/** A process step waiting on people's answers (home-first.md §2 point 9). */
export interface WaitingItem {
  id: string;
  /** The space the process lives in (load it and act on it there). */
  space_id: string;
  workflow_id: string;
  workflow: string;
  record_id: string;
  record: string;
  /** The question as asked (fields filled in). */
  text: string;
  choices: string[] | null;
  /** Everyone asked, with their answer so far. */
  on: { user_id: string; name: string; answer: string | null }[];
  asked_at: string;
  nudges: number;
  next_nudge_at: string | null;
  /** The share to answer through, when I'm one of the people asked. */
  share_id: string | null;
  /** My answer so far, when I'm asked. */
  mine: string | null;
}

export interface WorkflowDetail {
  workflow: WorkflowView;
  history: WorkflowRun[];
  waiting: WaitingItem[];
}

/** Someone in a rehearsal: who they are to the space, and what's in their hands right now. */
export interface PracticePerson {
  user_id: string;
  name: string;
  /** "member": in the space (sees all of it); "shared": sees only what's shared with them. */
  role: "member" | "shared";
  /** Questions waiting on them now. */
  waiting: number;
  /** Messages and questions they've had in this rehearsal. */
  got: number;
}

/** What one person sees in a rehearsal: what's shared with them, and what they've had. */
export interface PracticeAsView {
  person: PracticePerson;
  cards: SharedWithMe[];
  /** Newest first. */
  got: PracticeView["log"];
}

export const WaitRef = SpaceRef.extend({ wait_id: z.string().trim().min(1).max(40) });

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
  if (w.when.event === "schedule" && w.when.schedule) out.push(scheduleWords(w.when.schedule));
  else if (w.when.event === "added") out.push(`When a record is added to ${c}`);
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
  const cond = (f: { field: string; op: FilterOp; value: unknown; shown?: string }) =>
    `${f.field} ${OP_WORDS[f.op] ?? f.op}${f.op === "empty" || f.op === "not_empty" ? "" : ` ${f.shown ?? show(f.value)}`}`;
  for (const a of w.then) {
    if (a.do === "summary") {
      const where = a.where.map(cond).join(" and ");
      out.push(
        `${a.sum ? `Total ${a.sum} of` : "Count"} ${a.collection}${where ? ` where ${where}` : ""}${a.by ? `, by ${a.by}` : ""} (as {${a.name}})`,
      );
      continue;
    }
    if (a.do === "for_each") {
      out.push(
        `For each record in ${a.collection} where ${a.where.map(cond).join(" and ")}: ${a.then.map(simpleWords).join("; ")}`,
      );
      continue;
    }
    if (a.do === "if") {
      out.push(
        `If ${a.if.map(cond).join(" and ")}: ${a.then.map(simpleWords).join("; ")}${
          a.else.length ? `. Otherwise: ${a.else.map(simpleWords).join("; ")}` : ""
        }`,
      );
      continue;
    }
    if (a.do === "notify" || a.do === "set" || a.do === "add") {
      out.push(simpleWords(a));
      continue;
    }
    if (a.do === "ask") {
      const who = a.who.map((p) => p.name).join(", ");
      const parts = [
        `Ask ${who}: “${a.text}”${a.choices ? ` (${a.choices.join(" / ")})` : ""}`,
        a.who.length > 1 || a.until === "first"
          ? a.until === "first"
            ? "wait for the first answer"
            : "wait for everyone's answer"
          : "wait for the answer",
      ];
      if (a.nudge_minutes) parts.push(`nudge every ${durationWords(a.nudge_minutes)}`);
      if (a.save_to) parts.push(`keep it in ${a.save_to}`);
      out.push(parts.join(", "));
    } else if (a.do === "repeat")
      out.push(
        `Go back to step ${a.from} while ${a.if.map(cond).join(" and ")} (at most ${a.at_most} time${a.at_most === 1 ? "" : "s"})`,
      );
  }
  return out;
}

const DAY_NAMES: Record<Weekday, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
/** "9 am", "6:30 pm". */
export function clockWords(hhmm: string): string {
  const [h = 9, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
/** "Every Friday at 6 pm", "On the 1st of every month at 9 am". */
export function scheduleWords(s: WorkflowSchedule): string {
  const at = `at ${clockWords(s.at)}`;
  if (s.every === "day") return `Every day ${at}`;
  if (s.every === "week") {
    const days = WEEKDAYS.filter((d) => s.days.includes(d)).map((d) => DAY_NAMES[d]);
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : (days[0] ?? "week");
    return `Every ${list} ${at}`;
  }
  return s.day_of_month === 31 || s.day_of_month === null
    ? `On the last day of every month ${at}`
    : `On the ${ordinal(s.day_of_month)} of every month ${at}`;
}

/** A notify, set or add step in words (also inside "for each"). */
function simpleWords(a: SimpleStepView): string {
  if (a.do === "notify") return `Tell ${a.to.map((p) => p.name).join(", ")}: “${a.text}”`;
  if (a.do === "set" && a.via) {
    const only = (a.where ?? []).map(condWords).join(" and ");
    return `Set ${a.field} to ${show(a.value)} on its ${a.via}${only ? ` where ${only}` : ""}`;
  }
  if (a.do === "set") return `Set ${a.field} to ${show(a.value)}`;
  return `Add a record to ${a.collection}${
    Object.keys(a.values).length
      ? ` (${Object.entries(a.values)
          .map(([k, v]) => `${k}: ${show(v)}`)
          .join(", ")})`
      : ""
  }`;
}
const condWords = (f: { field: string; op: FilterOp; value: unknown; shown?: string }) =>
  `${f.field} ${OP_WORDS[f.op] ?? f.op}${f.op === "empty" || f.op === "not_empty" ? "" : ` ${f.shown ?? show(f.value)}`}`;

/** The next time (ms) a schedule runs after `after` (ms), India time. */
export function nextScheduleTime(s: WorkflowSchedule, after: number): number {
  const IST = 330 * 60_000;
  const [h = 9, m = 0] = s.at.split(":").map(Number);
  // Walk day by day (at most ~2 months) from the India-time day of `after`.
  const start = new Date(after + IST);
  for (let i = 0; i < 62; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const when = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - IST;
    if (when <= after) continue;
    if (s.every === "day") return when;
    if (s.every === "week" && s.days.includes(WEEKDAYS[d.getUTCDay()]!)) return when;
    if (s.every === "month") {
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const want = Math.min(s.day_of_month ?? 31, last);
      if (d.getUTCDate() === want) return when;
    }
  }
  return after + 86_400_000;
}

/**
 * Rehearse a workflow (decision 2026-10-16 "Rehearse a workflow"): run it on one record with
 * nothing kept and nobody told, to see each step in plain words. At a question it stops,
 * showing what would be asked; give each person's answer for that step (1-based; `time` is
 * which time the run reaches it, when a "repeat" goes back) and it goes on as if they had.
 */
export const RehearseWorkflowInput = WorkflowRef.extend({
  /** The record to try it on (an id); left out, the list's newest. */
  record_id: z.string().trim().min(1).max(40).optional(),
  answers: z
    .array(
      z.object({
        step: z.number().int().min(1).max(50),
        /** Which time the run reaches this step (a "repeat" can go back to it). */
        time: z.number().int().min(1).max(20).default(1),
        /** Who answers, by name; left out, the next person not yet answered. */
        person: z.string().trim().min(1).max(80).optional(),
        answer: z.string().trim().min(1).max(200),
      }),
    )
    .max(50)
    .default([]),
});

/** One person's answer in a rehearsal (RehearseWorkflowInput's answers, once read). */
export interface RehearsalAnswer {
  step: number;
  time: number;
  person?: string | undefined;
  answer: string;
}

export interface Rehearsal {
  workflow: string;
  /** The record it was tried on (null for a scheduled workflow). */
  record: { id: string; title: string } | null;
  /** What each step would do, in order ("Told Asha: “…”", "Set Status"). */
  lines: string[];
  /** Where it stopped for a question; answer it (by step, time and person) to go on. */
  waiting: {
    step: number;
    time: number;
    question: string;
    choices: string[] | null;
    people: string[];
    /** "all": it goes on once everyone has answered; "first": with the first answer. */
    until: "all" | "first";
    /** The answers given so far, and who to answer as next. */
    answered: { name: string; answer: string }[];
    next: string;
  } | null;
  /** True when it ran to the end. */
  finished: boolean;
}

/**
 * A practice copy of a space (decision 2026-10-16 "Rehearse a workflow", second part): its
 * workflows run for real, but what they'd tell or ask people is kept in this log instead of
 * reaching anyone, and the owner answers questions as each person.
 */
export interface PracticeView {
  space_id: string;
  name: string;
  /** The space it's a copy of. */
  of: string;
  /** Newest first: what each person would have got. */
  log: {
    id: string;
    at: string;
    user_id: string;
    name: string;
    kind: "message" | "question";
    title: string;
    body: string | null;
  }[];
  waiting: WaitingItem[];
  /** The people this space plays with: its other members and everyone something is shared with. */
  people: PracticePerson[];
}

export const PracticeStartInput = SpaceRef;
/** A rehearsal, as one of its people. */
export const PracticeAsInput = SpaceRef.extend({ user_id: z.string().trim().min(1).max(64) });
export const PracticeAsShareInput = PracticeAsInput.extend({
  share_id: z.string().trim().min(1).max(40),
  cursor: z.string().max(200).optional(),
});
export const PracticeAsUpdateInput = PracticeAsShareInput.extend({
  record_id: z.string().trim().min(1).max(40),
  values: z.record(z.string(), z.unknown()),
});
export const PracticeAsAnswerInput = PracticeAsShareInput.extend({
  answer: z.string().trim().min(1).max(200),
});
export const PracticeAnswerInput = SpaceRef.extend({
  wait_id: z.string().trim().min(1).max(40),
  /** The person to answer as (one of those asked). */
  as_user_id: z.string().trim().min(1).max(64),
  answer: z.string().trim().min(1).max(200),
});
