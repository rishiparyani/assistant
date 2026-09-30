import { z } from "zod";
import { parseINR } from "../../core/money.ts";
import { toUtcIso } from "../../core/dates.ts";

// Shared by every module (core/fields.ts); re-exported here for existing imports.
export { optionalText, id, clientId } from "../../core/fields.ts";

export const dateTime = z
  .string()
  .transform((v, ctx) => {
    try {
      return toUtcIso(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  })
  .describe("Date-time: ISO 8601 with offset, or local India time like 2026-12-12T19:00");

/** Money as either integer paise or a rupee string ("50000", "₹50,000"). */
export const moneyFields = (name: string) => ({
  [`${name}_paise`]: z.number().int().min(0).optional().describe(`${name} in paise (₹1 = 100)`),
  [name]: z
    .union([z.string(), z.number()])
    .optional()
    .describe(`${name} in rupees, e.g. "50000" or "₹50,000" (alternative to ${name}_paise)`),
});

/** Picks the paise value from `<name>_paise` or `<name>`; undefined if neither was given. */
export function resolveMoney(input: Record<string, unknown>, name: string): number | undefined {
  const paise = input[`${name}_paise`];
  const rupees = input[name];
  if (paise !== undefined && rupees !== undefined)
    throw new RangeError(`Give ${name} or ${name}_paise, not both`);
  if (typeof paise === "number") return paise;
  if (typeof rupees === "number") return Math.round(rupees * 100);
  if (typeof rupees === "string") return parseINR(rupees);
  return undefined;
}
