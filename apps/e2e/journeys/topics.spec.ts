// Topics in a chat for two, and asking the assistant in one tap with what was typed
// (decision 2026-10-31 "Topics"; the owner: "typing @assistant every time is a little time
// consuming").
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, introduce, openApp, openChat, owner, person } from "./helpers";

test("a topic keeps its own messages, and closes and reopens", async ({ browser }) => {
  const me = await owner();
  const friend = await person(`E2E Topic friend ${RUN}`);
  await introduce(me, friend);
  const g = (await api(me)("POST", "/groups", {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase(),
    name: "",
    people: [friend.name],
    direct: true,
  })) as { id: string };

  const { page, errors, context } = await openApp(browser, me);
  await openChat(page, g.id);
  await page.getByRole("button", { name: "Start a topic" }).click();
  await page.getByLabel("Topic name").fill(`E2E Goa trip ${RUN}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(`Topic · E2E Goa trip ${RUN}`)).toBeVisible();
  await expectNoSideways(page);

  // A message in the topic stays out of General.
  await page.getByLabel("Message", { exact: true }).fill(`E2E train at 7 ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`E2E train at 7 ${RUN}`)).toBeVisible();
  await page.getByRole("button", { name: "General" }).click();
  await expect(page.getByText(`E2E train at 7 ${RUN}`)).toHaveCount(0);
  await page.getByRole("button", { name: `Topic: E2E Goa trip ${RUN}` }).click();
  await expect(page.getByText(`E2E train at 7 ${RUN}`)).toBeVisible();

  // Closed: it folds away under "Closed", and reopens from there.
  await page.getByRole("button", { name: "Close topic" }).click();
  await expect(page.getByRole("button", { name: `Topic: E2E Goa trip ${RUN}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Closed topics" }).click();
  await page.getByRole("button", { name: `Reopen E2E Goa trip ${RUN}` }).click();
  await expect(page.getByText(`Topic · E2E Goa trip ${RUN}`)).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("what you typed goes to your assistant with one tap", async ({ browser }) => {
  const me = await owner();
  const friend = await person(`E2E Ask friend ${RUN}`);
  await introduce(me, friend);
  const g = (await api(me)("POST", "/groups", {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase(),
    name: `E2E Flat ${RUN}`,
    people: [friend.name],
  })) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await openChat(page, g.id);
  const box = page.getByLabel("Message", { exact: true });
  await box.fill(`E2E what's still open ${RUN}`);
  await expect(box).toHaveValue(`E2E what's still open ${RUN}`);
  await page.getByRole("button", { name: "Ask your assistant privately what you typed" }).click();
  await expect(page.getByText(`E2E what's still open ${RUN}`)).toBeVisible();
  await expect(page.getByText(/\(\d\) OK/).last()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
  await context.close();
});

test("a chat kept on the phone before topics existed still opens", async ({ browser }) => {
  // Codex on PR 221: an older kept copy (no topics in it) crashed the chat on its first frame.
  const me = await owner();
  const friend = await person(`E2E Old copy friend ${RUN}`);
  await introduce(me, friend);
  const g = (await api(me)("POST", "/groups", {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase(),
    name: "",
    people: [friend.name],
    direct: true,
  })) as { id: string };
  await api(friend)("POST", `/groups/${g.id}/messages`, { text: `E2E from before ${RUN}` });
  const old = (await api(me)("GET", `/groups/${g.id}`)) as Record<string, unknown>;
  delete old.topics;
  delete old.topic;
  const { page, errors, context } = await openApp(browser, me);
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`gigspree@${me.id}:chat:${g.id}`, JSON.stringify(old)],
  );
  await page.goto(`/talk?id=${g.id}`);
  await expect(page.getByText(`E2E from before ${RUN}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "General" })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
