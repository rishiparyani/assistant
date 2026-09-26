import type { z } from "zod";
import { AppError } from "./errors.ts";

/** Validates input with a shared Zod schema; failures become a 400 with per-field issues. */
export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError("validation_failed", result.error.issues[0]?.message ?? "Invalid input", {
      issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  return result.data;
}
