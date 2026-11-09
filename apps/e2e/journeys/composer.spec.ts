// The message box grows a line at a time as you write, to about eight lines, then scrolls
// inside, like Claude's (owner, 2026-11-01: "I can see only one at a time"); it shrinks back
// once sent or cleared. The assistant chat and a chat with people both.
import { expect, test, type Locator } from "@playwright/test";
import { RUN, api, introduce, openApp, openChat, owner, person } from "./helpers";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `E2E line ${i + 1} ${RUN}`).join("\n");
const height = async (box: Locator) => (await box.boundingBox())!.height;

async function grows(box: Locator) {
  await box.fill("one line");
  const one = await height(box);
  await box.fill(lines(4));
  // A line is about 22 points: four lines add three.
  await expect.poll(() => height(box)).toBeGreaterThanOrEqual(one + 3 * 20);
  await box.fill(lines(30));
  // Stops at about eight lines, then scrolls inside.
  await expect.poll(() => height(box)).toBeGreaterThanOrEqual(one + 6 * 20);
  expect(await height(box)).toBeLessThanOrEqual(185);
  await box.fill("");
  await expect.poll(() => height(box)).toBeLessThanOrEqual(one + 1);
}

test("the assistant's message box grows with what you write", async ({ browser }) => {
  const me = await owner();
  const { page, errors, context } = await openApp(browser, me);
  await page.getByRole("button", { name: "Open the chat" }).click();
  await grows(page.getByLabel("Message Gigspree"));
  expect(errors).toEqual([]);
  await context.close();
});

test("a chat's message box grows with what you write", async ({ browser }) => {
  const me = await owner();
  const friend = await person(`E2E Box friend ${RUN}`);
  await introduce(me, friend);
  const g = (await api(me)("POST", "/groups", {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase(),
    name: "",
    people: [friend.name],
    direct: true,
  })) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await openChat(page, g.id);
  await grows(page.getByLabel("Message", { exact: true }));
  expect(errors).toEqual([]);
  await context.close();
});
