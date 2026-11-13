// The home shows the day (decision 2026-11-09 "A calmer look, and a home that shows your day"):
// what's coming up and each list with a tick box, ticked right there; what needs me, answered
// right there. The things themselves, not the folders they're in.
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, introduce, openApp, owner, person } from "./helpers";

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

test("a list with a saved view, and one with a long done history, still show on the home", async ({
  browser,
}) => {
  // Codex on PR 232: a list with a saved view had no card; sixty done rows hid the open one.
  test.setTimeout(120_000);
  const me = await person(`E2E Views person ${RUN}`);
  const viewed = `E2E Packing ${RUN}`;
  const long = `E2E Errands ${RUN}`;
  for (const name of [viewed, long])
    await api(me)("POST", "/collections", {
      name,
      fields: [
        { name: "Title", type: "text" },
        { name: "Done", type: "boolean" },
      ],
    });
  await api(me)("POST", `/collections/${encodeURIComponent(viewed)}/records`, {
    values: { Title: "E2E Torch" },
  });
  await api(me)("POST", "/views", { name: `E2E Packing view ${RUN}`, collection: viewed });
  // The open one is the oldest, behind more done ones than the home reads.
  await api(me)("POST", `/collections/${encodeURIComponent(long)}/records`, {
    values: { Title: "E2E Post the letter" },
  });
  for (let i = 0; i < 62; i++)
    await api(me)("POST", `/collections/${encodeURIComponent(long)}/records`, {
      values: { Title: `E2E done ${i}`, Done: true },
    });

  const { page, errors, context } = await openApp(browser, me);
  await expect(page.getByLabel(viewed, { exact: true }).getByText("E2E Torch")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel(long, { exact: true }).getByText("E2E Post the letter")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("a tick made offline is still there after looking at Unread", async ({ browser }) => {
  // Codex on PR 232: the day was rebuilt from the older read, so the row looked unticked and a
  // second tap queued "done" again.
  const me = await person(`E2E Offline tick ${RUN}`);
  const list = `E2E Tasks ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Done", type: "boolean" },
    ],
  });
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: "E2E Water the plants" },
  });
  const { page, errors, context } = await openApp(browser, me);
  const card = page.getByLabel(list, { exact: true });
  await expect(card.getByText("E2E Water the plants")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await card.getByRole("checkbox", { name: "Done: E2E Water the plants" }).click();
  await expect(card.getByRole("checkbox", { name: "Not done: E2E Water the plants" })).toBeVisible();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(card.getByRole("checkbox", { name: "Not done: E2E Water the plants" })).toBeVisible();
  await context.setOffline(false);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|offline/i.test(e))).toEqual([]);
  await context.close();
});

test("the home's bar opens the chat that was last open", async ({ browser }) => {
  // Codex on PR 232: after a chat in another space, the home's empty bar opened Personal's.
  test.setTimeout(90_000);
  const me = await owner();
  const spaces = (await api(me)("GET", "/spaces")) as { id: string; name: string }[];
  const band =
    spaces.find((s) => s.name === "Test band") ??
    ((await api(me)("POST", "/spaces", { name: "Test band" })) as { id: string });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/space?id=${band.id}`);
  const bar = page.getByLabel("Ask about Test band");
  await bar.fill(`E2E said in the space ${RUN}`);
  await bar.press("Enter");
  await expect(page.getByText(`E2E said in the space ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\(\d\) OK/).last()).toBeVisible({ timeout: 30_000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the chat" }).click();
  await expect(page.getByText(`E2E said in the space ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
  await context.close();
});

test("done things don't crowd what's open off the home", async ({ browser }) => {
  // Codex on PR 232: six done dated rows hid the open seventh; four finished lists hid the fifth.
  test.setTimeout(120_000);
  const me = await person(`E2E Crowded person ${RUN}`);
  const fields = [
    { name: "Title", type: "text" },
    { name: "Done", type: "boolean" },
  ];
  const dated = `E2E Appointments ${RUN}`;
  await api(me)("POST", "/collections", { name: dated, fields: [...fields, { name: "When", type: "date" }] });
  for (let i = 0; i < 7; i++)
    await api(me)("POST", `/collections/${encodeURIComponent(dated)}/records`, {
      values: { Title: `E2E earlier ${i}`, When: day(1), Done: true },
    });
  await api(me)("POST", `/collections/${encodeURIComponent(dated)}/records`, {
    values: { Title: `E2E Dentist ${RUN}`, When: day(3) },
  });
  // Four lists with everything done, then one with something open.
  for (const n of ["A", "B", "C", "D", "E"]) {
    const name = `E2E List ${n} ${RUN}`;
    await api(me)("POST", "/collections", { name, fields });
    await api(me)("POST", `/collections/${encodeURIComponent(name)}/records`, {
      values: { Title: n === "E" ? `E2E Still open ${RUN}` : `E2E finished ${n}`, Done: n !== "E" },
    });
  }
  const { page, errors, context } = await openApp(browser, me);
  await expect(page.getByLabel("Coming up", { exact: true }).getByText(`E2E Dentist ${RUN}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`E2E Still open ${RUN}`)).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("a new person's home offers things to start with, and one tap asks the assistant for it", async ({
  browser,
}) => {
  // Decision 2026-11-12 "A first home with things to start".
  const admin = await owner();
  const me = await person(`E2E Newcomer ${RUN}`);
  await introduce(admin, me);
  await api(admin)("PUT", `/assistant/people/${me.id}`, { on: true });
  const { page, errors, context } = await openApp(browser, me);
  const start = page.getByLabel("Start with");
  await expect(start.getByText("What would you like to keep track of?")).toBeVisible({ timeout: 30_000 });
  await expect(start.getByRole("button", { name: /^Start: / })).toHaveCount(4);
  await expectNoSideways(page);
  await start.getByRole("button", { name: "Start: Things to remember" }).click();
  // The whole request is sent as it is; the chat opens on it.
  await expect(
    page.getByText("Start a reminders list with a title, a date and a tick box for done.").last(),
  ).toBeVisible({ timeout: 30_000 });
  // Once something exists, the home is the day again, not the first look.
  await api(me)("POST", "/collections", {
    name: `E2E First ${RUN}`,
    fields: [{ name: "Title", type: "text" }],
  });
  await page.goto("/");
  await expect(page.getByText("Chats", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Start with")).toHaveCount(0, { timeout: 30_000 });
  expect(errors).toEqual([]);
  await context.close();
});
