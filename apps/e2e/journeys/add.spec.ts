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

test("a record is changed and deleted on its own sheet, and the list follows", async ({ browser }) => {
  // Decision 2026-11-12 "A record is changed where it's opened".
  const me = await person(`E2E Changer ${RUN}`);
  const list = `E2E Repairs ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Item", type: "text" },
      { name: "Price", type: "money" },
      { name: "Qty", type: "number" },
      { name: "Notes", type: "text" },
    ],
  })) as { id: string };
  await api(me)("POST", `/collections/${made.id}/records`, {
    values: { Item: "E2E Tap washer", Price: "120", Qty: 3, Notes: "E2E from the corner shop" },
  });
  const find = async () =>
    (
      (await api(me)("POST", `/collections/${made.id}/find`, {})) as {
        items: { named: Record<string, unknown> }[];
      }
    ).items;
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${made.id}`);
  await page.getByRole("button", { name: "E2E Tap washer" }).last().click();
  await page.getByRole("button", { name: "Change this" }).click();
  // The form opens on what the record holds, money as people type it.
  await expect(page.getByRole("textbox", { name: "Item" })).toHaveValue("E2E Tap washer");
  await expect(page.getByRole("textbox", { name: "Price" })).toHaveValue("120");
  // A number shows as its digits (Codex on PR 236: it opened blank).
  await expect(page.getByRole("textbox", { name: "Qty" })).toHaveValue("3");
  // A wrong amount is said, and nothing changes.
  await page.getByRole("textbox", { name: "Price" }).fill("lots");
  await page
    .getByRole("button", { name: `Save to ${list}` })
    .last()
    .click();
  await expect(page.getByText(/is not an amount/)).toBeVisible();
  // A new name and amount, and the note cleared.
  await page.getByRole("textbox", { name: "Item" }).fill("E2E Tap washer, brass");
  await page.getByRole("textbox", { name: "Price" }).fill("145.50");
  await page.getByRole("textbox", { name: "Notes" }).fill("");
  await page
    .getByRole("button", { name: `Save to ${list}` })
    .last()
    .click();
  // The sheet and the row behind it show the change at once; the server has it too.
  await expect(page.getByText("E2E Tap washer, brass").last()).toBeVisible();
  await expect(page.getByText("₹145.50").last()).toBeVisible();
  await expect(page.getByText("E2E from the corner shop")).toHaveCount(0);
  await expect
    .poll(async () => (await find())[0]?.named)
    .toMatchObject({ Item: "E2E Tap washer, brass", Price: "₹145.50", Notes: null });
  // Delete asks first; Keep it leaves it; Delete takes it off the list and into Recently deleted.
  await page.getByRole("button", { name: "Delete this" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  expect(await find()).toHaveLength(1);
  await page.getByRole("button", { name: "Delete this" }).click();
  await page.getByRole("button", { name: "Delete E2E Tap washer, brass" }).click();
  await expect(page.getByRole("button", { name: "E2E Tap washer, brass" })).toHaveCount(0);
  await expect.poll(async () => (await find()).length).toBe(0);
  await page.goto(`/trash?collection=${made.id}`);
  await expect(page.getByText("E2E Tap washer, brass").last()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("every box of a record can be emptied, and a change made from the home shows there offline", async ({
  browser,
}) => {
  // Codex on PR 236: the new-record guard ("Fill in something first") refused to clear the
  // last filled box; and from the home only the open sheet followed a change.
  const me = await person(`E2E Home changer ${RUN}`);
  const list = `E2E Chores ${RUN}`;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "When", type: "date" },
      { name: "Notes", type: "text" },
    ],
  })) as { id: string };
  await api(me)("POST", `/collections/${made.id}/records`, {
    values: { Title: "E2E Water the plants", When: today, Notes: "E2E the balcony ones" },
  });
  const { page, errors, context } = await openApp(browser, me);
  const coming = page.getByLabel("Coming up");
  await expect(coming.getByText("E2E Water the plants")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await coming.getByRole("button", { name: /^E2E Water the plants/ }).click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("E2E Water the ferns");
  await page.getByRole("textbox", { name: "Notes" }).fill("");
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await expect(page.getByText("E2E the balcony ones")).toHaveCount(0);
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  // The home's row has the new name while the change still waits to be sent.
  await expect(coming.getByText("E2E Water the ferns")).toBeVisible();
  await expect(coming.getByText("E2E Water the plants")).toHaveCount(0);
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const r = (await api(me)("POST", `/collections/${made.id}/find`, {})) as {
        items: { named: Record<string, unknown> }[];
      };
      return r.items[0]?.named;
    })
    .toMatchObject({ Title: "E2E Water the ferns", Notes: null });
  // On a list with one filled box, emptying it is a change, not "Fill in something first".
  const one = (await api(me)("POST", "/collections", {
    name: `E2E One box ${RUN}`,
    fields: [
      { name: "Title", type: "text" },
      { name: "Notes", type: "text" },
    ],
  })) as { id: string };
  await api(me)("POST", `/collections/${one.id}/records`, { values: { Notes: "E2E only this" } });
  await page.goto(`/list?collection=${one.id}`);
  await page
    .getByRole("button", { name: /Untitled|E2E only this/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("");
  await page.getByRole("button", { name: `Save to E2E One box ${RUN}` }).click();
  await expect(page.getByText("Fill in something first.")).toHaveCount(0);
  await expect(page.getByText("E2E only this")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("a change made offline from the home reads as it will be kept: the amount, an emptied name, a moved day", async ({
  browser,
}) => {
  // Codex on PR 236: the row kept the old amount's words and an emptied name, and stayed
  // under "this week" after its day moved out of it.
  const me = await person(`E2E Home reader ${RUN}`);
  const list = `E2E Bills ${RUN}`;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "When", type: "date" },
      { name: "Amount", type: "money" },
    ],
  })) as { id: string };
  for (const title of ["E2E Water bill", "E2E Phone bill"])
    await api(me)("POST", `/collections/${made.id}/records`, {
      values: { Title: title, When: day(0), Amount: "100" },
    });
  const { page, errors, context } = await openApp(browser, me);
  const coming = page.getByLabel("Coming up");
  await expect(coming.getByText("E2E Water bill")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  const close = () =>
    page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  // A new amount and no name: the row says ₹200 and Untitled, as the server will keep it.
  await coming.getByRole("button", { name: /^E2E Water bill/ }).click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("");
  await page.getByRole("textbox", { name: "Amount" }).fill("200");
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await close();
  await expect(coming.getByText("E2E Water bill")).toHaveCount(0);
  await expect(coming.getByText("Untitled")).toBeVisible();
  await expect(coming.getByText(/₹200/)).toBeVisible();
  // A day moved to next month: no longer coming up this week.
  await coming.getByRole("button", { name: /^E2E Phone bill/ }).click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "When" }).fill(day(40));
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await close();
  await expect(coming.getByText("E2E Phone bill")).toHaveCount(0);
  // Out of the week and back on the same open sheet: the row is there again.
  await coming.getByRole("button", { name: /^Untitled/ }).click();
  for (const when of [day(40), day(1)]) {
    await page.getByRole("button", { name: "Change this" }).click();
    await page.getByRole("textbox", { name: "When" }).fill(when);
    await page.getByRole("button", { name: `Save to ${list}` }).click();
  }
  await close();
  await expect(coming.getByText("Untitled")).toBeVisible();
  await context.setOffline(false);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|offline/i.test(e))).toEqual([]);
  await context.close();
});

test("a delete that answers late doesn't close another record opened meanwhile", async ({ browser }) => {
  // Codex on PR 236: the first record's late answer closed whatever sheet was open by then.
  const me = await person(`E2E Late delete ${RUN}`);
  const list = `E2E Errands ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [{ name: "Title", type: "text" }],
  })) as { id: string };
  for (const title of ["E2E Post the parcel", "E2E Collect the keys"])
    await api(me)("POST", `/collections/${made.id}/records`, { values: { Title: title } });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${made.id}`);
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  let waiting = false;
  await page.route(/\/api\/records\//, async (route) => {
    if (route.request().method() === "DELETE") {
      waiting = true;
      await held;
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: /E2E Post the parcel/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete this" }).click();
  await page.getByRole("button", { name: "Delete E2E Post the parcel" }).click();
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  // The other one, opened and being changed while the delete is still on its way.
  await page
    .getByRole("button", { name: /E2E Collect the keys/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("E2E Collect the spare keys");
  expect(waiting).toBe(true);
  letGo();
  await expect(page.getByRole("button", { name: /E2E Post the parcel/ })).toHaveCount(0);
  // Its form is still open, with what was typed.
  await page.waitForTimeout(800);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("E2E Collect the spare keys");
  await expect(page.getByRole("textbox", { name: "Title" })).toBeInViewport();
  expect(errors).toEqual([]);
  await context.close();
});

test("a change made on a space's page stays there while it is still being sent", async ({ browser }) => {
  // Codex on PR 236: the page read again at once, and the server's older record replaced the
  // change until it was sent.
  const me = await person(`E2E Space changer ${RUN}`);
  const list = `E2E Visits ${RUN}`;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "When", type: "date" },
      { name: "Done", type: "boolean" },
    ],
  })) as { id: string };
  for (const title of ["E2E Meet the plumber", "E2E Return the ladder"])
    await api(me)("POST", `/collections/${made.id}/records`, { values: { Title: title, When: today } });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto("/space?id=p");
  await page.getByRole("tab", { name: /^Lists/ }).click();
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  let waiting = false;
  await page.route(/\/api\/records\//, async (route) => {
    if (route.request().method() === "PATCH") {
      waiting = true;
      await held;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Open E2E Meet the plumber" }).click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("E2E Meet the electrician");
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  // Long enough for the page's own read to come back with the server's older record.
  await page.waitForTimeout(2_000);
  expect(waiting).toBe(true);
  await expect(page.getByRole("button", { name: "Open E2E Meet the electrician" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open E2E Meet the plumber" })).toHaveCount(0);
  // Marked done on its sheet (Codex on PR 236): it isn't coming up any more, here either.
  await page.getByRole("button", { name: "Open E2E Return the ladder" }).click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("switch", { name: "Done" }).click();
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("button", { name: "Open E2E Return the ladder" })).toHaveCount(0);
  letGo();
  // Sent, and read again: still the new name.
  await expect
    .poll(async () => {
      const r = (await api(me)("POST", `/collections/${made.id}/find`, {})) as { items: { title: string }[] };
      return r.items.map((i) => i.title);
    })
    .toContain("E2E Meet the electrician");
  await expect(page.getByRole("button", { name: "Open E2E Meet the electrician" })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("a change made in the list shows on the home while it is still being sent", async ({ browser }) => {
  // Codex on PR 236: only the list followed; the home kept the old row until it was sent.
  const me = await person(`E2E List changer ${RUN}`);
  const list = `E2E Calls ${RUN}`;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "When", type: "date" },
    ],
  })) as { id: string };
  await api(me)("POST", `/collections/${made.id}/records`, {
    values: { Title: "E2E Ring the bank", When: today },
  });
  const { page, errors, context } = await openApp(browser, me);
  const coming = page.getByLabel("Coming up");
  await expect(coming.getByText("E2E Ring the bank")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/list?collection=${made.id}`);
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  await page.route(/\/api\/records\//, async (route) => {
    if (route.request().method() === "PATCH") await held;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: /E2E Ring the bank/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("E2E Ring the insurer");
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await expect(page.getByRole("button", { name: /E2E Ring the insurer/ }).last()).toBeVisible();
  // Back on the home, the change still on its way.
  await page.goto("/");
  await expect(coming.getByText("E2E Ring the insurer")).toBeVisible({ timeout: 30_000 });
  await expect(coming.getByText("E2E Ring the bank")).toHaveCount(0);
  letGo();
  await expect
    .poll(async () => {
      const r = (await api(me)("POST", `/collections/${made.id}/find`, {})) as { items: { title: string }[] };
      return r.items[0]?.title;
    })
    .toBe("E2E Ring the insurer");
  expect(errors).toEqual([]);
  await context.close();
});

test("a slow first read of a list doesn't bring back a record deleted meanwhile", async ({ browser }) => {
  // Codex on PR 236: the read had started before the delete, and its older rows were shown and kept.
  const me = await person(`E2E Slow list ${RUN}`);
  const list = `E2E Returns ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [{ name: "Title", type: "text" }],
  })) as { id: string };
  for (const title of ["E2E Return the drill", "E2E Return the books"])
    await api(me)("POST", `/collections/${made.id}/records`, { values: { Title: title } });
  const { page, errors, context } = await openApp(browser, me);
  // Once, so the phone keeps the rows.
  await page.goto(`/list?collection=${made.id}`);
  await expect(page.getByRole("button", { name: /E2E Return the drill/ }).last()).toBeVisible({
    timeout: 30_000,
  });
  // Again, with the first read answered late, with what the server had when it was asked.
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  let asked = false;
  await page.route(/\/find$/, async (route) => {
    if (asked) return route.continue();
    asked = true;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  // No live updates either (they'd read the list again and hide it): a phone on a poor line.
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.reload();
  await page
    .getByRole("button", { name: /E2E Return the drill/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete this" }).click();
  await page.getByRole("button", { name: "Delete E2E Return the drill" }).click();
  await expect(page.getByRole("button", { name: /E2E Return the drill/ })).toHaveCount(0);
  expect(asked).toBe(true);
  letGo();
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("button", { name: /E2E Return the drill/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /E2E Return the books/ }).last()).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("a list's total on the home moves with an amount changed in the list", async ({ browser }) => {
  // Codex on PR 236: the row said the new amount under a total still saying the old one.
  const me = await person(`E2E Totals ${RUN}`);
  const list = `E2E Groceries ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Amount", type: "money" },
      { name: "Bought", type: "boolean" },
    ],
  })) as { id: string };
  for (const [title, amount] of [
    ["E2E Tea", "100"],
    ["E2E Rice", "250"],
  ] as const)
    await api(me)("POST", `/collections/${made.id}/records`, { values: { Title: title, Amount: amount } });
  const { page, errors, context } = await openApp(browser, me);
  const card = page.getByLabel(list, { exact: true });
  await expect(card.getByText("₹350")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/list?collection=${made.id}`);
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  await page.route(/\/api\/records\//, async (route) => {
    if (route.request().method() === "PATCH") await held;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: /E2E Tea/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("200");
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  // Back on the home with the change still on its way: the total has moved with it.
  await page.goto("/");
  await expect(card.getByText("₹450")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("left · 2 to do")).toBeVisible();
  letGo();
  expect(errors).toEqual([]);
  await context.close();
});

test("a record deleted on its sheet and then restored shows in the list again", async ({ browser }) => {
  // Codex on PR 236: the list went on leaving out a record it had seen deleted, even once restored.
  const me = await person(`E2E Restorer ${RUN}`);
  const list = `E2E Loans ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [{ name: "Title", type: "text" }],
  })) as { id: string };
  const lent = (await api(me)("POST", `/collections/${made.id}/records`, {
    values: { Title: "E2E Lent the tent" },
  })) as { id: string };
  await api(me)("POST", `/collections/${made.id}/records`, { values: { Title: "E2E Lent the stove" } });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${made.id}`);
  await page
    .getByRole("button", { name: /E2E Lent the tent/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete this" }).click();
  await page.getByRole("button", { name: "Delete E2E Lent the tent" }).click();
  await expect(page.getByRole("button", { name: /E2E Lent the tent/ })).toHaveCount(0);
  // Brought back (as Recently deleted does); the list hears of it and reads again.
  await api(me)("POST", `/trash/${lent.id}/restore`, {});
  await expect(page.getByRole("button", { name: /E2E Lent the tent/ }).last()).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
  await context.close();
});

test("a change that is sent before a slow first read answers isn't undone by it", async ({ browser }) => {
  // Codex on PR 236: with nothing left waiting, the older answer was taken as newer than the change.
  const me = await person(`E2E Slow reader ${RUN}`);
  const list = `E2E Repairs ${RUN}`;
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [{ name: "Title", type: "text" }],
  })) as { id: string };
  await api(me)("POST", `/collections/${made.id}/records`, { values: { Title: "E2E Fix the tap" } });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${made.id}`);
  await expect(page.getByRole("button", { name: /E2E Fix the tap/ }).last()).toBeVisible({ timeout: 30_000 });
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  let asked = false;
  await page.route(/\/find$/, async (route) => {
    if (asked) return route.continue();
    asked = true;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.reload();
  await page
    .getByRole("button", { name: /E2E Fix the tap/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("E2E Fix the shower");
  const sent = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/api\/records\//.test(r.url()),
  );
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await sent;
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  expect(asked).toBe(true);
  letGo();
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("button", { name: /E2E Fix the shower/ }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E Fix the tap/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("a change made on the home is in the list's kept page when the list can't be read", async ({
  browser,
}) => {
  // Codex on PR 236: the list opened on the record as it was, and kept it when the read failed.
  const me = await person(`E2E Kept page ${RUN}`);
  const list = `E2E Pickups ${RUN}`;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const made = (await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "When", type: "date" },
    ],
  })) as { id: string };
  await api(me)("POST", `/collections/${made.id}/records`, {
    values: { Title: "E2E Collect the cake", When: today },
  });
  const { page, errors, context } = await openApp(browser, me);
  // The list once, so the phone keeps its page; then the home.
  await page.goto(`/list?collection=${made.id}`);
  await expect(page.getByRole("button", { name: /E2E Collect the cake/ }).last()).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/");
  const coming = page.getByLabel("Coming up");
  await expect(coming.getByText("E2E Collect the cake")).toBeVisible({ timeout: 30_000 });
  let letGo: () => void = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  await page.route(/\/api\/records\//, async (route) => {
    if (route.request().method() === "PATCH") await held;
    await route.continue().catch(() => {});
  });
  await coming.getByRole("button", { name: /^E2E Collect the cake/ }).click();
  await page.getByRole("button", { name: "Change this" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("E2E Collect the flowers");
  await page.getByRole("button", { name: `Save to ${list}` }).click();
  await page.getByRole("button", { name: "Bottom sheet backdrop" }).click({ position: { x: 20, y: 20 } });
  await expect(coming.getByText("E2E Collect the flowers")).toBeVisible();
  // The list, with its records unreadable (a dead line): what the phone kept has the change.
  await page.route(/\/find$/, (route) => route.abort());
  await page.goto(`/list?collection=${made.id}`);
  await expect(page.getByRole("button", { name: /E2E Collect the flowers/ }).last()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /E2E Collect the cake/ })).toHaveCount(0);
  letGo();
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|offline|ERR_FAILED/i.test(e))).toEqual([]);
  await context.close();
});
