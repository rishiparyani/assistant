// Input fields every module uses (moved from the gigs module when music needed them).
import { z } from "zod";

/** Optional free text: trimmed; empty becomes null (so updates can clear a field). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

export const id = (what: string) => z.string().trim().min(1).max(40).describe(`${what} id`);

/**
 * An id made on the device (a ULID) for something new, so changes made offline can refer
 * to it before the server has seen it (docs/design/offline.md). Optional everywhere.
 */
export const clientId = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "A ULID")
  .optional()
  .describe("Optional id for the new item, made on the device (ULID); leave out normally");
