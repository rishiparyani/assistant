// End-to-end journeys (decision 2026-10-31 "Journeys guard every change"): a robot browser uses
// the built site the way a person does, at phone size, against the local test server with made-up
// accounts only. Run the site first (see README in this folder), then `pnpm --filter
// @assistant/e2e e2e`. Every bug the owner reports becomes a journey here.
import { defineConfig } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:8787";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE))
  throw new Error("Journeys run only against localhost");

export default defineConfig({
  testDir: "journeys",
  // The journeys share one local server; one at a time keeps them independent of each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    actionTimeout: 15_000,
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
});
