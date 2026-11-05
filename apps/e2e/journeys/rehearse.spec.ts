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
  // Another flow on the same list: rehearsing this one, it stays quiet (Codex on PR 225).
  await api(me)("POST", "/workflows", {
    name: `E2E other gate flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [{ do: "notify", text: "E2E other {Title}", to: ["me"] }],
    enabled: true,
  });
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
  await expect(page.getByText(new RegExp(`E2E other E2E Dev ${RUN}`))).toHaveCount(0);
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

test("a slow look doesn't bring a banner back, and End keeps the copy if it can't read the story", async ({
  browser,
}) => {
  // Codex on PR 225: an older answer arriving late reset what was seen; a failed read at End
  // was told as "nothing happened" and the copy was gone.
  test.setTimeout(120_000);
  const me = await owner();
  const friend = await person(`E2E Slow friend ${RUN}`);
  await introduce(me, friend);
  const list = `E2E Slow ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const flow = (await api(me)("POST", "/workflows", {
    name: `E2E slow flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [{ do: "ask", who: [friend.name], text: "Let {Title} in?", choices: ["Allow", "Deny"] }],
    enabled: false,
  })) as { id: string };
  const copy = (await api(me)("POST", "/spaces/Personal/practice", {})) as { id: string };
  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/practice?space=${copy.id}&workflow=${flow.id}`);
  await page.getByRole("button", { name: "Rehearse as Yourself" }).click();
  await expect(page.getByText("REHEARSING AS")).toBeVisible();
  await page.waitForTimeout(1000);

  // One look is answered from before the question, but its answer comes back only later.
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let hold = true;
  let failNext = false;
  await page.route(`**/api/spaces/${copy.id}/practice`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (failNext) {
      failNext = false;
      return route.abort("internetdisconnected");
    }
    if (hold) {
      hold = false;
      const old = await route.fetch();
      await gate;
      return route.fulfill({ response: old });
    }
    return route.continue();
  });
  await expect.poll(() => hold).toBe(false);
  await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    space: copy.id,
    values: { Title: `E2E Slow Dev ${RUN}` },
  });
  // The banner may come while the slow look is still out (dismissed at once), or after it.
  const banner = page.getByRole("button", { name: new RegExp(`For ${friend.name}`) });
  await page.waitForTimeout(8000);
  const early = await banner.isVisible();
  if (early) await page.getByRole("button", { name: "Dismiss" }).click();
  release();
  if (!early) {
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Dismiss" }).click();
  }
  // Dismissed, it doesn't come back when the old answer lands.
  await page.waitForTimeout(7000);
  await expect(banner).toHaveCount(0);

  // End, while what happened can't be read: nothing is thrown away, and it says so.
  failNext = true;
  await page.getByRole("button", { name: "End rehearsing" }).click();
  await page.getByText("End and throw it away").click();
  await expect(page.getByText("Ending needs a connection.")).toBeVisible({ timeout: 30_000 });
  const spaces = (await api(me)("GET", "/spaces")) as { id: string }[];
  expect(spaces.some((s) => s.id === copy.id)).toBe(true);
  // Again, now it can: the story has the question.
  await page.getByText("End and throw it away").click();
  await expect(page.getByText(new RegExp(`was asked: Let E2E Slow Dev ${RUN} in\\?`))).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
});

test("the people a flow asks can be played before anything has run", async ({ browser }) => {
  // Owner, 2026-11-05: rehearsing offered only "Yourself" until a record set the flow off.
  test.setTimeout(90_000);
  const me = await owner();
  const list = `E2E Requests ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Approver", type: "person" },
      { name: "Status", type: "text" },
    ],
  });
  const flow = (await api(me)("POST", "/workflows", {
    name: `E2E approve flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [
      { do: "ask", who: ["{Approver}"], text: "OK {Title}?", choices: ["Yes", "No"], save_to: "Status" },
    ],
    enabled: false,
  })) as { id: string };
  const copy = (await api(me)("POST", "/spaces/Personal/practice", {})) as { id: string };

  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/practice?space=${copy.id}&workflow=${flow.id}`);
  await expect(page.getByText("Rehearse as…")).toBeVisible({ timeout: 30_000 });
  // The role is there to start as.
  await expect(page.getByRole("button", { name: "Rehearse as Approver (stand-in)" })).toBeVisible();
  await page.getByRole("button", { name: "Rehearse as Yourself" }).click();
  await expect(page.getByText("REHEARSING AS")).toBeVisible();
  // And to switch to, with nothing added yet.
  await page.getByRole("button", { name: "Switch who you play" }).click();
  const role = page.getByRole("button", { name: "Approver (stand-in)" });
  await expect(role).toBeVisible();
  await role.click();
  await expect(page.getByText("Approver (stand-in)").first()).toBeVisible();
  await expectNoSideways(page);
  await page.getByRole("button", { name: "End rehearsing" }).click();
  await page.getByText("End and throw it away").click();
  await expect(page.getByText("REHEARSING AS")).toHaveCount(0, { timeout: 30_000 });
  expect(errors).toEqual([]);
  await context.close();
});
