// Breaks in a list (decision 2026-10-03): dividers that are never numbered or ticked.
import type { GigListItemView } from "@assistant/shared";

/** "Break · 15 min" (or just the name when it has no length). */
export const breakLength = (name: string, minutes: number | null) =>
  minutes ? `${name} · ${minutes} min` : name;

/** Each item's number in the list, counting items only (breaks get null). */
export function numbers(items: GigListItemView[]): (number | null)[] {
  let n = 0;
  return items.map((i) => (i.kind === "break" ? null : ++n));
}

/** "12 items · 2 breaks" (or "3 of 10 done · 1 break" on a list with tick boxes). */
export function listSummary(items: GigListItemView[], checkable: boolean): string {
  const real = items.filter((i) => i.kind !== "break");
  const breaks = items.length - real.length;
  return [
    checkable
      ? `${real.filter((i) => i.done).length} of ${real.length} done`
      : `${real.length} ${real.length === 1 ? "item" : "items"}`,
    breaks ? `${breaks} ${breaks === 1 ? "break" : "breaks"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
