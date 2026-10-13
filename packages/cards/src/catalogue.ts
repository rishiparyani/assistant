// The catalogue (decision 2026-10-12 "Cards become their own package"): one line per
// arrangement, written for the assistant. It's built from the same definitions the app draws
// from, so what the assistant is told can't drift from what exists. Short on purpose: the
// whole list is a few hundred tokens, and the details of a part come from `describe`.
import { ARRANGEMENT_SIZES, ARRANGEMENTS, type Arrangement } from "./spec.ts";

export interface ArrangementInfo {
  /** What it shows, in a few words. */
  shows: string;
  /** What the source needs beyond a collection (fields named on the source). */
  needs: string;
  /** When to pick it. */
  use: string;
  /** Made by the app itself, never by the assistant (it has no source to describe). */
  appOnly?: true;
  /** Not drawn yet (it shows as a plain list until it is): kept out of the catalogue. */
  later?: true;
}

export const ARRANGEMENT_INFO: Record<Arrangement, ArrangementInfo> = {
  number: {
    shows: "one big number: a count, or a total of a number or money field",
    needs: "sum_field to add up (none = count the records)",
    use: "spent this month, guests in, gigs this year",
  },
  "number-chart": {
    shows: "a big number with a small bar chart of it over time",
    needs: "sum_field, and a date field on the collection",
    use: "spending by week, gigs per month",
    later: true,
  },
  "two-numbers": {
    shows: "two numbers side by side",
    needs: "two sources (left, right), each with an optional sum_field",
    use: "earned vs spent, in vs expected",
    later: true,
  },
  "two-numbers-list": {
    shows: "two numbers with the first source's items listed under them",
    needs: "two sources",
    use: "paid vs due with who still owes",
    later: true,
  },
  "list-ticks": {
    shows: "a list with a tick box on each row",
    needs: "answer_field: the yes/no field a tick sets",
    use: "to-dos, packing lists, who has arrived",
  },
  "list-plain": {
    shows: "a plain list of titles with one detail each",
    needs: "nothing more",
    use: "notes, songs, anything to glance at",
  },
  "list-counter": {
    shows: "a list with a + button on each row",
    needs: "answer_field: the number field + adds 1 to",
    use: "practice counts, guests arriving in parts",
    later: true,
  },
  next: {
    shows: "the next few items by date, soonest first",
    needs: "date_field",
    use: "coming up, next gigs, upcoming bills",
  },
  countdown: {
    shows: "days left until the next item",
    needs: "date_field",
    use: "days to the wedding gig, to the rent",
  },
  question: {
    shows: "a question with answer buttons",
    needs: "made from a process's ask step",
    use: "made by processes",
    appOnly: true,
  },
  "quick-add": {
    shows: "an add box for a list",
    needs: "made from a view's add_fields",
    use: "made by save_view with add_fields",
    appOnly: true,
  },
  process: {
    shows: "what a process is waiting on, with answer and nudge buttons",
    needs: "made from a process",
    use: "made by processes",
    appOnly: true,
  },
  memory: {
    shows: "what the assistant remembers",
    needs: "made by the app",
    use: "made by the app",
    appOnly: true,
  },
  progress: {
    shows: "a bar: how many items are done out of all",
    needs: "answer_field: the yes/no field that means done",
    use: "songs ready for the gig, tasks done this week",
  },
  table: {
    shows: "an answer as a small table: a row per group, a column per total or count, kept live",
    needs: "card.question (group_by, measures, as for the query tool); the view's filters narrow it",
    use: "earnings by venue this year, spending by category this month",
  },
  bars: {
    shows: "an answer as bars: one bar per group, sized by the first column, kept live",
    needs: "card.question with one group_by and a total or count first",
    use: "spending by category, gigs per month",
  },
};

/** The catalogue as the assistant reads it: one line per arrangement it may choose. */
export function catalogueText(): string {
  return ARRANGEMENTS.filter((a) => !ARRANGEMENT_INFO[a].appOnly && !ARRANGEMENT_INFO[a].later)
    .map((a) => {
      const i = ARRANGEMENT_INFO[a];
      return `- ${a} (${ARRANGEMENT_SIZES[a].join("/")}): ${i.shows}; needs ${i.needs}; e.g. ${i.use}`;
    })
    .join("\n");
}

/** The controls a list card's rows can have, for the assistant (save_view / update_view card). */
export const CONTROLS_TEXT = [
  "Controls on a list card's rows (card.controls, up to 4, each bound to a field):",
  "- tick or switch: a yes/no field (done, paid, arrived)",
  "- chips: a choice field (tap one: Learning / Ready / Stage)",
  "- stepper: a number field (− and +; min, max, step)",
  "- stars: a number field rated 1–5 (max up to 10)",
  "- slider: a number field between min and max",
  '- button: sets one field to one value (label "Paid", value true)',
].join("\n");

/** One arrangement in full, when the assistant asks about it. */
export function describe(a: Arrangement): string {
  const i = ARRANGEMENT_INFO[a];
  return [
    `${a}: ${i.shows}.`,
    `Sizes: ${ARRANGEMENT_SIZES[a].join(", ")} (xs half a cell, s one cell, bar a short full-width strip, m two cells side by side, l a 2×2 block).`,
    `Source: ${i.needs}.`,
    `Good for: ${i.use}.`,
  ].join("\n");
}
