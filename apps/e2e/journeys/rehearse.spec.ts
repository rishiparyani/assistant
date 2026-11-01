// Rehearsing is being each person (decision 2026-11-01): start as someone, do the real thing,
// a banner brings in the next person, answer as them, and End throws the copy away and tells
// what happened. Nothing reaches the real friend.
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, introduce, openApp, owner, person } from "./helpers";

test("a flow is rehearsed person by person, and End throws it away", async ({ browser }) => {
  test.setTimeout(120_000);
  const me = await owner();
  const friend = await person(`E2E Rehearse friend ${RUN}`);
  await introduce(me, friend);
  const list = `E2E Gate ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Status", type: "text" },
    ],
  });
  const flow = (await api(me)("POST", "/workflows", {
    name: `E2E gate flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [
      {
        do: "ask",
        who: [friend.name],
        text: "Let {Title} in?",
        choices: ["Allow", "Deny"],
        save_to: "Status",
      },
    ],
    enabled: false,
  })) as { id: string };
  const copy = (await api(me)("POST", "/spaces/Personal/practice", {})) as { id: string };

  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/practice?space=${copy.id}&workflow=${flow.id}`);
  await expect(page.getByText("Rehearse as…")).toBeVisible({ timeout: 30_000 });
  await expectNoSideways(page);
  // The app's first look at the copy is slow: the question is asked before it comes back, and
  // its banner still shows (Codex on PR 225).
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let hold = true;
  await page.route(`**/api/spaces/${copy.id}/practice`, async (route) => {
    if (hold && route.request().method() === "GET") {
      hold = false;
      await gate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Rehearse as Yourself" }).click();
  await expect(page.getByText("REHEARSING AS")).toBeVisible();

  // The real thing, as yourself, in the copy: a visitor is added.
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    space: copy.id,
    values: { Title: `E2E Dev ${RUN}` },
  });
  await expect.poll(() => hold).toBe(false);
  await new Promise((r) => setTimeout(r, 1500));
  release();
  // The flow reaches the friend: a banner, and a tap makes the app theirs, on their Inbox.
  const banner = page.getByRole("button", { name: new RegExp(`For ${friend.name}`) });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.click();
  await expect(page.getByText(friend.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`Let E2E Dev ${RUN} in?`).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Allow" }).first().click();
  await expect(page.getByText(`Let E2E Dev ${RUN} in?`)).toHaveCount(0, { timeout: 30_000 });

  // End: thrown away, and the story behind the scenes.
  await page.getByRole("button", { name: "End rehearsing" }).click();
  await page.getByText("End and throw it away").click();
  await expect(page.getByText("Here's what happened")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(`was asked: Let E2E Dev ${RUN} in\\?`))).toBeVisible();
  await expect(page.getByText("REHEARSING AS")).toHaveCount(0);
  await expectNoSideways(page);
  // The real flow is still off: it can be turned on from here.
  await page.getByRole("button", { name: "Turn the flow on" }).click();
  await expect(page.getByText("The flow is on.")).toBeVisible({ timeout: 30_000 });
  const real = (await api(me)("GET", `/workflows/${flow.id}`)) as { workflow: { enabled: boolean } };
  expect(real.workflow.enabled).toBe(true);
  const spaces = (await api(me)("GET", "/spaces")) as { id: string }[];
  expect(spaces.some((s) => s.id === copy.id)).toBe(false);
  // Nothing reached the real friend.
  const theirs = (await api(friend)("GET", "/me/notifications")) as { items?: { body?: string | null }[] };
  expect(JSON.stringify(theirs)).not.toContain(`E2E Dev ${RUN}`);
  // Opened again later, the story is gone: it goes home rather than show an empty one.
  await page.reload();
  await expect(page.getByText("Chats", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Here's what happened")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("the story of an ended rehearsal isn't shown to another account", async ({ browser }) => {
  // Codex on PR 225: the story stayed in memory across an account switch.
  test.setTimeout(120_000);
  const first = await person(`E2E Story first ${RUN}`);
  const second = await person(`E2E Story second ${RUN}`);
  const list = `E2E Story list ${RUN}`;
  await api(first)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const flow = (await api(first)("POST", "/workflows", {
    name: `E2E story flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [{ do: "notify", who: ["me"], text: "Added {Title}" }],
    enabled: false,
  })) as { id: string };
  const copy = (await api(first)("POST", "/spaces/Personal/practice", {})) as { id: string };
  const { page, errors, context } = await openApp(browser, first);
  await page.goto(`/practice?space=${copy.id}&workflow=${flow.id}`);
  await page.getByRole("button", { name: "Rehearse as Yourself" }).click();
  await page.getByRole("button", { name: "End rehearsing" }).click();
  await page.getByText("End and throw it away").click();
  await expect(page.getByText("Here's what happened")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Done" }).click();
  // Another account on this device, then the ended screen's address, inside the app.
  await page.getByRole("button", { name: /^You:/ }).click();
  await page.getByText("Add another account").click();
  await page.getByLabel("Email").fill(second.email);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByText("Sign in (test)").click();
  await expect(page.getByRole("button", { name: new RegExp(`^You: ${second.name}`) })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    history.pushState({}, "", "/practice?ended=1");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("button", { name: new RegExp(`^You: ${second.name}`) })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Here's what happened")).toHaveCount(0);
  await expect(page.getByText(`E2E story flow ${RUN}`.toUpperCase())).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
