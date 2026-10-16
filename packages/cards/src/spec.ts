// Cards on the home (docs/design/home-first.md §2.3, §5.1): a card is components + one named
// arrangement + a size, bound to a collection and a filter. The model (or a person) picks from
// this set; the app draws it. `card.v1` is the one shape the server validates, the phone, the
// website and the widgets draw, so a card that passed validation is drawable everywhere.
import { z } from "zod";
import {
  ARRANGEMENTS,
  CARD_CONTROL_KINDS,
  ROW_ACTIONS,
  HIGHLIGHT_COLOURS,
  CARD_SIZE_VALUES,
  FilterInput,
  type Arrangement,
  type StoredValue,
} from "@assistant/shared";

export const CARD_VERSION = "card.v1" as const;

/** The named arrangements the app knows how to draw at every size, light and dark (the list
 *  lives in shared, where saved views check it). */
export { ARRANGEMENTS, type Arrangement };

/** xs: half width, half height · s: half width · bar: full width, half height · m: full width ·
 *  l: full width, double height (on a 2-column phone page). */
export const CARD_SIZES = CARD_SIZE_VALUES;
export type CardSize = (typeof CARD_SIZES)[number];

/** Grid cells a size takes on a 2-column phone page (6 rows a page). */
export const CARD_CELLS: Record<CardSize, number> = { xs: 0.5, s: 1, bar: 1, m: 2, l: 4 };

/** Which sizes each arrangement can be drawn at. */
export const ARRANGEMENT_SIZES: Record<Arrangement, readonly CardSize[]> = {
  number: ["xs", "s", "bar", "m"],
  "number-chart": ["s", "m", "l"],
  "two-numbers": ["s", "m"],
  "two-numbers-list": ["m", "l"],
  "list-ticks": ["s", "m", "l"],
  "list-plain": ["s", "m", "l"],
  "list-counter": ["m", "l"],
  next: ["s", "bar", "m", "l"],
  countdown: ["xs", "s", "bar", "m"],
  question: ["m"],
  "quick-add": ["m"],
  process: ["s", "m", "l"],
  memory: ["s", "m"],
  progress: ["xs", "s", "bar", "m"],
  table: ["m", "l"],
  bars: ["m", "l"],
  grid: ["m", "l"],
};

/**
 * The size a card gets when nobody chose one (decision 2026-10-16 "Sizes by content"): a
 * number or a countdown is a half-width tile, so two sit side by side; a list is full width;
 * a table or a grid is tall; "next" is a full-width strip.
 */
export const DEFAULT_CARD_SIZE: Record<Arrangement, CardSize> = {
  number: "s",
  "number-chart": "m",
  "two-numbers": "s",
  "two-numbers-list": "m",
  "list-ticks": "m",
  "list-plain": "m",
  "list-counter": "m",
  next: "bar",
  countdown: "s",
  question: "m",
  "quick-add": "m",
  process: "m",
  memory: "s",
  progress: "s",
  table: "l",
  bars: "l",
  grid: "l",
};

/** What a card reads: a collection, optionally filtered and sorted (like a saved view). */
export const CardSource = z.object({
  collection: z.string().trim().min(1).max(80).describe("Collection id or name"),
  filters: z.array(FilterInput).max(10).optional(),
  sort: z
    .object({ field: z.string().trim().min(1).max(80), dir: z.enum(["asc", "desc"]).default("asc") })
    .nullish(),
  /** For number arrangements: the field to add up; none = count the records. */
  sum_field: z.string().trim().min(1).max(80).nullish(),
  /** For list-ticks: the yes/no field a tick sets; for list-counter: the number field + adds to. */
  answer_field: z.string().trim().min(1).max(80).nullish(),
  /** For next and countdown: the date field that orders what's coming. */
  date_field: z.string().trim().min(1).max(80).nullish(),
});
export type CardSource = z.infer<typeof CardSource>;

export const CardSpec = z.object({
  version: z.literal(CARD_VERSION).default(CARD_VERSION),
  title: z.string().trim().min(1).max(60),
  arrangement: z.enum(ARRANGEMENTS),
  size: z.enum(CARD_SIZES).default("m"),
  /** One source for most arrangements; two for two-numbers (first = left, second = right). */
  sources: z.array(CardSource).min(1).max(2),
  /** Rows shown by list arrangements (the size caps it further). */
  limit: z.number().int().min(1).max(12).optional(),
  /** grid: the columns (field ids), typed over in place. */
  grid: z.object({ fields: z.array(z.string().min(1).max(80)).min(1).max(8) }).nullish(),
  /** Controls on each row, bound to fields by id (switches, chips, steppers, stars, buttons…). */
  controls: z
    .array(
      z.object({
        field: z.string().min(1).max(80),
        as: z.enum(CARD_CONTROL_KINDS),
        label: z.string().max(24).optional(),
        value: z.custom<StoredValue>(() => true).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().positive().optional(),
      }),
    )
    .max(4)
    .optional(),
  /** How each row is laid out (list arrangements): field ids for a date tile, details, pills,
   *  a callout and a button (decision 2026-10-13 "Cards get rich rows"). */
  row: z
    .object({
      date: z.string().min(1).max(80).nullable(),
      details: z.array(z.string().min(1).max(80)).max(3),
      pills: z.array(z.string().min(1).max(80)).max(2),
      callout: z
        .object({ field: z.string().min(1).max(80), label: z.string().max(24).nullable() })
        .nullable(),
      action: z.object({ field: z.string().min(1).max(80), as: z.enum(ROW_ACTIONS) }).nullable(),
      /** Rows that match get a colour and maybe a word; first match wins. */
      highlights: z
        .array(
          z.object({
            when: z
              .array(z.object({ field: z.string(), op: z.string(), value: z.unknown().optional() }))
              .min(1)
              .max(3),
            colour: z.enum(HIGHLIGHT_COLOURS),
            label: z.string().max(16).nullable(),
          }),
        )
        .max(4)
        .optional(),
    })
    .nullish(),
});
export type CardSpec = z.infer<typeof CardSpec>;

/** Why a spec can't be drawn, in words the assistant can pass on. Empty = fine. */
export function cardProblems(spec: CardSpec): string[] {
  const out: string[] = [];
  if (!ARRANGEMENT_SIZES[spec.arrangement].includes(spec.size))
    out.push(
      `${spec.arrangement} can't be ${spec.size}; use ${ARRANGEMENT_SIZES[spec.arrangement].join(", ")}`,
    );
  const two = spec.arrangement === "two-numbers" || spec.arrangement === "two-numbers-list";
  if (two && spec.sources.length !== 2) out.push(`${spec.arrangement} needs two sources`);
  if (!two && spec.sources.length !== 1) out.push(`${spec.arrangement} takes one source`);
  if (spec.arrangement === "list-ticks" && !spec.sources[0]?.answer_field)
    out.push("list-ticks needs answer_field (the yes/no field a tick sets)");
  if (spec.arrangement === "list-counter" && !spec.sources[0]?.answer_field)
    out.push("list-counter needs answer_field (the number field + adds to)");
  if ((spec.arrangement === "next" || spec.arrangement === "countdown") && !spec.sources[0]?.date_field)
    out.push(`${spec.arrangement} needs date_field`);
  if (spec.arrangement === "grid" && !spec.grid?.fields.length)
    out.push("grid needs card.grid.fields (the columns)");
  return out;
}

/** The nearest arrangement that fits the sources given, when the asked one doesn't. */
export function nearestArrangement(spec: CardSpec): Arrangement {
  if (!cardProblems(spec).length) return spec.arrangement;
  const s = spec.sources[0];
  if (spec.sources.length === 2) return "two-numbers";
  if (s?.answer_field) return "list-ticks";
  if (s?.date_field) return "next";
  if (s?.sum_field) return "number";
  return "list-plain";
}

/** What a card has going on, counted by the app from the records it shows. */
export interface CardSignals {
  /** Items not done yet (list-ticks). */
  open: number;
  /** Items whose date has passed and that aren't done. */
  overdue: number;
  /** Items due today (not done). */
  due_today: number;
  /** Items due in the next 7 days (not done, not today). */
  due_soon: number;
  /** Processes waiting on this person (0 until processes exist). */
  waiting: number;
}

/**
 * The Now page's order (home-first.md §2): what's waiting on the person first, then what's
 * overdue, due today, due soon, then open items. A card with nothing going on scores 0 and
 * stays off Now.
 */
export function nowScore(s: CardSignals): number {
  // Tiers never overlap: one item of a higher tier outranks any count of a lower one.
  const cap = (n: number) => Math.min(Math.max(n, 0), 99);
  return (
    cap(s.waiting) * 1e8 + cap(s.overdue) * 1e6 + cap(s.due_today) * 1e4 + cap(s.due_soon) * 1e2 + cap(s.open)
  );
}
