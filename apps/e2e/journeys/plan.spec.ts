// A setup is one plan (decision 2026-11-10): a space of its own, its lists and the flows on them
// come as one card, made by one tap, and what was made is ticked off with a way into each.
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, owner } from "./helpers";

test("one card proposes a space, its list and its flow; one tap makes them all", async ({ browser }) => {
  const me = await owner();
  const name = `Test front desk ${RUN}`;
  const { id } = (await api(me)("POST", "/chats", {})) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/chat?id=${id}`);
  await page.getByLabel("Message Gigspree").fill(`Test: make a front desk ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();

  // The plan, in the order it's made, before anything exists.
  const plan = page.getByLabel("The plan").last();
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan).toContainText("One tap makes all of it");
  await expect(plan).toContainText(`A new space, “${name}”`);
  await expect(plan).toContainText("1 list, Test visitors");
  await expect(plan).toContainText("1 flow, Test tell me about visitors");
  // The flow is drawn on the same card, acted out on a list that isn't there yet.
  await expect(page.getByLabel("Flow: Test tell me about visitors").last()).toBeVisible();
  await expect(page.getByText(/is at the desk for/).first()).toBeVisible();
  const spaces = async () => ((await api(me)("GET", "/spaces")) as { id: string; name: string }[]) ?? [];
  expect((await spaces()).map((s) => s.name)).not.toContain(name);
  // One Confirm on the page: nothing else waits for a tap.
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(1);
  await expectNoSideways(page);

  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  // What was made, ticked: the space, the list, and the flow (off until turned on).
  const made = page.getByLabel("What was made").last();
  await expect(made).toBeVisible({ timeout: 30_000 });
  await expect(made).toContainText(`A space, “${name}”`);
  await expect(page.getByText("1 list, 1 flow").last()).toBeVisible();
  await expect(made).toContainText("off until you turn it on");
  const space = (await spaces()).find((s) => s.name === name);
  expect(space).toBeTruthy();
  // It all lives in the new space: the list and the flow, and the flow is off.
  const q = `?space=${encodeURIComponent(space!.id)}`;
  const lists = (await api(me)("GET", `/collections${q}`)) as { name: string }[];
  expect(lists.map((l) => l.name)).toContain("Test visitors");
  const flows = (await api(me)("GET", `/workflows${q}`)) as { name: string; enabled: boolean }[];
  expect(flows).toMatchObject([{ name: "Test tell me about visitors", enabled: false }]);
  // The flow's row opens its page, in that space.
  await page.getByRole("link", { name: "Open the flow Test tell me about visitors" }).last().click();
  await expect(page.getByText("Test tell me about visitors").last()).toBeVisible();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
  await api(me)("DELETE", `/spaces/${encodeURIComponent(space!.id)}`);
});
