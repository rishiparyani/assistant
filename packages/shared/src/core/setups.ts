// A whole setup at once (chat-first step 6, "setups by chat"): the lists, how they link, their
// calculated fields, rules and views, proposed as one card and made in one write on "Make it".
// The words on the card come from this definition, never from the model's description of it.
import { z } from "zod";
import {
  CreateCollectionInput,
  SaveViewInput,
  SpaceRef,
  type CollectionView,
  type SavedView,
} from "./spaces.ts";
import { AddRuleInput, ruleWords, type RuleView } from "./rules.ts";

export const SETUP_LIMITS = { collections: 8, rules: 20, views: 10 } as const;

export const MakeSetupInput = SpaceRef.extend({
  name: z.string().trim().min(1).max(80).describe("What the setup is for, e.g. Fam jam sign-ups"),
  collections: z
    .array(CreateCollectionInput.omit({ space: true }))
    .min(1)
    .max(SETUP_LIMITS.collections)
    .describe(
      "New collections. A link field's options.target may name another collection in this setup or one that exists; rollups may use those links",
    ),
  rules: z
    .array(AddRuleInput.omit({ space: true }))
    .max(SETUP_LIMITS.rules)
    .default([])
    .describe("Rules on these collections (checks, only-one, status moves)"),
  views: z
    .array(SaveViewInput.omit({ space: true }))
    .max(SETUP_LIMITS.views)
    .default([])
    .describe("Saved views of these collections"),
});
export type MakeSetupInput = z.infer<typeof MakeSetupInput>;

/** A setup as it travels between people: the same shape make_setup takes, minus the space. */
export const SetupDefinition = MakeSetupInput.omit({ space: true });
export type SetupDefinition = z.infer<typeof SetupDefinition>;

/**
 * Share my setup (home-first.md §5.4): the structure of some of my lists (fields, links,
 * calculated fields, rules, saved views), never their records, sent to people I know as a
 * proposal card in their chat; they tap Make it to get it in their own space.
 */
export const ShareSetupInput = SpaceRef.extend({
  to: z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(10)
    .describe("People I know (names or ids) who get the setup as a card to make in their own space"),
  collections: z
    .array(z.string().trim().min(1).max(80))
    .max(SETUP_LIMITS.collections)
    .optional()
    .describe(
      "Which of my collections (names or ids); left out, all of them. Lists they link to come along.",
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('What to call it on their card, e.g. "Gig bookings"; left out, the lists\' names'),
});
export type ShareSetupInput = z.infer<typeof ShareSetupInput>;

export interface SharedSetup {
  name: string;
  /** Who got the card. */
  to: { user_id: string; name: string }[];
  /** The setup as sent, in plain words. */
  words: string[];
  collections: string[];
}

export interface SetupResult {
  collections: CollectionView[];
  rules: RuleView[];
  views: SavedView[];
}

type SetupDef = Pick<z.input<typeof MakeSetupInput>, "collections" | "rules" | "views">;

/** A rule as a setup proposes it (names, not ids). */
export type ProposedRule = NonNullable<SetupDef["rules"]>[number];

/**
 * A proposed rule in the same words a saved one gets (the card before Confirm and the words
 * after say the same thing: conditions, limits and moves included).
 */
export function proposedRuleWords(r: ProposedRule): string {
  const filters = (list?: { field: string; op: string; value?: unknown }[]) =>
    (list ?? []).map((f) => ({
      field_id: "",
      field: f.field,
      op: f.op as RuleView["require"][number]["op"],
      value: (f.value ?? null) as RuleView["require"][number]["value"],
    }));
  return ruleWords({
    kind: r.kind,
    collection: r.collection,
    require: filters(r.require),
    fields: (r.fields ?? []).map((n) => ({ id: "", name: n })),
    at_most: r.at_most ?? 1,
    of: r.of ? { id: "", name: r.of } : null,
    only_if: filters(r.only_if),
    field: r.field ? { id: "", name: r.field } : null,
    moves: r.moves ?? {},
  });
}

/** The setup in plain words, one line per part, from its definition. */
export function setupWords(s: SetupDef): string[] {
  const out: string[] = [];
  for (const c of s.collections) {
    const fields = (c.fields ?? []).filter((f) => !f.options?.formula && !f.options?.rollup);
    const hasTitle = fields.some((f) => f.type === "text" && !f.options?.personal);
    const names = [
      ...(hasTitle ? [] : ["Title"]),
      ...fields
        .filter((f) => f.type !== "link")
        .map((f) => {
          const kind =
            f.type === "choice" || f.type === "multi_choice"
              ? `${f.type === "choice" ? "one of" : "any of"} ${(f.options?.choices ?? []).join(", ")}`
              : f.type === "text"
                ? ""
                : f.type.replace("_", " ");
          const extra = [kind, f.options?.personal ? "each person's own" : ""].filter(Boolean).join("; ");
          return extra ? `${f.name} (${extra})` : f.name;
        }),
    ];
    out.push(`${c.name}: ${names.join(", ")}`);
  }
  for (const c of s.collections)
    for (const f of c.fields ?? []) {
      if (f.type === "link")
        out.push(
          f.options?.target
            ? `${f.name} in ${c.name} links to ${f.options.target}${f.options.many ? " (several)" : ""}`
            : `${f.name} in ${c.name} links to any record`,
        );
      else if (f.options?.formula) out.push(`${f.name} in ${c.name} = ${f.options.formula}`);
      else if (f.options?.rollup) {
        const r = f.options.rollup;
        const only = (r.where ?? [])
          .map((w) =>
            w.op === "empty" || w.op === "not_empty"
              ? `${w.field} ${w.op === "empty" ? "is empty" : "isn't empty"}`
              : `${w.field} ${w.op === "eq" ? "is" : w.op === "ne" ? "isn't" : w.op} ${Array.isArray(w.value) ? w.value.join(" or ") : String(w.value ?? "")}`,
          )
          .join(" and ");
        out.push(
          (r.fn === "count"
            ? `${f.name} in ${c.name} counts the records linked through ${r.via}`
            : `${f.name} in ${c.name} is the ${r.fn === "sum" ? "total" : r.fn === "avg" ? "average" : r.fn === "min" ? "lowest" : "highest"} ${r.of ?? "?"} of the records linked through ${r.via}`) +
            (only ? ` where ${only}` : ""),
        );
      }
    }
  for (const r of s.rules ?? []) out.push(proposedRuleWords(r));
  for (const v of s.views ?? [])
    out.push(
      `A view “${v.name}” of ${v.collection}${v.pinned ? ", on the shortcuts bar" : ""}${v.add_fields?.length ? `, with a quick add for ${v.add_fields.join(", ")}` : ""}`,
    );
  return out;
}
