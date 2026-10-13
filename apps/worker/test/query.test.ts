// Questions about the data (decision 2026-10-13 "Questions, not SQL"): checked names, exact
// arithmetic by the engine, links followed both ways, dates by month, run as the asker.
// Fake data only.
import { describe, expect, it } from "vitest";
import type { QueryResult, RecordView, SavedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

const year = new Date().getUTCFullYear();

async function band(me: User) {
  await api(me)("/collections", {
    body: {
      name: "Gigs",
      fields: [
        { name: "Title", type: "text" },
        { name: "Venue", type: "text" },
        { name: "Fee", type: "money" },
        { name: "Date", type: "date" },
      ],
    },
  });
  await api(me)("/collections", {
    body: {
      name: "Payouts",
      fields: [
        { name: "Title", type: "text" },
        { name: "Amount", type: "money" },
        { name: "Gig", type: "link", options: { target: "Gigs" } },
      ],
    },
  });
  const gig = async (title: string, venue: string, fee: string, date: string) =>
    json<RecordView>(
      await api(me)("/collections/Gigs/records", {
        body: { values: { Title: title, Venue: venue, Fee: fee, Date: date } },
      }),
    );
  const pay = (title: string, amount: string, g: RecordView) =>
    api(me)("/collections/Payouts/records", {
      body: { values: { Title: title, Amount: amount, Gig: g.id } },
    });
  const a = await gig("Test club night", "Test Club", "20000", `${year}-01-10`);
  const b = await gig("Test club encore", "Test Club", "15000", `${year}-01-24`);
  const c = await gig("Test wedding", "Test Lawns", "60000", `${year}-02-14`);
  await gig("Test old gig", "Test Club", "9000", `${year - 1}-05-01`);
  await pay("Test drummer", "5000", a);
  await pay("Test bassist", "4000", a);
  await pay("Test drummer", "20000", c);
  void b;
}

const ask = async (me: User, body: unknown) => {
  const res = await api(me)("/query", { body });
  return { status: res.status, body: res.status === 200 ? await json<QueryResult>(res) : await res.text() };
};

describe("questions about the data", () => {
  it("adds up by venue this year, follows a list that links here, and does arithmetic", async () => {
    const me = await signUp("Test Owner");
    await band(me);
    const { status, body } = await ask(me, {
      from: "Gigs",
      where: [{ field: "Date", op: "period", value: "this_year" }],
      group_by: ["Venue"],
      measures: [
        { fn: "sum", field: "Fee", as: "Earned" },
        { fn: "sum", field: "Payouts.Amount", as: "Paid out" },
        { calc: "{Earned} - {Paid out}", as: "Kept" },
        { fn: "count", as: "Gigs" },
      ],
    });
    expect(status).toBe(200);
    const r = body as QueryResult;
    expect(r.columns.map((c) => [c.name, c.type])).toEqual([
      ["Venue", "text"],
      ["Earned", "money"],
      ["Paid out", "money"],
      ["Kept", "money"],
      ["Gigs", "number"],
    ]);
    // Biggest first by the first number; money exact, in paise underneath.
    expect(r.rows.map((x) => x.shown)).toEqual([
      ["Test Lawns", "₹60,000", "₹20,000", "₹40,000", "1"],
      ["Test Club", "₹35,000", "₹9,000", "₹26,000", "2"],
    ]);
    expect(r.rows[0]!.cells[1]).toBe(6_000_000);
    expect(r.scanned).toBe(3);
    expect(r.title).toBe("Gigs by Venue");
    expect(r.words).toBe(
      "Gigs where Date is in this year, by Venue: Earned (total Fee), Paid out (total Payouts.Amount), Kept ({Earned} - {Paid out}), Gigs (count)",
    );
  });

  it("groups by month, compares this year with last, and reads linked titles", async () => {
    const me = await signUp("Test Owner");
    await band(me);
    const months = (
      await ask(me, {
        from: "Gigs",
        where: [{ field: "Date", op: "period", value: "this_year" }],
        group_by: ["Date:month"],
        measures: [{ fn: "sum", field: "Fee" }],
      })
    ).body as QueryResult;
    expect(months.rows.map((x) => x.shown)).toEqual([
      [`Jan ${year}`, "₹35,000"],
      [`Feb ${year}`, "₹60,000"],
    ]);
    const years = (
      await ask(me, {
        from: "Gigs",
        measures: [
          {
            fn: "sum",
            field: "Fee",
            where: [{ field: "Date", op: "period", value: "this_year" }],
            as: "This year",
          },
          {
            fn: "sum",
            field: "Fee",
            where: [{ field: "Date", op: "period", value: "last_year" }],
            as: "Last year",
          },
          { fn: "max", field: "Date", as: "Latest" },
          { fn: "count_distinct", field: "Venue", as: "Venues" },
        ],
      })
    ).body as QueryResult;
    expect(years.rows).toHaveLength(1);
    expect(years.rows[0]!.shown).toEqual(["₹95,000", "₹9,000", `14 Feb ${year}`, "2"]);
    const byGig = (
      await ask(me, { from: "Payouts", group_by: ["Gig"], measures: [{ fn: "sum", field: "Amount" }] })
    ).body as QueryResult;
    expect(byGig.rows.map((x) => x.shown)).toEqual([
      ["Test wedding", "₹20,000"],
      ["Test club night", "₹9,000"],
    ]);
  });

  it("keeps a linked record's value with its own group, and compares times exactly", async () => {
    const me = await signUp("Test Owner");
    await band(me);
    // Grouped by the payout's title: each payout's amount counts under its own title only.
    const byPayee = (
      await ask(me, {
        from: "Gigs",
        group_by: ["Payouts.Title"],
        measures: [{ fn: "sum", field: "Payouts.Amount", as: "Paid" }],
      })
    ).body as QueryResult;
    expect(byPayee.rows.map((x) => x.shown)).toEqual([
      ["Test drummer", "₹25,000"],
      ["Test bassist", "₹4,000"],
      ["(none)", "₹0"],
    ]);
    await api(me)("/collections", {
      body: {
        name: "Calls",
        fields: [
          { name: "Title", type: "text" },
          { name: "At", type: "datetime" },
        ],
      },
    });
    for (const [t, at] of [
      ["Test early call", `${year}-03-05T09:00`],
      ["Test late call", `${year}-03-05T18:30`],
    ])
      await api(me)("/collections/Calls/records", { body: { values: { Title: t, At: at } } });
    const latest = (
      await ask(me, {
        from: "Calls",
        measures: [
          { fn: "max", field: "At", as: "Latest" },
          { fn: "min", field: "At" },
        ],
      })
    ).body as QueryResult;
    expect(latest.columns.map((c) => c.type)).toEqual(["datetime", "datetime"]);
    expect(latest.rows[0]!.shown).toEqual([`5 Mar ${year}, 6:30 pm`, `5 Mar ${year}, 9 am`]);
  });

  it("names what's wrong so the assistant can fix the question, and is private to the space", async () => {
    const me = await signUp("Test Owner");
    await band(me);
    const bad = async (body: unknown) => {
      const r = await ask(me, body);
      expect(r.status).toBe(400);
      return String(r.body);
    };
    expect(await bad({ from: "Gigs", group_by: ["Place"] })).toContain("Fields: Title, Venue, Fee, Date");
    expect(await bad({ from: "Gigs", measures: [{ fn: "sum", field: "Venue" }] })).toContain(
      "isn't a number or money field",
    );
    expect(
      await bad({
        from: "Gigs",
        measures: [
          { fn: "sum", field: "Fee" },
          { calc: "{Fee} - {Paid}", as: "x" },
        ],
      }),
    ).toContain("isn't an earlier column");
    expect(await bad({ from: "Gigs", group_by: ["Venue:month"] })).toContain("isn't a date");
    expect(await bad({ from: "Gigs", sort: { by: "Nope" } })).toContain("No column");
    expect(await bad({ from: "Gigs", measures: [{ fn: "count_distinct" }] })).toContain("Say which field");

    const stranger = await signUp("Test Stranger");
    const [space] = await json<{ id: string }[]>(await api(me)("/spaces"));
    const res = await api(stranger)("/query", { body: { space: space!.id, from: "Gigs" } });
    expect(res.status).toBe(404);
  });

  it("keeps a question on a card, checked when saved", async () => {
    const me = await signUp("Test Owner");
    await band(me);
    let n = 0;
    const save = (card: unknown) =>
      api(me)("/views", {
        body: {
          name: `Earnings by venue ${++n}`,
          collection: "Gigs",
          filters: [{ field: "Date", op: "period", value: "this_year" }],
          pinned: true,
          card,
        },
      });
    const ok = await save({
      arrangement: "bars",
      question: { group_by: ["Venue"], measures: [{ fn: "sum", field: "Fee", as: "Earned" }] },
    });
    expect(ok.status).toBe(201);
    const v = await json<SavedView>(ok);
    expect(v.card).toEqual({
      arrangement: "bars",
      controls: [],
      question: { group_by: ["Venue"], measures: [{ fn: "sum", field: "Fee", as: "Earned" }], limit: 20 },
    });
    const bad = await save({ arrangement: "table", question: { measures: [{ fn: "sum", field: "Venue" }] } });
    expect(bad.status).toBe(400);
    expect((await save({ arrangement: "table" })).status).toBe(400);
    expect(
      (await save({ arrangement: "list-plain", question: { measures: [{ fn: "count" }] } })).status,
    ).toBe(400);
  });
});
