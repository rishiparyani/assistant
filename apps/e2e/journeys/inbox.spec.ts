// The Inbox (the bell): a flow asks someone, they answer in place, the bell clears, and the
// person who added the record hears the answer under Updates.
import { expect, test } from "@playwright/test";
import { RUN, api, bell, expectNoSideways, introduce, openApp, owner, person } from "./helpers";

test("a question is answered from the Inbox, and the asker hears the answer", async ({ browser }) => {
  const me = await owner();
  const friend = await person(`E2E Friend ${RUN}`);
  await introduce(me, friend);
  const list = `E2E Visits ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Status", type: "text" },
    ],
  });
  await api(me)("POST", "/workflows", {
    name: `E2E approval ${RUN}`,
    when: { event: "added", collection: list },
    then: [
      {
        do: "ask",
        who: [friend.name],
        text: "Let {Title} in?",
        choices: ["Approved", "Denied"],
        save_to: "Status",
      },
    ],
    enabled: true,
  });
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E courier ${RUN}` },
  });

  // The friend: the bell says something needs them; they answer in the Inbox.
  const f = await openApp(browser, friend);
  await expect(bell(f.page)).toHaveAccessibleName(/1 needs you/, { timeout: 30_000 });
  await bell(f.page).click();
  const question = f.page.getByText(`Let E2E courier ${RUN} in?`);
  await expect(question).toBeVisible();
  await expectNoSideways(f.page);
  await f.page.getByRole("button", { name: "Approved" }).first().click();
  await expect(question).toHaveCount(0, { timeout: 30_000 });
  await expect(f.page.getByText("Nothing waiting on you.")).toBeVisible();
  await f.page.getByRole("button", { name: "Back" }).click();
  await expect(bell(f.page)).not.toHaveAccessibleName(/need/);
  expect(f.errors).toEqual([]);
  await f.context.close();

  // The owner: the answer is under Updates.
  const o = await openApp(browser, me);
  await bell(o.page).click();
  await expect(o.page.getByText(`${friend.name} answered “Approved”`).first()).toBeVisible({
    timeout: 30_000,
  });
  await expectNoSideways(o.page);
  expect(o.errors).toEqual([]);
  await o.context.close();
});

test("offline, the Inbox opens from what the device saved and says so", async ({ browser }) => {
  const me = await owner();
  const { page, errors, context } = await openApp(browser, me);
  await bell(page).click();
  await expect(page.getByText("NEEDS YOU", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await context.setOffline(true);
  await bell(page).click();
  await expect(page.getByText("Offline: these are the updates saved on this device.")).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
  await context.close();
});
