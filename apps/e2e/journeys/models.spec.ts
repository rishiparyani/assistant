// The model picker (decision 2026-11-04 "Pick a model, it does the whole job"): the chat says
// which model answers, by name, and the picker lists the models by name.
import { expect, test } from "@playwright/test";
import { api, expectNoSideways, openApp, owner } from "./helpers";

test("the chat names its model, and the picker lists them by name", async ({ browser }) => {
  const me = await owner();
  const { id } = (await api(me)("POST", "/chats", {})) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/chat?id=${id}`);
  const title = page.getByRole("button", { name: /Model: Claude Sonnet 5\.5\. Options/ });
  await expect(title).toBeVisible({ timeout: 30_000 });
  await title.click();
  for (const name of ["Claude Sonnet 5.5", "GPT-6.1 Sol", "Claude Haiku 5.5", "GPT-6 Luna"])
    await expect(page.getByRole("radio", { name: new RegExp(name.replace(/\./g, "\\.")) })).toBeVisible();
  await expect(page.getByText(/^(Auto|Quick|Careful)$/)).toHaveCount(0);
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
