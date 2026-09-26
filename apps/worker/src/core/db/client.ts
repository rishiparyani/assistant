// Drizzle over the D1 binding. Services get this through their context (T03), never
// straight from env, so every query stays workspace-scoped.
import { drizzle } from "drizzle-orm/d1";
import * as coreSchema from "./schema.ts";

export function createDb<S extends Record<string, unknown>>(d1: D1Database, moduleSchemas: S = {} as S) {
  return drizzle(d1, { schema: { ...coreSchema, ...moduleSchemas } });
}

export type Db = ReturnType<typeof createDb>;
