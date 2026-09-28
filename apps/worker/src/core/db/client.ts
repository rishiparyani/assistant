// Drizzle over the D1 binding. Services get this through their context, never
// straight from env.
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as coreSchema from "./schema.ts";

export type Db = DrizzleD1Database<typeof coreSchema>;

/** Module tables are registered too (for relational queries); typed as core here. */
export function createDb(d1: D1Database, moduleSchemas: Record<string, unknown> = {}): Db {
  return drizzle(d1, { schema: { ...coreSchema, ...moduleSchemas } }) as unknown as Db;
}
