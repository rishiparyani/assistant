// The assistant chat: a message goes out and the reply comes back (the test server's stand-in
// model answers "(<level>) OK" to anything it has no script for).
import { expect, test } from "@playwright/test";
import { RUN, expectNoSideways, openApp, owner } from "./helpers";

test("you ask the assistant and it answers", async ({ browser }) => {
  const me = await owner();
  const { page, errors, context } = await openApp(browser, me);
  await page.getByRole("button", { name: /^Assistant/ }).click();
  const box = page.getByLabel("Message Gigspree");
  await box.fill(`Hello from the journeys ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`Hello from the journeys ${RUN}`)).toBeVisible();
  await expect(page.getByText(/\(\d\) OK/).last()).toBeVisible({ timeout: 30_000 });
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
