// The universal engine's shapes (docs/design/universal.md): spaces hold collections with
// typed fields; records keep their values by field id. Values are checked here so the
// server and (later) the device apply the same rules.
import { z } from "zod";
import { clientId, optionalText } from "./fields.ts";
import type { RuleView } from "./rules.ts";
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
  views: 200,
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
  /** Each person fills in their own answer ("Going?"); not for links or the title. */
  personal?: boolean;
  /** number / money / date: calculated from other fields, e.g. "{Fee} - {Paid}" (read-only). */
  formula?: string;
  /**
   * number / money / date: calculated over linked records (read-only): count them, or the
   * sum, smallest or largest of one of their fields. `via` is a link field of this record, or
   * a link field elsewhere that points here.
   */
  rollup?: {
    via: string;
    dir?: "out" | "in";
    fn: RollupFn;
    of?: string | null;
    /** Only linked records matching all of these (fields of the linked collection, by id). */
    where?: RuleFilter[];
  };
}

export const ROLLUP_FNS = ["count", "sum", "min", "max"] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];

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
  /** Its rules (checks, uniqueness, status flows); only from describe_collection. */
  rules?: RuleView[];
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
  /**
   * Personal fields: everyone's answers (for the space's people). `values` holds the asking
   * person's own answer.
   */
  answers?: Record<string, PersonalAnswer[]>;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface PersonalAnswer {
  user_id: string;
  name: string;
  value: StoredValue;
  display: string | string[] | null;
}

export interface FindResult {
  items: RecordView[];
  next_cursor: string | null;
}

/** One entry of a space's change log; devices pull everything after their last `seq`. */
export interface ChangeView {
  seq: number;
  at: string;
  kind: "collection" | "record" | "space" | "view";
  id: string;
  op: "upsert" | "delete";
}

export interface ChangesView {
  changes: ChangeView[];
  /** The newest seq; pass it back as `since` next time. */
  seq: number;
  /** With `data=1`: the current state of what changed in this page (deleted ones are left out). */
  records?: RecordView[];
  collections?: CollectionView[];
  views?: SavedView[];
  /** More changes are waiting (call again with `since` = `seq`). */
  more: boolean;
}

// --- Inputs (operation schemas) --------------------------------------------------------

const name = (what: string) => z.string().trim().min(1).max(80).describe(what);
const nameOrId = (what: string) => z.string().trim().min(1).max(80).describe(`${what} name or id`);

export const SpaceRef = z.object({
  space: nameOrId("Space").optional().describe("Space name or id; leave out for your Personal space"),
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
    personal: z
      .boolean()
      .optional()
      .describe(
        "Each person fills in their own answer (e.g. Going?); not for links, the title or required fields",
      ),
    formula: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe(
        'number / money / date: a calculated value, fields in braces, e.g. "{Fee} - {Paid}" or "{Date} + 7"',
      ),
    rollup: z
      .object({
        via: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe('A link field of this collection, or a collection that links here (e.g. "Payments")'),
        fn: z.enum(["count", "sum", "min", "max"]),
        of: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .describe("sum / min / max: the field of the linked records"),
        where: z
          .array(
            z.object({
              field: z.string().trim().min(1).max(80),
              op: z.enum(FILTER_OPS),
              value: z
                .union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.null(),
                  z.array(z.union([z.string(), z.number()])),
                ])
                .optional(),
            }),
          )
          .max(5)
          .optional()
          .describe(
            'Only the linked records matching all of these, e.g. [{field: "Kind", op: "eq", value: "Show"}]',
          ),
      })
      .optional()
      .describe("number / money / date: a total over linked records, e.g. sum of Amount over Payments"),
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

/** The everyday lists the assistant starts on the spot, the first time they're needed. */
export const STARTER_KINDS = ["notes", "reminders", "events", "expenses", "inbox"] as const;
export type StarterKind = (typeof STARTER_KINDS)[number];
export const StartListInput = SpaceRef.extend({
  kind: z
    .enum(STARTER_KINDS)
    .describe(
      "notes, reminders (with an alarm at Due), events (things at a time), expenses, or inbox (things captured that fit no list yet)",
    ),
});

/** Something captured (home-first.md §2 point 12): from Siri, the share sheet, a chat, a screenshot's text. */
export const CAPTURE_SOURCES = ["siri", "share", "chat", "whatsapp", "other"] as const;
export const CaptureInput = SpaceRef.extend({
  text: z.string().trim().min(1).max(4000).describe("What was captured, as text"),
  source: z.enum(CAPTURE_SOURCES).default("other").describe("Where it came from"),
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

/** Several record changes in one write: all of them, or none (a pick-board "Replace"). */
export const UpdateRecordsInput = SpaceRef.extend({
  changes: z
    .array(
      z.object({
        record_id: z.string().trim().min(1).max(40),
        values: valuesSchema.describe("Only the fields to change; null clears a field"),
      }),
    )
    .min(1)
    .max(50),
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
  "this_year",
  "last_year",
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

/** One entry of "what changed": a record added, changed or deleted, in plain words. */
export interface HistoryItem {
  /** The audit entry's id (what Undo takes). */
  id: string;
  at: string;
  action: "add_record" | "update_record" | "delete_record";
  record_id: string;
  title: string;
  collection: string;
  /** "Amount: ₹450 → ₹500", "Done: no → yes"; for an add, "What: Chai". */
  lines: string[];
  /** Who did it: "you", a name, or the assistant's source. */
  by: string;
  source: string;
  /** An add or a change can be undone (a delete can't: its values are gone). */
  undoable: boolean;
  /** Already undone (by the entry with this id). */
  undone_by: string | null;
}

export const HistoryInput = SpaceRef.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const UndoInput = SpaceRef.extend({
  change_id: z.string().trim().min(1).max(40).describe("The entry's id from the history"),
});

export const ChangesInput = SpaceRef.extend({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  /** "1": include the current data of what changed (the app's offline copy). */
  data: z.enum(["0", "1"]).optional(),
});

// --- Saved views (design §10: pop-up and pinned views) -----------------------------------

export const VIEW_MODES = ["list", "table"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** A collection seen a saved way: its filters, search and sort, as a list or a table. */
/** The named arrangements a card can have (packages/cards draws them). */
export const ARRANGEMENTS = [
  "number",
  "number-chart",
  "two-numbers",
  "two-numbers-list",
  "list-ticks",
  "list-plain",
  "list-counter",
  "next",
  "countdown",
  "question",
  "quick-add",
  "process",
  "memory",
  "progress",
  "table",
  "bars",
] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

/**
 * Controls on a card's rows (decision 2026-10-12 "Cards have controls"): each is bound to one
 * field of the list and writes that field when used. tick/switch: a yes/no field; chips: a
 * choice field; stepper/stars/slider: a number field; button: sets one field to one value.
 */
export const CARD_CONTROL_KINDS = [
  "tick",
  "switch",
  "chips",
  "stepper",
  "stars",
  "slider",
  "button",
] as const;
export type CardControlKind = (typeof CARD_CONTROL_KINDS)[number];
export interface CardControl {
  /** The field's id. */
  field: string;
  as: CardControlKind;
  /** A button's words. */
  label?: string;
  /** What a button sets the field to. */
  value?: StoredValue;
  min?: number;
  max?: number;
  step?: number;
}
/**
 * How each row of a list card is laid out (decision 2026-10-13 "Cards get rich rows"): a date
 * tile on the left, the title, a line of details ("Sat · 6 pm · Vibe Tribe"), highlighted
 * pills ("₹5,000"), a callout for a note, and an action on the right (directions, call, open).
 * Every part names a field of the list; the app draws it. Ids are stored, names are taken in.
 */
export const ROW_ACTIONS = ["directions", "call", "open"] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];
export interface RowLayout {
  /** A date or date-time field shown as a calendar tile (OCT / 17). */
  date: string | null;
  /** Up to 3 fields on one line under the title; a choice shows with its colour dot. */
  details: string[];
  /** Up to 2 fields shown as highlighted pills (money, a status). */
  pills: string[];
  /** A text field shown in a highlighted box when it has something (a to-do, a warning). */
  callout: { field: string; label: string | null } | null;
  /** A text field the row's button acts on: an address (directions), a phone (call), a link (open). */
  action: { field: string; as: RowAction } | null;
}

/** How a saved view's card looks, when the person (or the assistant) chose. */
export interface CardConfig {
  arrangement: Arrangement | null;
  controls: CardControl[];
  /** The rows' layout (list cards); null: title and one detail. */
  row?: RowLayout | null;
  /** table / bars: the question it answers live (names, checked when saved). */
  question?: CardQuestion | null;
}

/** Card sizes, smallest first: xs and bar are half height (a number, a countdown, a bar). */
export const CARD_SIZE_VALUES = ["xs", "s", "bar", "m", "l"] as const;
export type CardSizeValue = (typeof CARD_SIZE_VALUES)[number];

export interface SavedView {
  id: string;
  name: string;
  collection_id: string;
  collection: string;
  filters: Filter[];
  search: string | null;
  sort: { field: string; dir: "asc" | "desc" } | null;
  /** A quick add the person asked for (field ids it fills in); [] when it has none. */
  add_fields: string[];
  mode: ViewMode;
  /** On the shortcuts bar (and, later, as an iPhone widget). */
  pinned: boolean;
  position: number;
  /** How big its card is on the phone's home (null: the app picks). */
  card_size: CardSizeValue | null;
  /** The card's arrangement and controls (null: the app picks). */
  card: CardConfig | null;
  updated_at: string;
}

const viewQuery = {
  filters: z.array(FilterInput).max(10).optional(),
  search: z.string().trim().max(100).nullish(),
  sort: z
    .object({ field: z.string().trim().min(1).max(80), dir: z.enum(["asc", "desc"]).default("asc") })
    .nullish(),
  mode: z.enum(VIEW_MODES).optional(),
};

/** Only when the person asks for one: a quick add on the view (an add box with these fields). */
/** The card's size on the home (packages/cards draws them); null lets the app pick. */
const cardSize = z
  .enum(CARD_SIZE_VALUES)
  .nullish()
  .describe(
    "Size of its card on the home: xs (half width, half height: one number), s (half width), bar (full width, half height), m (full width), l (tall)",
  );

const cardControl = z.object({
  field: z.string().trim().min(1).max(80).describe("Field name"),
  as: z
    .enum(CARD_CONTROL_KINDS)
    .describe(
      "tick or switch (yes/no field), chips (choice field), stepper, stars or slider (number field), button (sets the field to value)",
    ),
  label: z.string().trim().min(1).max(24).optional().describe("A button's words, e.g. Paid"),
  value: z
    .union([z.string().max(200), z.number(), z.boolean(), z.null()])
    .optional()
    .describe("What a button sets"),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
});
const fieldName = z.string().trim().min(1).max(80);
const rowLayout = z
  .object({
    date: fieldName.nullish().describe("A date field shown as a calendar tile on the left"),
    details: z
      .array(fieldName)
      .max(3)
      .optional()
      .describe('Up to 3 fields on one line under the title, e.g. ["Starts", "Band"]'),
    pills: z.array(fieldName).max(2).optional().describe('Up to 2 fields highlighted as pills, e.g. ["Fee"]'),
    callout: z
      .object({
        field: fieldName,
        label: z.string().trim().min(1).max(24).nullish().describe('e.g. "To do"'),
      })
      .nullish()
      .describe("A text field shown in a highlighted box when it has something"),
    action: z
      .object({ field: fieldName, as: z.enum(ROW_ACTIONS) })
      .nullish()
      .describe("A button on the right: directions (an address field), call (a phone), open (a link)"),
  })
  .nullish()
  .describe("How each row of a list card looks; only when the person asks for a richer list");
// Questions about the data (data-query.ts): the parts a card can keep, so a pinned answer
// stays live on the home.
export const QUERY_FNS = ["count", "sum", "avg", "min", "max", "count_distinct"] as const;
export type QueryFn = (typeof QUERY_FNS)[number];
export const DATE_BUCKETS = ["day", "week", "month", "year"] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];
/** At most this many records are read for one question; more fails ("narrow it"). */
export const MAX_QUERY_RECORDS = 20_000;
export const MAX_QUERY_ROWS = 200;

export const QueryPath = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .describe(
    'A field ("Fee"); a linked list\'s field ("Client.Name", "Payouts.Amount" for a list that links here); a date by "day", "week", "month" or "year" ("Date:month")',
  );

export const QueryMeasure = z.object({
  fn: z.enum(QUERY_FNS).optional().describe('What to work out (left out with "calc": a sum of others)'),
  field: QueryPath.optional().describe('The field it reads (left out for "count": count the records)'),
  where: z
    .array(FilterInput)
    .max(5)
    .optional()
    .describe(
      "Only records matching these, for this column only (e.g. Date period last_year next to this_year)",
    ),
  calc: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Arithmetic on earlier columns by name, e.g. "{Earned} - {Paid out}" (+ - * / and brackets)'),
  as: z.string().trim().min(1).max(40).optional().describe("The column's name"),
});
export type QueryMeasure = z.infer<typeof QueryMeasure>;

/** A question kept on a card: the view's list and filters are its "from" and "where". */
export const CardQuestion = z
  .object({
    group_by: z.array(QueryPath).max(2).default([]),
    measures: z.array(QueryMeasure).min(1).max(6),
    sort: z
      .object({ by: z.string().trim().min(1).max(160), dir: z.enum(["asc", "desc"]).default("desc") })
      .optional(),
    limit: z.number().int().min(1).max(MAX_QUERY_ROWS).default(20),
  })
  .describe("With arrangement table or bars: the question the card answers live (as for the query tool)");
export type CardQuestion = z.infer<typeof CardQuestion>;
const cardConfig = z
  .object({
    arrangement: z
      .enum(ARRANGEMENTS)
      .nullish()
      .describe("How the card shows its records (see the card catalogue)"),
    controls: z.array(cardControl).max(4).optional().describe("Controls on each row, bound to fields"),
    row: rowLayout,
    question: CardQuestion.nullish(),
  })
  .nullish()
  .describe(
    "Only when the person asks for a certain card or for buttons, switches and the like on it; null resets",
  );

const addFields = z
  .array(z.string().trim().min(1).max(80))
  .max(10)
  .optional()
  .describe(
    'Only if the person asks for a quick add (an add box): the fields it fills in, e.g. ["What", "Amount"]; include the required ones; [] removes it',
  );

export const SaveViewInput = SpaceRef.extend({
  id: clientId,
  name: name("View name, e.g. Unpaid this month"),
  collection: nameOrId("Collection"),
  ...viewQuery,
  pinned: z.boolean().optional().describe("Put it on the shortcuts bar"),
  add_fields: addFields,
  card_size: cardSize,
  card: cardConfig,
});

export const ViewRef = SpaceRef.extend({
  view_id: z.string().trim().min(1).max(80).describe("View id or name"),
});

export const UpdateViewInput = ViewRef.extend({
  name: name("New name").optional(),
  ...viewQuery,
  pinned: z.boolean().optional(),
  position: z.number().optional(),
  add_fields: addFields,
  card_size: cardSize,
  card: cardConfig,
});

export const OpenViewInput = ViewRef.extend({
  limit: z.coerce.number().int().min(1).max(SPACE_LIMITS.findLimit).default(30),
  cursor: z.string().max(400).optional(),
});

/** A view with its records, as the pop-up shows it. */
export interface OpenedView {
  view: SavedView;
  collection: CollectionView;
  result: FindResult;
}

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
  const yearStart = (offset: number) => Date.UTC(new Date(today).getUTCFullYear() + offset, 0, 1);
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
    case "this_year":
      [a, b] = [yearStart(0), yearStart(1)];
      break;
    case "last_year":
      [a, b] = [yearStart(-1), yearStart(0)];
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

// --- Chat with the assistant (design §10) -------------------------------------------------

/** One thing on the chat screen. Tool calls and their raw results stay inside the chat object. */
/**
 * A live card in the chat (docs/design/chat-first.md): it points at real data, and the app
 * loads it fresh, so a change made anywhere shows in the card.
 */
export type LiveRef =
  | { kind: "record"; collection_id: string; record_id: string }
  | {
      kind: "list";
      collection_id: string;
      /** "Expenses · Date is in this month" */
      title: string;
      query: {
        filters?: RuleFilter[];
        search?: string;
        sort?: { field: string; dir: "asc" | "desc" };
      };
    }
  | { kind: "view"; view_id: string }
  /** A question sent to people (chat-first step 4): answers arrive live. */
  | { kind: "question"; question_id: string }
  /** A workflow (chat-first step 5): diagram, plain words, on/off. */
  | { kind: "workflow"; workflow_id: string }
  /** An answer (decision 2026-10-13 "Questions, not SQL"): worked out fresh each time it shows. */
  | {
      kind: "query";
      /** The space it was asked in (null: the person's own). */
      space_id: string | null;
      title: string;
      query: {
        from: string;
        where?: RuleFilter[];
        group_by?: string[];
        measures?: Record<string, unknown>[];
        sort?: { by: string; dir: "asc" | "desc" };
        limit?: number;
      };
    }
  /** Something in an app (a Songbook song): what it was then, opening the app's own screen. */
  | { kind: "app"; app: string; title: string; subtitle?: string | null; href: string };

export interface ChatItem {
  id: string;
  role: "user" | "assistant" | "card" | "note" | "live";
  /** For role "live": what the card shows. */
  live?: LiveRef;
  text: string;
  /** A confirm card: what the assistant wants to do, waiting for a tap. */
  card?: {
    action_id: string;
    tool: string;
    title: string;
    details: string[];
    status: "waiting" | "done" | "cancelled" | "failed" | "expired";
    result?: string;
  };
  /** Which level answered (1 everyday, 2 smart, 3 best). */
  level?: number;
  created_at: string;
}

export interface ChatView {
  /** "main" for the person's first chat, else the chat's id. */
  id: string;
  title: string;
  items: ChatItem[];
  /** A setup is being built: the smart model answers until it's saved. */
  setup_in_progress: boolean;
  /** Whether the smart model can be used now (prepaid credit set up and budget left). */
  smart_available: boolean;
  /** Whether this person may ask the assistant (owners always; others when switched on). */
  assistant_on: boolean;
}

/** One of the person's chats, for the side menu. */
export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string | null;
}

/** Something the assistant remembers for the person (chat-first step 3). */
export interface Memory {
  id: string;
  text: string;
  /** Where it came from, e.g. "From a chat, 10 Oct 2026". */
  source: string;
  created_at: string;
}

/** "main" or a chat's ULID. */
export const ChatId = z
  .string()
  .trim()
  .regex(/^(main|[0-9A-HJKMNP-TV-Z]{26})$/, "Not a chat id");
export const ChatRef = z.object({ chat_id: ChatId });
export const NewChatInput = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    .optional()
    .describe("Made on the device, so a retry can't make two chats"),
});
export const RememberInput = z.object({
  text: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('One fact or preference, in a short sentence: "Weddings are ₹25,000 for the band."'),
});
export const MemoryRef = z.object({ memory_id: z.string().trim().min(1).max(60) });

export const ChatSendInput = z.object({
  text: z.string().trim().min(1).max(2000),
  think_harder: z.boolean().optional(),
});
/** Put a live card in a chat without the assistant (e.g. a question asked from the + menu). */
export const ShowInChatInput = z.object({
  chat_id: ChatId,
  live: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("record"),
      collection_id: z.string().min(1).max(40),
      record_id: z.string().min(1).max(40),
    }),
    z.object({ kind: z.literal("view"), view_id: z.string().min(1).max(40) }),
    z.object({ kind: z.literal("question"), question_id: z.string().min(1).max(40) }),
    z.object({ kind: z.literal("workflow"), workflow_id: z.string().min(1).max(40) }),
  ]),
});
export const ChatActionRef = z.object({ action_id: z.string().trim().min(1).max(60) });
export const ChatSendTo = ChatRef.extend(ChatSendInput.shape);
export const ChatActionIn = ChatRef.extend(ChatActionRef.shape);

// --- Sharing (design §11) -------------------------------------------------------------------

export const SHARE_ACCESS = ["view", "edit"] as const;
export type ShareAccess = (typeof SHARE_ACCESS)[number];

/** What a share includes besides its record: a link field of the record, or records linking to it. */
export type ShareInclude = { field: string } | { from_field: string };

/** A row rule's filter as stored (field by id). */
export interface RuleFilter {
  field: string;
  op: FilterOp;
  value?: string | number | boolean | null | (string | number)[];
}

/**
 * What's shared: a card (one record and parts linked to it), a view (its records, live), or a
 * form (people add records to a collection and see only their own).
 */
export const SHARE_KINDS = ["card", "view", "form", "question"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export interface ShareView {
  id: string;
  kind: ShareKind;
  /** The card's record, the view's id or the form's collection id. */
  target_id: string;
  /** Kept for cards (same as target_id). */
  record_id: string | null;
  title: string;
  /** Anyone with the link, without signing in (views to look at, forms to fill in). */
  public: boolean;
  access: ShareAccess;
  /** The linked parts included, by name ("Set list", "Rehearsals"). */
  include: { key: string; title: string }[];
  hidden_fields: { id: string; name: string }[];
  people: { user_id: string; name: string; joined_at: string; rule: RuleFilter[] }[];
  /** Views: rows everyone in the share sees (filters on top of the view's own). */
  rule_all: RuleFilter[];
  expires_at: string | null;
  created_at: string;
}

/** A new share: the link is shown once (only its hash is kept). */
export interface CreatedShare {
  share: ShareView;
  link: string;
}

export interface SharedField {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  value: StoredValue;
  display: string | string[] | null;
  editable: boolean;
  /** The record's title field (shown as its title). */
  title: boolean;
  /** Each person's own answer (the value shown is mine). */
  personal: boolean;
}
/** A record as a collaborator sees it: only the fields shared with them (no links out). */
export interface SharedRecord {
  id: string;
  title: string;
  fields: SharedField[];
}
export interface SharedFieldInfo {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  editable: boolean;
  required: boolean;
  personal: boolean;
  /**
   * Forms: what this person may pick. A link lists the records they can see through their
   * shares; a person field offers "me" (whoever is signed in).
   */
  pick?: { id: string; title: string }[];
}
type SharedHead<K extends ShareKind> = {
  id: string;
  kind: K;
  title: string;
  access: ShareAccess;
  owner: string;
};

/** What a collaborator sees: one card and the parts the owner included. */
export interface SharedCardView {
  share: SharedHead<"card">;
  record: SharedRecord;
  sections: {
    key: string;
    title: string;
    collection_id: string;
    /** Collaborators with edit access may add records here (linked to the card). */
    can_add: boolean;
    fields: SharedFieldInfo[];
    records: SharedRecord[];
  }[];
}
/** A shared view: its records as they are now (filters and sort kept by the owner). */
export interface SharedListView {
  share: SharedHead<"view">;
  collection: string;
  fields: SharedFieldInfo[];
  can_add: boolean;
  records: SharedRecord[];
  next_cursor: string | null;
}
/** A form: the fields to fill in, and what I've sent before (signed in only). */
export interface SharedFormView {
  share: SharedHead<"form">;
  collection: string;
  description: string | null;
  fields: SharedFieldInfo[];
  mine: SharedRecord[];
}
/** A question someone asked me: their text, the choices, and my answer so far. */
export interface SharedQuestionView {
  share: SharedHead<"question">;
  text: string;
  choices: string[] | null;
  mine: string | null;
  closed: boolean;
}
export type SharedOpened = SharedCardView | SharedListView | SharedFormView | SharedQuestionView;

export interface SharedWithMe {
  share_id: string;
  kind: ShareKind;
  title: string;
  owner: string;
  access: ShareAccess;
  joined_at: string;
}

const fieldRefs = z.array(z.string().trim().min(1).max(80)).max(100);

/** What to share: one record as a card, a saved view, or a collection as a form. */
const ShareTarget = SpaceRef.extend({
  record_id: z.string().trim().min(1).max(40).optional().describe("A record to share as a card"),
  view: z.string().trim().min(1).max(80).optional().describe("Or a saved view to share (name or id)"),
  form: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Or a collection to share as a form people fill in (name or id)"),
  include: z
    .array(z.string().trim().min(1).max(160))
    .max(20)
    .optional()
    .describe(
      'Cards: linked parts to include: a link field of the record ("Set list"), or a collection that links to it ("Rehearsals")',
    ),
  access: z.enum(SHARE_ACCESS).default("view"),
  hide_fields: fieldRefs.optional().describe("Fields the collaborator doesn't see"),
});
const oneTarget = {
  check: (i: { record_id?: string; view?: string; form?: string }) =>
    [i.record_id, i.view, i.form].filter(Boolean).length === 1,
  message: "Share one thing: record_id, view or form",
};

export const CreateShareInput = ShareTarget.extend({
  public: z
    .boolean()
    .default(false)
    .describe("Views and forms: anyone with the link, without signing in (views stay read-only)"),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
}).refine(oneTarget.check, { message: oneTarget.message });

/** People I know: names ("Rahul", "Priya Test") or ids, from list_people. */
const peopleRefs = z
  .array(z.string().trim().min(1).max(80))
  .min(1)
  .max(20)
  .describe("People you know (from list_people): their names or ids");

/** Share straight with people I know: no link, they find it under "Shared with you". */
export const ShareWithInput = ShareTarget.extend({
  people: peopleRefs,
  hide_fields: fieldRefs
    .optional()
    .describe("Fields they don't see; left out, money fields stay hidden ([] shows everything)"),
}).refine(oneTarget.check, { message: oneTarget.message });

// --- Questions (chat-first step 4) -----------------------------------------------------------

/** A question I sent and the answers so far (live). */
export interface QuestionView {
  id: string;
  text: string;
  /** Buttons to tap; null for a free answer. */
  choices: string[] | null;
  /** Everyone asked, with their answer (null while waiting). */
  people: { user_id: string; name: string; answer: string | null; answered_at: string | null }[];
  share_id: string;
  closed: boolean;
  created_at: string;
}

export const AskPeopleInput = SpaceRef.extend({
  id: clientId,
  text: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('The question, e.g. "Free on Sat 14 Nov for the Test Wedding?"'),
  choices: z
    .array(z.string().trim().min(1).max(40))
    .min(2)
    .max(6)
    .optional()
    .describe('Answers to tap, e.g. ["Yes", "No", "Maybe"]; left out, they write an answer'),
  people: peopleRefs,
  chat_id: ChatId.optional().describe("App only: also put the question's card in this chat"),
});
export const QuestionRef = SpaceRef.extend({ question_id: z.string().trim().min(1).max(40) });
export const AnswerQuestionInput = z.object({
  share_id: z.string().trim().min(1).max(40),
  answer: z.string().trim().min(1).max(300).describe("One of the choices, or a short answer"),
});

/** Switch the assistant on or off for someone I know (owners and admins). */
export const AssistantAccessInput = z.object({
  user_id: z.string().trim().min(1).max(60),
  on: z.boolean(),
});

/** Someone I know: they joined one of my shares or are in one of my spaces. */
export type Person = {
  user_id: string;
  name: string;
};
export const ShareRef = SpaceRef.extend({ share_id: z.string().trim().min(1).max(40) });
export const SharePersonRef = ShareRef.extend({ user_id: z.string().trim().min(1).max(60) });
export const AddSharePeopleInput = ShareRef.extend({ people: peopleRefs });
export const SetShareRuleInput = ShareRef.extend({
  user_id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe('Whose rows to limit: a person in the share, or "*" for everyone in it'),
  filters: z
    .array(FilterInput)
    .max(10)
    .describe('Rows they see, on top of the view\'s filters ("Assigned to" eq "me"); [] removes the rule'),
});
export const ListSharesInput = SpaceRef.extend({
  target_id: z.string().trim().min(1).max(40).optional().describe("A record, view or collection id"),
  record_id: z.string().trim().min(1).max(40).optional(),
});
export const PublicShareInput = z.object({
  token: z.string().trim().min(20).max(200),
  cursor: z.string().max(200).optional(),
});
export const JoinShareInput = z.object({ token: z.string().trim().min(20).max(200) });
export const SharedRef = z.object({ share_id: z.string().trim().min(1).max(40) });
export const OpenSharedInput = SharedRef.extend({ cursor: z.string().max(200).optional() });
export const UpdateSharedRecordInput = SharedRef.extend({
  record_id: z.string().trim().min(1).max(40),
  values: z.record(z.string(), z.unknown()),
});
export const AddSharedRecordInput = SharedRef.extend({
  section: z.string().trim().min(1).max(80).describe('The section key ("view" or "form" for those shares)'),
  id: clientId,
  values: z.record(z.string(), z.unknown()),
});

// --- Comments (design §11) ------------------------------------------------------------------

export interface CommentView {
  id: string;
  record_id: string;
  author: { user_id: string | null; name: string };
  body: string;
  created_at: string;
  /** Written by the person asking. */
  mine: boolean;
  /** The person asking may delete it (its writer, or the space's owner). */
  can_delete: boolean;
}

const commentBody = z.string().trim().min(1).max(4000).describe("The comment (plain text)");
export const AddCommentInput = RecordRef.extend({ id: clientId, body: commentBody });
export const CommentRef = SpaceRef.extend({ comment_id: z.string().trim().min(1).max(40) });
export const SharedRecordRef = SharedRef.extend({ record_id: z.string().trim().min(1).max(40) });
export const AddSharedCommentInput = SharedRecordRef.extend({ id: clientId, body: commentBody });
export const SharedCommentRef = SharedRef.extend({ comment_id: z.string().trim().min(1).max(40) });
