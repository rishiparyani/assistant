// The assistant chat: a message goes out and the reply comes back (the test server's stand-in
// model answers "(<level>) OK" to anything it has no script for).
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, owner } from "./helpers";

test("you ask the assistant and it answers", async ({ browser }) => {
  const me = await owner();
  const { page, errors, context } = await openApp(browser, me);
  await page.getByRole("button", { name: /^Assistant/ }).click();
  const box = page.getByLabel("Message Gigspree");
  await box.fill(`Hello from the journeys ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`Hello from the journeys ${RUN}`)).toBeVisible();
  await expect(page.getByText(/\(\d\) OK/).last()).toBeVisible({ timeout: 30_000 });
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a long chat opens at its newest message, and a new one shows at once", async ({ browser }) => {
  // Owner, 2026-11-01: in the iPhone's chat sheet the list was drawn upside down, so a pull up at
  // the newest message read as a pull down at the top and the sheet started to close. Right way
  // up now, it must still open at the end (owner, 2026-10-16: "it opens at the middle") and keep
  // the person's own message in sight ("it scrolled up and hid my message").
  const me = await owner();
  const { id } = (await api(me)("POST", "/chats", {})) as { id: string };
  for (let i = 1; i <= 12; i++) await api(me)("POST", `/chats/${id}`, { text: `E2E long ${i} ${RUN}` });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/chat?id=${id}`);
  await expect(page.getByText(`E2E long 12 ${RUN}`)).toBeInViewport();
  // The first message (its title above names it too) is out of sight, up the conversation.
  await expect(page.getByText(`E2E long 1 ${RUN}`, { exact: true }).last()).not.toBeInViewport();
  await page.getByLabel("Message Gigspree").fill(`E2E newest ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`E2E newest ${RUN}`)).toBeInViewport();
  await expect(page.getByText(/\(\d\) OK/).last()).toBeInViewport({ timeout: 30_000 });
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a message sent offline is answered on screen once it goes", async ({ browser }) => {
  // Owner, 2026-11-01: "it said it will send the message as soon as I get online, and when I got
  // online, nothing happened": the message went, but the chat didn't show the reply.
  const me = await owner();
  const { id } = (await api(me)("POST", "/chats", {})) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/chat?id=${id}`);
  await expect(page.getByLabel("Message Gigspree")).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel("Message Gigspree").fill(`E2E while offline ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Waiting to send/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/\(\d\) OK/).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Waiting to send/)).toHaveCount(0);
  // Sent once, not twice (the chat's title above repeats its first message, so ask the server).
  const chat = (await api(me)("GET", `/chats/${id}`)) as { items: { role: string; text: string }[] };
  expect(
    chat.items.filter((i) => i.role === "user" && i.text.includes(`E2E while offline ${RUN}`)),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
  await context.close();
});

test("what's made in another space shows in the chat, not as gone", async ({ browser }) => {
  // Owner, 2026-11-01: flows made in "Society gate" from his own chat showed "This one is gone now".
  const me = await owner();
  // The same space on every run (a person has up to 20).
  const spaces = (await api(me)("GET", "/spaces")) as { id: string; name: string }[];
  const band =
    spaces.find((s) => s.name === "Test band") ??
    ((await api(me)("POST", "/spaces", { name: "Test band" })) as { id: string });
  await api(me)("POST", "/collections", {
    space: band.id,
    name: "Notes",
    fields: [{ name: "Title", type: "text" }],
  }).catch(() => undefined);
  const { id } = (await api(me)("POST", "/chats", {})) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/chat?id=${id}`);
  await page.getByLabel("Message Gigspree").fill("Test: note in the band");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Test bring cables").last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This one is gone now.")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
