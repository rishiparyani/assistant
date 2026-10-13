// Flows on a schedule, over many records, with branches (decision 2026-10-13): a schedule runs
// from the space's own alarm, a summary counts or adds up a list, "for each" goes through
// matching records, "if" picks the steps. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { nextScheduleTime, type RecordView, type SpaceView, type WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
type Inbox = { items: { title: string; body: string | null }[] };
const inbox = async (u: User) => (await json<Inbox>(await api(u)("/me/notifications"))).items;

/** The space's scheduled jobs; `runNow` makes them due and wakes the space. */
async function scheduled(me: User, runNow = false) {
  const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
  const stub = env.SPACES.getByName(`space:${space!.id}`);
  return runInDurableObject(stub, async (_i, state) => {
    if (runNow) {
      state.storage.sql.exec(
        `update workflow_jobs set due_at = ? where kind = 'schedule'`,
        new Date(Date.now() - 1000).toISOString(),
      );
      await state.storage.setAlarm(Date.now() + 50);
    }
    return state.storage.sql
      .exec<{ due_at: string }>(`select due_at from workflow_jobs where kind = 'schedule'`)
      .toArray()
      .map((j) => j.due_at);
  });
}

describe("flow steps", () => {
  it("runs on a schedule: a summary by category, then one message or the other", async () => {
    const me = await signUp("Test Owner");
    for (const [what, amount, category] of [
      ["Test dinner", "1200", "Food"],
      ["Test cab", "500", "Travel"],
      ["Test lunch", "300", "Food"],
    ])
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: what, Amount: amount, Category: category } },
      });
    const res = await api(me)("/workflows", {
      body: {
        name: "Weekly spend",
        when: { event: "schedule", collection: "Expenses", every: "week", days: ["sun"], at: "18:00" },
        then: [
          { do: "summary", sum: "Amount", by: "Category", name: "Week" },
          {
            do: "if",
            if: [{ field: "Week.total", op: "gt", value: "5000" }],
            then: [{ do: "notify", text: "Big week: {Week.total}", to: ["me"] }],
            else: [{ do: "notify", text: "Spent {Week.total} ({Week.by}), {Week.count} things", to: ["me"] }],
          },
        ],
        enabled: true,
      },
    });
    expect(res.status).toBe(201);
    const wf = await json<WorkflowView>(res);
    expect(wf.when.schedule).toEqual({ every: "week", days: ["sun"], day_of_month: null, at: "18:00" });
    expect(wf.words).toEqual([
      "Every Sunday at 6 pm",
      "Total Amount of Expenses, by Category (as {Week})",
      "If Week.total is more than ₹5,000: Tell me: “Big week: {Week.total}”. Otherwise: Tell me: “Spent {Week.total} ({Week.by}), {Week.count} things”",
    ]);

    // One job, at the next Sunday 6 pm India time (12:30 UTC).
    const [due] = await scheduled(me);
    const at = new Date(due!);
    expect(at.getUTCDay()).toBe(0);
    expect(at.toISOString().slice(11, 16)).toBe("12:30");
    expect(at.getTime()).toBeGreaterThan(Date.now());

    await scheduled(me, true);
    expect(
      await until(async () =>
        (await inbox(me)).some((n) => n.body === "Spent ₹2,000 (Food ₹1,500, Travel ₹500), 3 things"),
      ),
    ).toBe(true);
    // Ran once, and the next run is waiting (a week on).
    const next = await scheduled(me);
    expect(next).toHaveLength(1);
    expect(Date.parse(next[0]!)).toBeGreaterThan(Date.now());
  });

  it("goes through matching records with for each, and sets a field on each", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Invoices",
        fields: [
          { name: "Title", type: "text" },
          { name: "Sent", type: "boolean" },
          { name: "Amount", type: "money" },
        ],
      },
    });
    for (const [title, sent] of [
      ["Test club", false],
      ["Test wedding", false],
      ["Test cafe", true],
    ] as const)
      await api(me)("/collections/Invoices/records", {
        body: { values: { Title: title, Sent: sent, Amount: "1000" } },
      });
    const wf = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Chase invoices",
          when: { event: "schedule", collection: "Invoices", every: "day", at: "09:30" },
          then: [
            {
              do: "for_each",
              where: [{ field: "Sent", op: "ne", value: true }],
              then: [
                { do: "notify", text: "Send {Title}", to: ["me"] },
                { do: "set", field: "Sent", value: true },
              ],
            },
          ],
          enabled: true,
        },
      }),
    );
    expect(wf.words).toEqual([
      "Every day at 9:30 am",
      "For each record in Invoices where Sent isn't Yes: Tell me: “Send {Title}”; Set Sent to yes",
    ]);
    await scheduled(me, true);
    expect(
      await until(async () => {
        const n = await inbox(me);
        return n.some((x) => x.body === "Send Test club") && n.some((x) => x.body === "Send Test wedding");
      }),
    ).toBe(true);
    const all = (
      await json<{ items: RecordView[] }>(await api(me)("/collections/Invoices/find", { body: {} }))
    ).items;
    expect(all.map((r) => r.named.Sent)).toEqual(["Yes", "Yes", "Yes"]);
    expect((await inbox(me)).some((x) => x.body === "Send Test cafe")).toBe(false);
  });

  it("branches on the record when it's added", async () => {
    const me = await signUp("Test Owner");
    await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Sort expenses",
          when: { event: "added", collection: "Expenses" },
          then: [
            {
              do: "if",
              if: [{ field: "Amount", op: "gte", value: "1000" }],
              then: [{ do: "set", field: "Category", value: "Gear" }],
              else: [{ do: "set", field: "Category", value: "Other" }],
            },
          ],
          enabled: true,
        },
      }),
    );
    const big = await json<RecordView>(
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: "Test pedal", Amount: "4000" } },
      }),
    );
    const small = await json<RecordView>(
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: "Test strings", Amount: "300" } },
      }),
    );
    const category = async (id: string) =>
      (await json<RecordView>(await api(me)(`/records/${id}`))).named.Category;
    expect(await until(async () => (await category(big.id)) === "Gear")).toBe(true);
    expect(await until(async () => (await category(small.id)) === "Other")).toBe(true);
  });

  it("refuses steps that need a record on a schedule, and half-said schedules", async () => {
    const me = await signUp("Test Owner");
    const post = (body: unknown) => api(me)("/workflows", { body });
    const base = { name: "Bad", when: { event: "schedule", collection: "Expenses", every: "day" } };
    const setOnSchedule = await post({ ...base, then: [{ do: "set", field: "Category", value: "Food" }] });
    expect(setOnSchedule.status).toBe(400);
    expect(await setOnSchedule.text()).toContain("for each");
    expect(
      (await post({ ...base, when: { ...base.when, every: "week" }, then: [{ do: "notify", text: "x" }] }))
        .status,
    ).toBe(400);
    expect(
      (
        await post({
          ...base,
          then: [
            { do: "if", if: [{ field: "Amount", op: "gt", value: 5 }], then: [{ do: "notify", text: "x" }] },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await post({ ...base, then: [{ do: "summary", sum: "What", name: "Week" }] })).status).toBe(400);
  });
});

describe("nextScheduleTime", () => {
  const ist = (s: string) => Date.parse(`${s}+05:30`);
  it("finds the next day, weekday and month day, India time", () => {
    const daily = { every: "day" as const, days: [], day_of_month: null, at: "09:00" };
    expect(nextScheduleTime(daily, ist("2026-10-13T08:00:00"))).toBe(ist("2026-10-13T09:00:00"));
    expect(nextScheduleTime(daily, ist("2026-10-13T09:00:00"))).toBe(ist("2026-10-14T09:00:00"));
    // 13 Oct 2026 is a Tuesday.
    const weekly = {
      every: "week" as const,
      days: ["fri" as const, "mon" as const],
      day_of_month: null,
      at: "18:00",
    };
    expect(nextScheduleTime(weekly, ist("2026-10-13T10:00:00"))).toBe(ist("2026-10-16T18:00:00"));
    expect(nextScheduleTime(weekly, ist("2026-10-16T19:00:00"))).toBe(ist("2026-10-19T18:00:00"));
    // The 31st means the last day: 30 Nov, then 31 Dec.
    const monthly = { every: "month" as const, days: [], day_of_month: 31, at: "20:00" };
    expect(nextScheduleTime(monthly, ist("2026-11-01T00:00:00"))).toBe(ist("2026-11-30T20:00:00"));
    expect(nextScheduleTime(monthly, ist("2026-11-30T21:00:00"))).toBe(ist("2026-12-31T20:00:00"));
    // Early morning India time is still the previous day in UTC.
    expect(nextScheduleTime(daily, ist("2026-10-14T02:00:00"))).toBe(ist("2026-10-14T09:00:00"));
  });
});
