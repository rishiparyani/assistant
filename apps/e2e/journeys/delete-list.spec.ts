// Deleting a list (owner, 2026-11-05: "How do I delete the setup?"): asked first, it goes to
// Recently deleted with what it took, and comes back from there.
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, owner, person } from "./helpers";

test("a list is deleted from its screen and brought back from Recently deleted", async ({ browser }) => {
  test.setTimeout(90_000);
  const me = await owner();
  const list = `E2E Old list ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E row ${RUN}` },
  });
  await api(me)("POST", "/views", { name: `E2E Old view ${RUN}`, collection: list });

  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/list?collection=${encodeURIComponent(list)}`);
  await expect(page.getByText(`E2E row ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Delete this list" }).click();
  // Asked first: Keep it changes nothing.
  await expect(page.getByText(`Delete “${list}”?`)).toBeVisible();
  await expectNoSideways(page);
  await page.getByRole("button", { name: "Keep it" }).click();
  let names = ((await api(me)("GET", "/collections")) as { name: string }[]).map((c) => c.name);
  expect(names).toContain(list);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Delete this list" }).click();
  await page.getByRole("button", { name: `Delete ${list}` }).click();
  await expect
    .poll(async () => ((await api(me)("GET", "/collections")) as { name: string }[]).map((c) => c.name))
    .not.toContain(list);

  await page.goto("/trash");
  await expect(page.getByText("LISTS")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(list, { exact: true })).toBeVisible();
  await expect(
    page.getByText(list, { exact: true }).locator("..").getByText("With 1 record, 1 view"),
  ).toBeVisible();
  await expectNoSideways(page);
  await page.getByRole("button", { name: `Restore the list ${list}` }).click();
  await expect(page.getByText(`The list “${list}” is back.`)).toBeVisible({ timeout: 30_000 });
  names = ((await api(me)("GET", "/collections")) as { name: string }[]).map((c) => c.name);
  expect(names).toContain(list);
  const views = ((await api(me)("GET", "/views")) as { name: string }[]).map((v) => v.name);
  expect(views).toContain(`E2E Old view ${RUN}`);
  expect(errors).toEqual([]);
  await context.close();
});

test("a space is deleted from its page and brought back from Recently deleted", async ({ browser }) => {
  test.setTimeout(90_000);
  // Its own account: the shared test owner can be near its 20 spaces after many runs.
  const me = await person(`E2E Space owner ${RUN}`);
  const name = `E2E Club ${RUN}`;
  const sp = (await api(me)("POST", "/spaces", { name })) as { id: string };
  await api(me)("POST", "/collections", {
    space: sp.id,
    name: `E2E Members ${RUN}`,
    fields: [{ name: "Title", type: "text" }],
  });
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/space?id=${sp.id}`);
  await page.getByRole("tab", { name: /People/ }).click();
  await page.getByRole("button", { name: "Delete this space" }).click();
  await expect(page.getByText(`Delete “${name}”?`)).toBeVisible();
  await expectNoSideways(page);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await expect
    .poll(async () => ((await api(me)("GET", "/spaces")) as { name: string }[]).map((s) => s.name))
    .not.toContain(name);

  await page.goto("/trash");
  await expect(page.getByText("SPACES")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("With 1 list and what's in them")).toBeVisible();
  await page.getByRole("button", { name: `Restore the space ${name}` }).click();
  await expect(page.getByText(`The space “${name}” is back.`)).toBeVisible({ timeout: 30_000 });
  const names = ((await api(me)("GET", "/spaces")) as { name: string }[]).map((s) => s.name);
  expect(names).toContain(name);
  expect(errors).toEqual([]);
  await context.close();
});
