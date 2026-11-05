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

test("the chat's top bar lines up, holds a long title, and the chat doesn't show through it", async ({
  browser,
}) => {
  // Owner, 2026-11-05: the top bar "doesn't look that good… things are not neatly placed" (the
  // model's line hung below the bar over the chat; text glyphs sat at different heights).
  const me = await owner();
  const { id } = (await api(me)("POST", "/chats", {})) as { id: string };
  for (let i = 1; i <= 8; i++)
    await api(me)("POST", `/chats/${id}`, { text: `E2E a long first message that becomes the title ${i}` });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/chat?id=${id}`);
  const title = page.getByRole("button", { name: /Model: Claude Sonnet 5\.5\. Options/ });
  await expect(title).toBeVisible({ timeout: 30_000 });
  // The top bar's own button of that name: the highest one on the screen.
  const box = async (name: string) => {
    const all = await page.getByRole("button", { name, exact: true }).all();
    const boxes = (await Promise.all(all.map((b) => b.boundingBox()))).filter((b) => b !== null);
    return boxes.sort((a, b) => a.y - b.y)[0]!;
  };
  const [back, mid, chats, fresh] = await Promise.all([
    box("Back"),
    title.boundingBox().then((b) => b!),
    box("Chats"),
    box("New chat"),
  ]);
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const b of [mid, chats, fresh]) expect(Math.abs(centre(b) - centre(back))).toBeLessThanOrEqual(2);
  // The model's line is inside the bar: nothing below the buttons' row.
  const model = (await page.getByText("Claude Sonnet 5.5", { exact: true }).first().boundingBox())!;
  expect(model.y + model.height).toBeLessThanOrEqual(back.y + back.height + 12);
  // What's under the bar isn't seen through it: the point just above its bottom edge is the bar.
  const inBar = await page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      const bar = [...document.querySelectorAll('[aria-label="Back"]')].sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      )[0]?.parentElement;
      return !!hit && !!bar && bar.contains(hit);
    },
    [200, back.y + back.height + 4],
  );
  expect(inBar).toBe(true);
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
