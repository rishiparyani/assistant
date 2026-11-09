// The home shows the day (decision 2026-11-09 "A calmer look, and a home that shows your day"):
// what's coming up and each list with a tick box, ticked right there; what needs me, answered
// right there. The things themselves, not the folders they're in.
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, person } from "./helpers";

const day = (n: number) => new Date(Date.now() + n * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

test("the home shows the day, and things are ticked on it", async ({ browser }) => {
  test.setTimeout(90_000);
  const me = await person(`E2E Day person ${RUN}`);
  const shop = `E2E Shopping ${RUN}`;
  const todo = `E2E Chores ${RUN}`;
  await api(me)("POST", "/collections", {
    name: shop,
    fields: [
      { name: "Title", type: "text" },
      { name: "Amount", type: "money" },
      { name: "Bought", type: "boolean" },
    ],
  });
  const ids: Record<string, string> = {};
  for (const [title, amount] of [
    ["E2E Tea", "100"],
    ["E2E Rice", "250"],
  ] as const)
    ids[title] = (
      (await api(me)("POST", `/collections/${encodeURIComponent(shop)}/records`, {
        values: { Title: title, Amount: amount },
      })) as { id: string }
    ).id;
  await api(me)("POST", "/collections", {
    name: todo,
    fields: [
      { name: "Title", type: "text" },
      { name: "When", type: "date" },
      { name: "Done", type: "boolean" },
    ],
  });
  const chore = (await api(me)("POST", `/collections/${encodeURIComponent(todo)}/records`, {
    values: { Title: `E2E Call the plumber ${RUN}`, When: day(0) },
  })) as { id: string };

  const { page, errors, context } = await openApp(browser, me);
  // The shopping list as it stands: what's left adds up, and the first rows are there.
  const card = page.getByLabel(shop, { exact: true });
  await expect(card.getByText("₹350")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("left · 2 to do")).toBeVisible();
  // Ticked here: the sum comes down at once, and the list has it.
  await card.getByRole("checkbox", { name: "Done: E2E Tea" }).click();
  // (The total, first; the rice row costs the same.)
  await expect(card.getByText("₹250").first()).toBeVisible();
  await expect(card.getByText("left · 1 to do")).toBeVisible();
  const values = async (id: string) =>
    Object.values(((await api(me)("GET", `/records/${id}`)) as { values: Record<string, unknown> }).values);
  await expect.poll(() => values(ids["E2E Tea"]!)).toContain(true);

  // Today's chore is under Coming up, and is ticked there too.
  const coming = page.getByLabel("Coming up", { exact: true });
  await expect(coming.getByText(`E2E Call the plumber ${RUN}`)).toBeVisible();
  await coming.getByRole("checkbox", { name: `Done: E2E Call the plumber ${RUN}` }).click();
  await expect.poll(() => values(chore.id)).toContain(true);
  // A list with dates isn't shown a second time as a card of its own.
  await expect(page.getByLabel(todo, { exact: true })).toHaveCount(0);

  await expectNoSideways(page);
  // After a fresh read the ticked ones are gone from the day.
  await page.reload();
  await expect(page.getByLabel(shop, { exact: true }).getByText("left · 1 to do")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`E2E Call the plumber ${RUN}`)).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("an empty day says so, in light and dark", async ({ browser }) => {
  const me = await person(`E2E Empty day ${RUN}`);
  for (const dark of [false, true]) {
    const { page, errors, context } = await openApp(browser, me, { dark });
    await expect(page.getByText("Nothing needs you today")).toBeVisible({ timeout: 30_000 });
    await expectNoSideways(page);
    expect(errors).toEqual([]);
    await context.close();
  }
});
