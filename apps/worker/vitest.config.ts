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
        // Fixed test settings, independent of any local .dev.vars. Localhost enables
        // email/password sign-up so tests don't need Google.
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          ENVIRONMENT: "development",
          BASE_URL: "http://localhost:8787",
          BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-00",
          GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
