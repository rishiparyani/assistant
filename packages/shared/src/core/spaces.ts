// The universal engine's shapes (docs/design/universal.md): spaces hold collections with
// typed fields; records keep their values by field id. Values are checked here so the
// server and (later) the device apply the same rules.
import { z } from "zod";
import { clientId, optionalText } from "./fields.ts";
import { isDateOnly, toUtcIso } from "./dates.ts";
import { formatINR, parseINR } from "./money.ts";

export const SPACE_LIMITS = {
  collections: 200,
  fieldsPerCollection: 100,
  choices: 100,
  text: 500,
  longText: 20_000,
  findLimit: 100,
  linksPerField: 500,
  aliases: 10,
} as const;

/** Field types available now (design §2); more arrive with later stages. */
export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "money",
  "date",
  "datetime",
  "boolean",
  "choice",
  "multi_choice",
  "person",
  "link",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const LINK_ON_DELETE = ["unlink", "block", "cascade"] as const;
export type LinkOnDelete = (typeof LINK_ON_DELETE)[number];

/** Field options; only the ones that fit the type are used. */
export interface FieldOptions {
  /** choice / multi_choice: the allowed values, in order. */
  choices?: string[];
  /** link: the collection it points to (id), or null for any record in the space. */
  target?: string | null;
  /** link: more than one record. */
  many?: boolean;
  /** link (many): keep the user's own order. */
  ordered?: boolean;
  /** link: what happens to this link when the linked record is deleted. */
  on_delete?: LinkOnDelete;
}

export interface FieldView {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  required: boolean;
  aliases: string[];
}

export interface CollectionView {
  id: string;
  name: string;
  description: string | null;
  /** The field whose value is the record's title (text). */
  title_field_id: string;
  fields: FieldView[];
  /** Links from other collections that point here (shown as sections on a record). */
  linked_from: { collection_id: string; collection: string; field_id: string; field: string }[];
  updated_at: string;
}

export interface SpaceView {
  id: string;
  name: string;
  kind: "personal" | "shared";
  role: "owner" | "editor" | "viewer";
}

/** A person as stored in a person field: an account in the space, or just a name. */
export interface PersonValue {
  user_id: string | null;
  name: string;
}

export type StoredValue = string | number | boolean | string[] | PersonValue | null;

export interface LinkedRef {
  id: string;
  collection_id: string;
  title: string;
}

export interface RecordView {
  id: string;
  collection_id: string;
  title: string;
  /** Values by field id (links are in `links`). */
  values: Record<string, StoredValue>;
  /** Readable values by field name, for people and assistants ("₹450", "Sat, 12 Dec 2026"). */
  named: Record<string, string | string[] | null>;
  links: Record<string, LinkedRef[]>;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface FindResult {
  items: RecordView[];
  next_cursor: string | null;
}

/** One entry of a space's change log; devices pull everything after their last `seq`. */
export interface ChangeView {
  seq: number;
  at: string;
  kind: "collection" | "record" | "space";
  id: string;
  op: "upsert" | "delete";
}

export interface ChangesView {
  changes: ChangeView[];
  /** The newest seq; pass it back as `since` next time. */
  seq: number;
  /** More changes are waiting (call again with `since` = `seq`). */
  more: boolean;
}

// --- Inputs (operation schemas) --------------------------------------------------------

const name = (what: string) => z.string().trim().min(1).max(80).describe(what);
const nameOrId = (what: string) => z.string().trim().min(1).max(80).describe(`${what} name or id`);

export const SpaceRef = z.object({
  space: nameOrId("Space").optional().describe("Space name or id; leave out for your Personal space"),
});

const choicesSchema = z.array(z.string().trim().min(1).max(80)).max(SPACE_LIMITS.choices);

export const FieldOptionsInput = z
  .object({
    choices: choicesSchema.optional().describe("choice / multi_choice: the allowed values"),
    target: z
      .string()
      .trim()
      .max(80)
      .nullish()
      .describe("link: the collection it points to (name or id); leave out for any record"),
    many: z.boolean().optional().describe("link: allow more than one record"),
    ordered: z.boolean().optional().describe("link: keep a manual order (set lists, run of show)"),
    on_delete: z
      .enum(LINK_ON_DELETE)
      .optional()
      .describe("link: when the linked record is deleted: unlink (default), block, or cascade"),
  })
  .strict();

export const FieldInput = z.object({
  id: clientId,
  name: name("Field name, unique in the collection"),
  type: z.enum(FIELD_TYPES),
  options: FieldOptionsInput.optional(),
  required: z.boolean().optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(SPACE_LIMITS.aliases).optional(),
});

export const CreateCollectionInput = SpaceRef.extend({
  id: clientId,
  name: name("Collection name, unique in the space, e.g. Expenses"),
  description: optionalText(300).describe("What it's for, in a sentence"),
  fields: z
    .array(FieldInput)
    .max(SPACE_LIMITS.fieldsPerCollection)
    .default([])
    .describe("Fields; the first text field is the title (a Title field is added if there is none)"),
});

export const CollectionRef = SpaceRef.extend({ collection: nameOrId("Collection") });

export const AddFieldInput = CollectionRef.extend({ field: FieldInput });

export const UpdateFieldInput = CollectionRef.extend({
  field: nameOrId("Field"),
  name: name("New name").optional(),
  options: FieldOptionsInput.optional(),
  required: z.boolean().optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(SPACE_LIMITS.aliases).optional(),
});

export const RemoveFieldInput = CollectionRef.extend({ field: nameOrId("Field") });

export const UpdateCollectionInput = CollectionRef.extend({
  name: name("New name").optional(),
  description: optionalText(300),
});

/** Values by field name or id. Links: a record id, a title, or a list of them. */
const valuesSchema = z.record(z.string(), z.unknown()).describe("Field values by field name");

export const AddRecordInput = CollectionRef.extend({
  id: clientId,
  values: valuesSchema,
});

export const RecordRef = SpaceRef.extend({ record_id: z.string().trim().min(1).max(40) });

export const UpdateRecordInput = RecordRef.extend({
  values: valuesSchema.describe("Only the fields to change; null clears a field"),
  version: z.number().int().optional().describe("The record's version when it was read (optional)"),
});

export const LinkRecordsInput = RecordRef.extend({
  field: nameOrId("Link field"),
  to: z
    .array(z.string().trim().min(1).max(160))
    .min(1)
    .max(50)
    .describe("Records to link: ids, or titles in the target collection"),
  after: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .describe("Ordered links: put them after this record (null = first)"),
});

export const UnlinkRecordsInput = RecordRef.extend({
  field: nameOrId("Link field"),
  to: z.array(z.string().trim().min(1).max(40)).min(1).max(50).describe("Record ids to unlink"),
});

export const FILTER_OPS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "in",
  "empty",
  "not_empty",
  "period",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const PERIODS = [
  "today",
  "tomorrow",
  "yesterday",
  "this_week",
  "next_week",
  "last_week",
  "this_month",
  "next_month",
  "last_month",
  "next_7_days",
  "last_7_days",
  "next_30_days",
  "last_30_days",
  "past",
  "future",
] as const;
export type Period = (typeof PERIODS)[number];

export const FilterInput = z.object({
  field: z.string().trim().min(1).max(80).describe("Field name or id"),
  op: z.enum(FILTER_OPS),
  value: z
    .unknown()
    .optional()
    .describe(
      'Compared value; for "in" a list; for "period" one of today, this_week, next_7_days, this_month, last_month, past, future…; for a link field a record id; "me" for a person field',
    ),
});
export type Filter = z.infer<typeof FilterInput>;

export const FindRecordsInput = CollectionRef.extend({
  filters: z.array(FilterInput).max(10).default([]),
  search: z.string().trim().max(100).optional().describe("Words that start words of the title"),
  sort: z
    .object({ field: z.string().trim().min(1).max(80), dir: z.enum(["asc", "desc"]).default("asc") })
    .optional()
    .describe("Sort by a field (default: newest first)"),
  limit: z.coerce.number().int().min(1).max(SPACE_LIMITS.findLimit).default(30),
  cursor: z.string().max(400).optional(),
});

export const ChangesInput = SpaceRef.extend({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

// --- Values -------------------------------------------------------------------------------

/** Lower case, single spaces: how names are compared (never fuzzy). */
export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A value that couldn't be stored, with a message for the person or the assistant. */
export class ValueError extends Error {}

/**
 * Turns an input value into what's stored for a field (not links). `null`/`""` clear it.
 * Money accepts "₹50,000", "50000" or a number of rupees; dates "2026-12-12"; date-times
 * "2026-12-12T19:00" (India time) or ISO with an offset.
 */
export function normalizeValue(
  field: Pick<FieldView, "name" | "type" | "options">,
  raw: unknown,
): StoredValue {
  if (raw === null || raw === undefined || raw === "") return null;
  const bad = (what: string) => new ValueError(`${field.name}: ${what}`);
  switch (field.type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string" && typeof raw !== "number") throw bad("expected text");
      const s = String(raw).trim();
      const max = field.type === "text" ? SPACE_LIMITS.text : SPACE_LIMITS.longText;
      if (s.length > max) throw bad(`at most ${max} characters`);
      return s || null;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/,/g, "")) : NaN;
      if (!Number.isFinite(n)) throw bad(`"${String(raw)}" is not a number`);
      return n;
    }
    case "money": {
      try {
        if (typeof raw === "number") return Math.round(raw * 100);
        if (typeof raw === "string") return parseINR(raw);
      } catch {
        /* fall through */
      }
      throw bad(`"${String(raw)}" is not an amount (e.g. 450 or ₹1,200)`);
    }
    case "date": {
      if (typeof raw !== "string" || !isDateOnly(raw.trim())) throw bad("expected a date like 2026-12-12");
      return raw.trim();
    }
    case "datetime": {
      if (typeof raw !== "string") throw bad("expected a date and time like 2026-12-12T19:00");
      try {
        return toUtcIso(raw);
      } catch (e) {
        throw bad((e as Error).message);
      }
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "yes") return true;
      if (raw === "false" || raw === "no") return false;
      throw bad("expected yes or no");
    }
    case "choice": {
      if (typeof raw !== "string") throw bad("expected one of the choices");
      return matchChoice(field, raw);
    }
    case "multi_choice": {
      const list = Array.isArray(raw) ? raw : [raw];
      const out: string[] = [];
      for (const v of list) {
        if (typeof v !== "string") throw bad("expected choices");
        const c = matchChoice(field, v);
        if (!out.includes(c)) out.push(c);
      }
      return out.length ? out : null;
    }
    case "person": {
      if (typeof raw === "string") return { user_id: null, name: raw.trim().slice(0, 120) };
      if (typeof raw === "object" && raw && "name" in raw) {
        const p = raw as { user_id?: unknown; name?: unknown };
        if (typeof p.name !== "string" || !p.name.trim()) throw bad("a person needs a name");
        return {
          user_id: typeof p.user_id === "string" ? p.user_id : null,
          name: p.name.trim().slice(0, 120),
        };
      }
      throw bad("expected a person");
    }
    case "link":
      throw bad("links are set with their own values");
  }
}

function matchChoice(field: Pick<FieldView, "name" | "options">, raw: string): string {
  const choices = field.options.choices ?? [];
  const hit = choices.find((c) => nameKey(c) === nameKey(raw));
  if (!hit)
    throw new ValueError(`${field.name}: "${raw}" isn't a choice (choices: ${choices.join(", ") || "none"})`);
  return hit;
}

/** How a stored value reads for people ("₹450", "Sat, 12 Dec 2026"). */
export function displayValue(type: FieldType, v: StoredValue): string | string[] | null {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "money":
      return formatINR(v as number);
    case "boolean":
      return v ? "Yes" : "No";
    case "person":
      return (v as PersonValue).name;
    case "multi_choice":
      return v as string[];
    default:
      return String(v);
  }
}

// --- Periods (India time) -------------------------------------------------------------

const DAY = 86400_000;
const IST = 330 * 60_000;

/** The IST calendar day of `now`, as UTC midnight of that day (for date arithmetic). */
function istDay(now: number): number {
  return Math.floor((now + IST) / DAY) * DAY;
}
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A period as [from, to) in two forms: calendar dates (for date fields) and UTC instants
 * (for date-time fields). Weeks start on Monday.
 */
export function periodRange(
  period: Period,
  now = Date.now(),
): { fromDate: string | null; toDate: string | null; from: string | null; to: string | null } {
  const today = istDay(now);
  const dow = (new Date(today).getUTCDay() + 6) % 7; // Monday = 0
  const monthStart = (offset: number) => {
    const d = new Date(today);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
  };
  let a: number | null;
  let b: number | null;
  switch (period) {
    case "today":
      [a, b] = [today, today + DAY];
      break;
    case "tomorrow":
      [a, b] = [today + DAY, today + 2 * DAY];
      break;
    case "yesterday":
      [a, b] = [today - DAY, today];
      break;
    case "this_week":
      [a, b] = [today - dow * DAY, today + (7 - dow) * DAY];
      break;
    case "next_week":
      [a, b] = [today + (7 - dow) * DAY, today + (14 - dow) * DAY];
      break;
    case "last_week":
      [a, b] = [today - (dow + 7) * DAY, today - dow * DAY];
      break;
    case "this_month":
      [a, b] = [monthStart(0), monthStart(1)];
      break;
    case "next_month":
      [a, b] = [monthStart(1), monthStart(2)];
      break;
    case "last_month":
      [a, b] = [monthStart(-1), monthStart(0)];
      break;
    case "next_7_days":
      [a, b] = [today, today + 7 * DAY];
      break;
    case "last_7_days":
      [a, b] = [today - 6 * DAY, today + DAY];
      break;
    case "next_30_days":
      [a, b] = [today, today + 30 * DAY];
      break;
    case "last_30_days":
      [a, b] = [today - 29 * DAY, today + DAY];
      break;
    case "past":
      [a, b] = [null, today];
      break;
    case "future":
      [a, b] = [today, null];
      break;
  }
  // Instants: the IST day boundaries in UTC ("past"/"future" split at now, not midnight).
  const instant = (ms: number | null) => (ms === null ? null : new Date(ms - IST).toISOString());
  const nowIso = new Date(now).toISOString();
  return {
    fromDate: a === null ? null : ymd(a),
    toDate: b === null ? null : ymd(b),
    from: period === "future" ? nowIso : instant(a),
    to: period === "past" ? nowIso : instant(b),
  };
}
