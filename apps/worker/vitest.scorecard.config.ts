import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// The model scorecard (scorecard/run.score.ts): the app runs locally with fake data like the
// tests, but the AI binding is remote (real Workers AI through the account's gateways), so it
// needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Run only from the Scorecard workflow.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: true,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          ENVIRONMENT: "development",
          BASE_URL: "http://localhost:8787",
          BETTER_AUTH_SECRET: "scorecard-secret-scorecard-secret-000",
          GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test",
          ADMIN_EMAILS: "Owner.Admin@example.com",
          // Empty until the owner sets up AI credit; then setups (level 2) are scored too.
          AI_PAID_GATEWAY: process.env.AI_PAID_GATEWAY ?? "",
          SCORECARD_ONLY: process.env.SCORECARD_ONLY ?? "",
          SCORECARD_SUITE: process.env.SCORECARD_SUITE ?? "",
          SCORECARD_REPEAT: process.env.SCORECARD_REPEAT ?? "",
          // A candidate everyday model to try (an id from MODELS in core/assistant/models.ts).
          AI_EVERYDAY_MODEL: process.env.AI_EVERYDAY_MODEL ?? "",
          // A candidate setups model to try (level 2), on its maker's own credit.
          AI_SETUP_MODEL: process.env.AI_SETUP_MODEL ?? "",
          // Faster answers (Cerebras): its key. The app's caps are off here (the runner itself
          // spaces cases out for the trial's five a minute), so any suite × repeat can finish.
          CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY ?? "",
          // The makers' keys, for the comparison runs.
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
          GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
          AI_FAST_CALLS_PER_DAY: "1000000",
          AI_FAST_CALLS_PER_MINUTE: "1000000",
        },
      },
    })),
  ],
  test: {
    include: ["scorecard/**/*.score.ts"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 120 * 60_000,
  },
});
