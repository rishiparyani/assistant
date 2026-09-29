import { z } from "zod";
import { parseINR } from "../../core/money.ts";
import { toUtcIso } from "../../core/dates.ts";

/** Optional free text: trimmed; empty becomes null (so updates can clear a field). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

export const id = (what: string) => z.string().trim().min(1).max(40).describe(`${what} id`);

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

/**
 * An id made on the device (a ULID) for something new, so changes made offline can refer
 * to it before the server has seen it (docs/design/offline.md). Optional everywhere.
 */
export const clientId = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "A ULID")
  .optional()
  .describe("Optional id for the new item, made on the device (ULID); leave out normally");
