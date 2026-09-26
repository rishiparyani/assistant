import { defineConfig } from "drizzle-kit";

// Generates SQL migrations only; they're applied with `wrangler d1 migrations apply`.
// Every module's schema.ts must be listed via the glob. Never edit an applied migration.
export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/core/db/schema.ts", "./src/modules/*/schema.ts"],
  out: "./migrations",
});
