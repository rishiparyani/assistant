// A rehearsal the phone was still playing in, ended meanwhile (from another device, or the chat):
// the app leaves it and works as yourself, instead of every screen failing or loading for ever
// (owner, 2026-11-01: a flow's page stuck on "Loading…", even after a restart).
import { expect, test } from "@playwright/test";
import { RUN, api, expectNoSideways, openApp, owner } from "./helpers";

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
  await expect(page.getByRole("button", { name: "Open the chat" })).toBeVisible();
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), `gigspree@${me.id}:practice-as`))
    .toBeNull();
  await expectNoSideways(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("a change waiting from an ended rehearsal is not made on the real list", async ({ browser }) => {
  // Codex on PR 223: the retry as yourself must be for reads only; a rehearsal's edit, replayed
  // on the real list, would change the real record.
  const me = await owner();
  const list = `E2E Rehearsed ${RUN}`;
  await api(me)("POST", "/collections", { name: list, fields: [{ name: "Title", type: "text" }] });
  const record = (await api(me)("POST", `/collections/${encodeURIComponent(list)}/records`, {
    values: { Title: `E2E real ${RUN}` },
  })) as { id: string; title: string };
  const ghost = { space: "01GHOSTPRACTICE00000000000", of: "x", as: me.id, name: "Ghost", self: me.id };
  const { page, errors, context } = await openApp(browser, me);
  // A change made in the rehearsal, still waiting when it ended.
  await page.evaluate(
    ([outboxKey, outbox, practiceKey, practice]) => {
      localStorage.setItem(outboxKey!, outbox!);
      localStorage.setItem(practiceKey!, practice!);
    },
    [
      `gigspree@${me.id}:outbox:${me.id}`,
      JSON.stringify({
        waiting: [
          {
            id: `01E2EREHEARSED${String(Date.now()).slice(-12)}`,
            kind: "spaces.update_record",
            method: "PATCH",
            path: `/api/records/${record.id}`,
            body: { values: { Title: `E2E rehearsed edit ${RUN}` } },
            label: "E2E rehearsed edit",
            at: Date.now(),
            practice: ghost,
            account: me.id,
          },
        ],
        failed: [],
      }),
      `gigspree@${me.id}:practice-as`,
      JSON.stringify(ghost),
    ],
  );
  await page.reload();
  await expect(page.getByText("Chats", { exact: true }).first()).toBeVisible();
  // It goes nowhere: kept as not made, with why.
  await expect
    .poll(
      () =>
        page.evaluate((k) => {
          const saved = JSON.parse(localStorage.getItem(k) ?? "null") as {
            failed: { reason: string }[];
          } | null;
          return saved?.failed.map((f) => f.reason) ?? [];
        }, `gigspree@${me.id}:outbox:${me.id}`),
      { timeout: 30_000 },
    )
    .toEqual(["That practice has ended, so this change wasn't made."]);
  const now = (await api(me)("GET", `/records/${record.id}`)) as { title: string };
  expect(now.title).toBe(`E2E real ${RUN}`);
  expect(errors).toEqual([]);
  await context.close();
});
