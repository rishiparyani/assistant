// You (your face): Help and the Library live here; adding a second account and switching back.
import { expect, test } from "@playwright/test";
import { RUN, expectNoSideways, openApp, owner, person } from "./helpers";

test("You has Help and the Library", async ({ browser }) => {
  const me = await owner();
  const { page, errors, context } = await openApp(browser, me);
  await page.getByRole("button", { name: /^You:/ }).click();
  await page.getByText("Help", { exact: true }).click();
  await expect(page.getByText("Take the tour again")).toBeVisible();
  await page.goto("/you");
  await page.getByText("Library", { exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByText("Library", { exact: true }).locator("visible=true").first()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a second account is added and you switch back to the first", async ({ browser }) => {
  const first = await person(`E2E First ${RUN}`);
  const second = await person(`E2E Second ${RUN}`);
  const { page, errors, context } = await openApp(browser, first);
  await page.getByRole("button", { name: /^You:/ }).click();
  await page.getByText("Add another account").click();
  await page.getByLabel("Email").fill(second.email);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByText("Sign in (test)").click();
  await expect(page.getByRole("button", { name: new RegExp(`^You: ${second.name}`) })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /^You:/ }).click();
  await page.getByRole("button", { name: `Switch to ${first.name}` }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^You: ${first.name}`) })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
  await context.close();
});
