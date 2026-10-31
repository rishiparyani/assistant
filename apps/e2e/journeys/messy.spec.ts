// A messy account (made-up): many lists with long names, long rows. Every main screen still fits
// the phone and nothing crashes.
import { expect, test } from "@playwright/test";
import { RUN, api, bell, expectNoSideways, openApp, person } from "./helpers";

const LONG = "a very long name that keeps going well past the width of any phone screen";

test("a messy account still fits the phone on every main screen", async ({ browser }) => {
  const me = await person(`E2E Messy person with an unusually long name ${RUN}`);
  const call = api(me);
  for (let i = 1; i <= 24; i++)
    await call("POST", "/collections", {
      name: `E2E list ${i} with ${LONG} ${RUN}`.slice(0, 80),
      fields: [
        { name: "Title", type: "text" },
        { name: "Amount", type: "number" },
      ],
    });
  const first = `E2E list 1 with ${LONG} ${RUN}`.slice(0, 80);
  for (let i = 1; i <= 15; i++)
    await call("POST", `/collections/${encodeURIComponent(first)}/records`, {
      values: { Title: `Row ${i}: ${LONG} ${LONG}`, Amount: 1234567 * i },
    });

  const { page, errors, context } = await openApp(browser, me);
  await expectNoSideways(page);
  await bell(page).click();
  await expect(page.getByText("NEEDS YOU", { exact: true })).toBeVisible();
  await expectNoSideways(page);
  await page.goto("/you");
  await expect(page.getByText("ACCOUNTS ON THIS DEVICE")).toBeVisible();
  await expectNoSideways(page);
  await page.goto("/library");
  await expect(page.getByText(first).first()).toBeVisible();
  await expectNoSideways(page);
  // A list named past a card title's 60 letters used to open blank (found by this journey).
  await page.getByText(first).first().click();
  await expect(page.getByText(/Row 15:/).first()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
