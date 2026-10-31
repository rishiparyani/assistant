// Chats, the first screen: its two buttons, its filters, and search (docs/design/chats-base.md
// step 1). Light and dark.
import { expect, test } from "@playwright/test";
import { RUN, api, bell, expectNoSideways, openApp, owner } from "./helpers";

for (const dark of [false, true])
  test(`Chats has only the bell and your face, and All · Unread (${dark ? "dark" : "light"})`, async ({
    browser,
  }) => {
    const me = await owner();
    const { page, errors, context } = await openApp(browser, me, { dark });
    await expect(bell(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /^You:/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Help", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Library", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unread", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spaces", exact: true })).toHaveCount(0);
    await expectNoSideways(page);
    expect(errors).toEqual([]);
    await context.close();
  });

test("search finds a list by its name", async ({ browser }) => {
  const me = await owner();
  const name = `E2E Groceries ${RUN}`;
  await api(me)("POST", "/collections", { name, fields: [{ name: "Title", type: "text" }] });
  const { page, errors, context } = await openApp(browser, me);
  // The box waits above the list (pulled down to show); bring it into view once Chats settles.
  const box = page.getByPlaceholder("Search chats, people and lists");
  await expect(box).toBeAttached();
  await page.waitForTimeout(800);
  await box.evaluate((el) => el.scrollIntoView());
  await box.fill(`Groceries ${RUN}`);
  await expect(page.getByText(name).first()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
