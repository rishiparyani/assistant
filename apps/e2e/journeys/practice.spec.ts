// A rehearsal the phone was still playing in, ended meanwhile (from another device, or the chat):
// the app leaves it and works as yourself, instead of every screen failing or loading for ever
// (owner, 2026-11-01: a flow's page stuck on "Loading…", even after a restart).
import { expect, test } from "@playwright/test";
import { expectNoSideways, openApp, owner } from "./helpers";

test("a rehearsal that has ended is left on its own", async ({ browser }) => {
  const me = await owner();
  const { page, errors, context } = await openApp(browser, me);
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [
      `gigspree@${me.id}:practice-as`,
      JSON.stringify({ space: "01GHOSTPRACTICE00000000000", of: "x", as: me.id, name: "Ghost", self: me.id }),
    ],
  );
  await page.reload();
  await expect(page.getByText("Chats", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Assistant/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), `gigspree@${me.id}:practice-as`))
    .toBeNull();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});
