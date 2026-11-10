// The list and space screens after the calmer look (decision 2026-11-09 "A calmer look, and a
// home that shows your day"): a list says what it comes to up front and suggests things to ask;
// a space keeps everything about itself behind one gear, and its empty tabs say what to do.
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, owner, person } from "./helpers";

test("a list says what's left up front, and it follows the ticks", async ({ browser }) => {
  const me = await person(`E2E Sum person ${RUN}`);
  const list = `E2E Market ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Amount", type: "money" },
      { name: "Bought", type: "boolean" },
    ],
  });
  for (const [title, amount, bought] of [
    ["E2E Tea", "100", false],
    ["E2E Rice", "250", false],
    ["E2E Salt", "40", true],
  ] as const)
    await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
      values: { Title: title, Amount: amount, Bought: bought },
    });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${encodeURIComponent(list)}`);
  const sum = page.getByLabel("Summary", { exact: true });
  await expect(sum.getByText("₹350")).toBeVisible({ timeout: 30_000 });
  await expect(sum.getByText("left · 2 of 3 to do")).toBeVisible();
  await page.getByRole("checkbox", { name: "Done: E2E Tea" }).click();
  await expect(sum.getByText("₹250")).toBeVisible();
  await expect(sum.getByText("left · 1 of 3 to do")).toBeVisible();
  // Someone without the assistant isn't shown things to ask it.
  await expect(page.getByRole("button", { name: /^Ask: / })).toHaveCount(0);
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a list suggests things to ask, and one opens the chat about that list", async ({ browser }) => {
  const me = await owner();
  const list = `E2E Plants ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: "E2E Fern" },
  });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${encodeURIComponent(list)}`);
  await expect(page.getByText("E2E Fern")).toBeVisible({ timeout: 30_000 });
  // No tick box or date on it yet, so those are what it offers.
  await expect(page.getByRole("button", { name: "Ask: Add a tick box" })).toBeVisible();
  await page.getByRole("button", { name: "Ask: Add a date to these" }).click();
  // In the chat's box, to finish and send; nothing is sent by the tap.
  await expect(page.getByLabel("Message Gigspree")).toHaveValue(/Add a date to these/, { timeout: 30_000 });
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a space's settings are behind one gear, and an empty tab says what to do", async ({ browser }) => {
  const me = await person(`E2E Gear person ${RUN}`);
  const { page, errors, context } = await openApp(browser, me);
  await page.goto("/space?id=p");
  await page.getByRole("tab", { name: "Flows" }).click();
  await expect(page.getByText("No flows here yet")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Space settings" }).click();
  await expect(page.getByText("Personal is yours alone and can't be deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this space" })).toHaveCount(0);
  await page.getByRole("button", { name: "Recently deleted" }).click();
  await expect(page).toHaveURL(/\/trash/);
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a tight row writes its date whole, and a list that comes to less than nothing says so", async ({
  browser,
}) => {
  // Codex on PR 233: without the date tile a row said only "Fri"; a total of -₹500 showed as a count.
  const me = await person(`E2E Dates person ${RUN}`);
  const list = `E2E Refunds ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Amount", type: "money" },
      { name: "When", type: "date" },
    ],
  });
  const when = new Date(Date.now() + 3 * 86_400_000 + 330 * 60_000);
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: "E2E Returned kettle", Amount: "-500", When: when.toISOString().slice(0, 10) },
  });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${encodeURIComponent(list)}`);
  await expect(page.getByText("E2E Returned kettle")).toBeVisible({ timeout: 30_000 });
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    when.getUTCMonth()
  ];
  await expect(page.getByText(new RegExp(`\\b${when.getUTCDate()} ${month}\\b`)).first()).toBeVisible();
  await expect(page.getByLabel("Summary", { exact: true }).getByText(/-₹500|₹-500|−₹500/)).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("the bar at the bottom names the list by its name, never its id; an empty list says how to start", async ({
  browser,
}) => {
  // The visual review (2026-11-10): "Ask about 01M71E…" on a list's fields screen.
  const me = await owner();
  const list = `E2E Named ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [{ name: "Title", type: "text" }],
  })) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/setup?collection=${made.id}`);
  await expect(page.getByPlaceholder(`Ask about ${list}`).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder(new RegExp(made.id))).toHaveCount(0);
  await page.goto(`/list?collection=${made.id}`);
  await expect(page.getByText("Nothing here yet. + Add puts the first one in.").last()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
