// Adding to a list from its own form, the most used thing in the app (the test pass of
// 2026-11-10 found an empty form saved a blank "Untitled", and ₹1,250.50 written "₹1,250.5").
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, person } from "./helpers";

test("the add form refuses an empty or wrong entry, adds a right one, and money is written whole", async ({
  browser,
}) => {
  const me = await person(`E2E Adder ${RUN}`);
  const list = `E2E Shopping ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Item", type: "text" },
      { name: "Price", type: "money" },
      { name: "By", type: "date" },
      { name: "Got", type: "boolean" },
    ],
  })) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${made.id}`);
  const add = page.getByRole("button", { name: `Add to ${list}` });
  await add.first().click();
  const item = page.getByRole("textbox", { name: "Item" });
  await expect(item).toBeVisible();
  // Nothing filled in: nothing is added.
  await add.last().click();
  await expect(page.getByText("Fill in something first.")).toBeVisible();
  // A wrong amount, then a wrong date: said under the box, nothing added.
  await item.fill("E2E Gasket");
  await page.getByRole("textbox", { name: "Price" }).fill("abc");
  await add.last().click();
  await expect(page.getByText(/is not an amount/)).toBeVisible();
  await page.getByRole("textbox", { name: "Price" }).fill("1,250.50");
  await page.getByRole("textbox", { name: "By" }).fill("sometime");
  await add.last().click();
  await expect(page.getByText(/expected a date/)).toBeVisible();
  const count = async () =>
    ((await api(me)("POST", `/collections/${made.id}/find`, {})) as { items: unknown[] }).items.length;
  expect(await count()).toBe(0);
  // Right: it's added once, and shows at once with its amount whole.
  await page.getByRole("button", { name: "Today" }).click();
  await add.last().click();
  await expect(page.getByText(/Added “E2E Gasket”/)).toBeVisible();
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  await expect(page.getByText("E2E Gasket").last()).toBeVisible();
  await expect(page.getByText("₹1,250.50").last()).toBeVisible();
  await expect(page.getByText("₹1,250.5", { exact: true })).toHaveCount(0);
  await expect.poll(count).toBe(1);
  await expect(page.getByText("Untitled")).toHaveCount(0);
  // Opened, the record says the same.
  await page.getByRole("button", { name: "E2E Gasket" }).last().click();
  await expect(page.getByText("₹1,250.50").last()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
