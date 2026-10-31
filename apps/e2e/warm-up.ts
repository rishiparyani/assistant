// Before the journeys: one pass over the server so the first journey doesn't pay its start-up
// (a freshly started local server answers its first requests much slower; two journeys timed out
// on a first run, 2026-10-31). A made-up account, the main pages and the assistant once.
import { chromium, type FullConfig } from "@playwright/test";
import { BASE, api, owner, person } from "./journeys/helpers";

export default async function warmUp(config: FullConfig): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const me = await owner();
  const someone = await person("E2E Warm up");
  await api(me)("GET", "/groups");
  await api(me)("GET", "/me/notifications");
  await api(someone)("GET", "/collections");
  const executablePath = config.projects[0]?.use.launchOptions?.executablePath;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage();
  for (const path of ["/", "/updates", "/you", "/library"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
  }
  await browser.close();
}
