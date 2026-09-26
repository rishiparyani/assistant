// Our Drizzle copy of Better Auth's tables must match what Better Auth expects.
// If a Better Auth upgrade or plugin change needs new tables/columns, this fails:
// update src/core/db/auth-schema.ts, then `pnpm db:generate`.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/core/auth/options.ts";

const options = () =>
  authOptions({
    baseURL: "http://localhost:8787",
    secret: "test-secret-test-secret-test-secret-00",
    database: env.DB,
    google: { clientId: "x", clientSecret: "x" },
  });

describe("Better Auth schema", () => {
  it("has every table and column Better Auth needs", async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(options());
    expect(toBeCreated.map((t) => t.table)).toEqual([]);
    expect(toBeAdded.map((t) => `${t.table}: ${Object.keys(t.fields).join(", ")}`)).toEqual([]);
  });

  it("would catch a missing column (guard self-check)", async () => {
    await env.DB.exec(`alter table organization drop column kind`);
    try {
      const { toBeAdded } = await getMigrations(options());
      expect(toBeAdded.map((t) => t.table)).toContain("organization");
    } finally {
      await env.DB.exec(`alter table organization add column kind text`);
    }
  });
});
