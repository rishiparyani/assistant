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

test("the people a link is for can be played before anyone has joined it", async ({ browser }) => {
  // Owner, 2026-11-05: "I can't rehearse as the guard… how will I even raise a visitor?"
  test.setTimeout(90_000);
  const me = await owner();
  const list = `E2E Arrivals ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Status", type: "text" },
    ],
  });
  await api(me)("POST", "/shares", { form: list, for: `E2E Desk ${RUN}` });
  const flow = (await api(me)("POST", "/workflows", {
    name: `E2E arrivals flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [{ do: "notify", text: "E2E arrived {Title}", to: ["me"] }],
    enabled: false,
  })) as { id: string };
  const copy = (await api(me)("POST", "/spaces/Personal/practice", {})) as { id: string };

  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/practice?space=${copy.id}&workflow=${flow.id}`);
  await expect(page.getByText("Rehearse as…")).toBeVisible({ timeout: 30_000 });
  const desk = page.getByRole("button", { name: `Rehearse as E2E Desk ${RUN} (stand-in)` });
  await expect(desk).toBeVisible();
  await desk.click();
  await expect(page.getByText("REHEARSING AS")).toBeVisible();
  // The app is theirs: the form they'd come in by waits in their Inbox, to fill in.
  await page.getByRole("button", { name: /^Inbox/ }).click();
  await expect(page.getByText(list).first()).toBeVisible({ timeout: 30_000 });
  await expectNoSideways(page);
  await page.getByRole("button", { name: "End rehearsing" }).click();
  await page.getByText("End and throw it away").click();
  await expect(page.getByText("REHEARSING AS")).toHaveCount(0, { timeout: 30_000 });
  expect(errors).toEqual([]);
  await context.close();
});

test("as the people a list is shared with, its card opens in the app and they add to it", async ({
  browser,
}) => {
  // Owner, 2026-11-05, rehearsing as the guard: "there is no way I can add a visitor". Shared
  // things opened the website, which is outside the rehearsal.
  test.setTimeout(90_000);
  const me = await owner();
  const list = `E2E Gate log ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Status", type: "text" },
    ],
  });
  await api(me)("POST", "/views", { name: `E2E At the gate ${RUN}`, collection: list });
  await api(me)("POST", "/shares", {
    view: `E2E At the gate ${RUN}`,
    access: "edit",
    for: `E2E Guards ${RUN}`,
  });
  const flow = (await api(me)("POST", "/workflows", {
    name: `E2E gate log flow ${RUN}`,
    when: { event: "added", collection: list },
    then: [{ do: "notify", text: "E2E arrived {Title}", to: ["me"] }],
    enabled: false,
  })) as { id: string };
  const copy = (await api(me)("POST", "/spaces/Personal/practice", {})) as { id: string };

  const { page, errors, context } = await openApp(browser, me);
  await page.goto(`/practice?space=${copy.id}&workflow=${flow.id}`);
  await page.getByRole("button", { name: `Rehearse as E2E Guards ${RUN} (stand-in)` }).click();
  await expect(page.getByText("REHEARSING AS")).toBeVisible();
  // Their card says how to add, and opens in the app, as theirs.
  await expect(page.getByText("Nothing yet. Open it to add.").first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(`E2E At the gate ${RUN}`).first().click();
  await expect(page.getByText(`Add to ${list}`)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Title", { exact: true }).fill(`E2E Courier ${RUN}`);
  await page.getByRole("button", { name: `Add to ${list}` }).click();
  await expect(page.getByText(`E2E Courier ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await expectNoSideways(page);
  // It's in the copy, not the real list.
  const real = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/find`, {})) as {
    items: unknown[];
  };
  expect(real.items).toEqual([]);
  const inCopy = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/find`, {
    space: copy.id,
  })) as {
    items: { title: string }[];
  };
  expect(inCopy.items.map((r) => r.title)).toEqual([`E2E Courier ${RUN}`]);
  await page.getByRole("button", { name: "End rehearsing" }).click();
  await page.getByText("End and throw it away").click();
  expect(errors).toEqual([]);
  await context.close();
});

test("a money field changed on a shared list saves the amount typed", async ({ browser }) => {
  // Codex on PR 230: the in-app shared page sent paise as rupees, so ₹10 saved as ₹1,000.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Money friend ${RUN}`);
  const list = `E2E Bills ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Amount", type: "money" },
    ],
  });
  const rec = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E Tea ${RUN}`, Amount: "5" },
  })) as { id: string };
  await api(me)("POST", "/views", { name: `E2E Bills view ${RUN}`, collection: list });
  const made = (await api(me)("POST", "/shares", {
    view: `E2E Bills view ${RUN}`,
    access: "edit",
    hide_fields: [],
  })) as { link: string; share: { id: string } };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });

  const { page, errors, context } = await openApp(browser, friend);
  await page.goto(`/open-share?id=${made.share.id}`);
  await expect(page.getByText(`E2E Tea ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  const amount = page.locator('input[aria-label="Amount"]').first();
  await amount.fill("10");
  await amount.press("Enter");
  // The values only: an id can have these digits in it by chance. ₹10 is 1000 paise.
  await expect
    .poll(async () =>
      Object.values(
        ((await api(me)("GET", `/records/${rec.id}`)) as { values: Record<string, unknown> }).values,
      ),
    )
    .toContain(1000);
  expect(errors).toEqual([]);
  await context.close();
});

test("a shared card can be renamed and talked about in the app", async ({ browser }) => {
  // Codex on PR 230: the in-app shared page had no comments and couldn't change a title.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Card friend ${RUN}`);
  const list = `E2E Plans ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const rec = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E Picnic ${RUN}` },
  })) as { id: string };
  const made = (await api(me)("POST", "/shares", { record_id: rec.id, access: "edit" })) as {
    link: string;
    share: { id: string };
  };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });

  const { page, errors, context } = await openApp(browser, friend);
  await page.goto(`/open-share?id=${made.share.id}`);
  await expect(page.getByText(`E2E Picnic ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  // The title is a field they may change.
  const title = page.locator('input[aria-label="Title"]').first();
  await title.fill(`E2E Lunch ${RUN}`);
  await title.press("Enter");
  await expect
    .poll(async () => JSON.stringify(await api(me)("GET", `/records/${rec.id}`)))
    .toContain(`E2E Lunch ${RUN}`);
  // A comment, sent and shown.
  await expect(page.getByText("No comments yet.")).toBeVisible();
  await page.getByLabel("Add a comment").fill(`E2E bring cups ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`E2E bring cups ${RUN}`)).toBeVisible();
  await expect
    .poll(async () => JSON.stringify(await api(me)("GET", `/records/${rec.id}/comments`)))
    .toContain(`E2E bring cups ${RUN}`);
  expect(errors).toEqual([]);
  await context.close();
});

test("a share taken back while open stops showing, and one can be left", async ({ browser }) => {
  // Codex on PR 230: the in-app shared page kept showing a revoked share and had no Leave.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Leave friend ${RUN}`);
  const list = `E2E Errands ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const share = async (title: string) => {
    const rec = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
      values: { Title: title },
    })) as { id: string };
    const made = (await api(me)("POST", "/shares", { record_id: rec.id, access: "edit" })) as {
      link: string;
      share: { id: string };
    };
    await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });
    return made.share.id;
  };
  const taken = await share(`E2E Post office ${RUN}`);
  const left = await share(`E2E Bakery ${RUN}`);

  const { page, errors, context } = await openApp(browser, friend);
  // Taken back while it's open: the next change says so, and its contents go.
  await page.goto(`/open-share?id=${taken}`);
  await expect(page.getByText(`E2E Post office ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await api(me)("DELETE", `/shares/${taken}`);
  // The page may hear of it first and clear itself (CI, 2026-11-06); if not, the next change
  // finds out.
  const title = page.locator('input[aria-label="Title"]').first();
  if (await title.isVisible().catch(() => false)) {
    await title.fill(`E2E Post office later ${RUN}`).catch(() => undefined);
    await title.press("Enter").catch(() => undefined);
  }
  await expect(page.getByText("This isn't shared with you any more.")).toBeVisible();
  await expect(page.locator('input[aria-label="Title"]')).toHaveCount(0);

  // Left: off the friend's list.
  await page.goto(`/open-share?id=${left}`);
  await expect(page.getByText(`E2E Bakery ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page.getByRole("button", { name: "Leave: tap again to leave" }).click();
  await expect
    .poll(async () => ((await api(friend)("GET", "/cards")) as { share_id: string }[]).map((c) => c.share_id))
    .not.toContain(left);
  expect(errors).toEqual([]);
  await context.close();
});

test("a slow comments load doesn't take back a comment just sent", async ({ browser }) => {
  // Codex on PR 230: an older load answering last showed the thread as it was before the post.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Slow friend ${RUN}`);
  const list = `E2E Trips ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const rec = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E Hike ${RUN}` },
  })) as { id: string };
  const made = (await api(me)("POST", "/shares", { record_id: rec.id, access: "edit" })) as {
    link: string;
    share: { id: string };
  };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });

  const { page, errors, context } = await openApp(browser, friend);
  // The looks at the comments before the post are slow; the one after it isn't.
  let posted = false;
  await context.route("**/comments", async (route) => {
    if (route.request().method() === "POST") posted = true;
    else if (!posted) {
      // Read now (before the post), handed over late.
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 3000));
      return route.fulfill({ response: res });
    }
    await route.continue();
  });
  await page.goto(`/open-share?id=${made.share.id}`);
  await expect(page.getByText(`E2E Hike ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Add a comment").fill(`E2E bring water ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`E2E bring water ${RUN}`)).toBeVisible();
  // The slow first look lands now: the comment stays.
  await page.waitForTimeout(3500);
  await expect(page.getByText(`E2E bring water ${RUN}`)).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("a money field changed on a sent form saves the amount typed", async ({ browser }) => {
  // Codex on PR 230: a form's own sent records weren't looked at for their field types, so ₹10
  // typed there saved as ₹1,000.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Form friend ${RUN}`);
  const list = `E2E Claims ${RUN}`;
  await api(me)("POST", "/collections", {
    name: list,
    fields: [
      { name: "Title", type: "text" },
      { name: "Amount", type: "money" },
    ],
  });
  const made = (await api(me)("POST", "/shares", { form: list, access: "edit" })) as {
    link: string;
    share: { id: string };
  };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });
  const form = (await api(friend)("POST", `/cards/${made.share.id}/records`, {
    section: "form",
    values: { Title: `E2E Taxi ${RUN}`, Amount: "5" },
  })) as { mine: { id: string }[] };
  const sent = { id: form.mine[0]!.id };

  const { page, errors, context } = await openApp(browser, friend);
  await page.goto(`/open-share?id=${made.share.id}`);
  await expect(page.getByText(`E2E Taxi ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  // The sent record's Amount, after the form's own empty one.
  const amount = page.locator('input[aria-label="Amount"]').last();
  await amount.fill("10");
  await amount.press("Enter");
  // The values only: an id can have these digits in it by chance. ₹10 is 1000 paise.
  await expect
    .poll(async () =>
      Object.values(
        ((await api(me)("GET", `/records/${sent.id}`)) as { values: Record<string, unknown> }).values,
      ),
    )
    .toContain(1000);
  expect(errors).toEqual([]);
  await context.close();
});

test("a comment sent again after its answer was lost is posted once", async ({ browser }) => {
  // Codex on PR 230: the retry had a new id and key, so the comment showed twice.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Lost friend ${RUN}`);
  const list = `E2E Chores ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const rec = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E Laundry ${RUN}` },
  })) as { id: string };
  const made = (await api(me)("POST", "/shares", { record_id: rec.id, access: "edit" })) as {
    link: string;
    share: { id: string };
  };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });

  const { page, errors, context } = await openApp(browser, friend);
  // The first post reaches the app's server, but its answer never comes back.
  let lost = false;
  await context.route("**/comments", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      return route.abort("connectionreset");
    }
    await route.continue();
  });
  await page.goto(`/open-share?id=${made.share.id}`);
  await expect(page.getByText(`E2E Laundry ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Add a comment").fill(`E2E fold towels ${RUN}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => lost).toBe(true);
  // Still typed: send it again.
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`E2E fold towels ${RUN}`).first()).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText(`E2E fold towels ${RUN}`)).toHaveCount(1);
  const all = (await api(me)("GET", `/records/${rec.id}/comments`)) as { body: string }[];
  expect(all.filter((c) => c.body === `E2E fold towels ${RUN}`)).toHaveLength(1);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|connection/i.test(e))).toEqual([]);
  await context.close();
});

test("a form sent again after its answer was lost adds one record", async ({ browser }) => {
  // Codex on PR 230: the retry had a new record id and key, so the form added it twice.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Resend friend ${RUN}`);
  const list = `E2E Bulb asks ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const made = (await api(me)("POST", "/shares", { form: list })) as {
    link: string;
    share: { id: string };
  };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });

  const { page, errors, context } = await openApp(browser, friend);
  // The first send reaches the app's server, but its answer never comes back.
  let lost = false;
  await context.route(`**/api/cards/${made.share.id}/records`, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      return route.abort("connectionreset");
    }
    await route.continue();
  });
  await page.goto(`/open-share?id=${made.share.id}`);
  const title = page.locator('input[aria-label="Title"]').first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  await title.fill(`E2E new bulb ${RUN}`);
  await page.getByRole("button", { name: `Send to ${list}` }).click();
  await expect.poll(() => lost).toBe(true);
  // Still typed: send it again.
  await expect(title).toHaveValue(`E2E new bulb ${RUN}`);
  await page.getByRole("button", { name: `Send to ${list}` }).click();
  await expect(page.getByText(`E2E new bulb ${RUN}`).first()).toBeVisible();
  // What they've sent, as the form keeps it.
  const form = (await api(friend)("GET", `/cards/${made.share.id}`)) as { mine: { title: string }[] };
  expect(form.mine.filter((r) => r.title === `E2E new bulb ${RUN}`)).toHaveLength(1);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|connection/i.test(e))).toEqual([]);
  await context.close();
});

test("an open shared card shows the owner's changes without a pull", async ({ browser }) => {
  // Codex on PR 230: the in-app shared page never heard of changes, so it showed old values
  // until pulled.
  test.setTimeout(90_000);
  const me = await owner();
  const friend = await person(`E2E Live friend ${RUN}`);
  const list = `E2E Outings ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const rec = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E Zoo ${RUN}` },
  })) as { id: string };
  const made = (await api(me)("POST", "/shares", { record_id: rec.id, access: "view" })) as {
    link: string;
    share: { id: string };
  };
  await api(friend)("POST", "/cards/join", { token: made.link.slice(made.link.indexOf("#") + 1) });

  const { page, errors, context } = await openApp(browser, friend);
  await page.goto(`/open-share?id=${made.share.id}`);
  await expect(page.getByText(`E2E Zoo ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No comments yet.")).toBeVisible();
  // The owner changes it and says something about it, elsewhere.
  await api(me)("PATCH", `/records/${rec.id}`, { values: { Title: `E2E Aquarium ${RUN}` } });
  await api(me)("POST", `/records/${rec.id}/comments`, { body: `E2E bring snacks ${RUN}` });
  await expect(page.getByText(`E2E Aquarium ${RUN}`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`E2E bring snacks ${RUN}`)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
  await context.close();
});
