import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Tests run inside the Workers runtime (workerd) with the dev config's bindings and a
// fresh local D1 per test file, migrated by test/setup.ts.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")) },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
