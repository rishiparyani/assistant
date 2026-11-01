// A chat holds its lists (docs/design/chats-base.md step 2): Chats shows them as chips on the
// chat's row (no separate tile), and the chat's name opens its info with Lists and People. A chat
// for two is a group of two (decision 2026-11-01).
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, introduce, openApp, openChat, owner, person } from "./helpers";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase();

for (const direct of [false, true]) {
  test(`a ${direct ? "chat for two" : "group"} shows its lists on Chats and in its info`, async ({
    browser,
  }) => {
    const me = await owner();
    const friend = await person(`E2E Info friend ${direct ? "two" : "group"} ${RUN}`);
    await introduce(me, friend);
    const g = (await api(me)("POST", "/groups", {
      id: newId(),
      name: direct ? "" : `E2E Flat ${RUN}`,
      people: [friend.name],
      direct,
    })) as { id: string; name: string };
    const home = (await api(me)("POST", `/groups/${g.id}/home`, {})) as { space_id: string };
    const list = `E2E Dues ${direct ? "two" : "group"} ${RUN}`;
    await api(me)("POST", "/collections", {
      space: home.space_id,
      name: list,
      fields: [{ name: "Title", type: "text" }],
    });

    const { page, errors, context } = await openApp(browser, me);
    // On Chats: the chat's own row with its list as a chip, not a separate tile.
    const row = page.getByRole("button", { name: new RegExp(`lists: ${list}`) });
    await expect(row).toBeVisible();
    // Its home's tile is gone (a chat for two's home is named "Chat").
    const tile = direct ? "Chat" : `E2E Flat ${RUN}`;
    await expect(page.getByRole("button", { name: new RegExp(`^${tile}, space`) })).toHaveCount(0);
    await expectNoSideways(page);

    await openChat(page, g.id);
    await page.getByRole("button", { name: "Chat info" }).click();
    await expect(page.getByRole("button", { name: `List: ${list}` })).toBeVisible();
    // Earlier screens stay in the page, hidden: only what shows counts.
    await expect(page.getByText(friend.name, { exact: true }).filter({ visible: true }).last()).toBeVisible();
    await expect(page.getByText("You", { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expectNoSideways(page);
    await page.getByRole("button", { name: `List: ${list}` }).click();
    await expect(page).toHaveURL(/\/list\?/);
    await expect(page.getByText(list).filter({ visible: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
}
