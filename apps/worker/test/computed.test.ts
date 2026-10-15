// Formulas and rollups (chat-first step 6): calculated in the write, kept current when linked
// records change, filterable like any value. Fake data only.
import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { FindResult, RecordView, SpaceView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function gigsWithPayments(me: User) {
  await api(me)("/collections", {
    body: {
      name: "Gigs",
      fields: [
        { name: "Title", type: "text" },
        { name: "Fee", type: "money" },
        { name: "Date", type: "date" },
      ],
    },
  });
  await api(me)("/collections", {
    body: {
      name: "Payments",
      fields: [
        { name: "Title", type: "text" },
        { name: "Amount", type: "money" },
        { name: "Gig", type: "link", options: { target: "Gigs" } },
      ],
    },
  });
  const add = (field: unknown) => api(me)("/collections/Gigs/fields", { body: { field } });
  expect(
    (
      await add({
        name: "Paid",
        type: "money",
        options: { rollup: { via: "Payments", fn: "sum", of: "Amount" } },
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await add({
        name: "Payments made",
        type: "number",
        options: { rollup: { via: "Payments", fn: "count" } },
      })
    ).status,
  ).toBe(201);
  expect((await add({ name: "Balance", type: "money", options: { formula: "{Fee} - {Paid}" } })).status).toBe(
    201,
  );
  expect((await add({ name: "Follow up", type: "date", options: { formula: "{Date} + 7" } })).status).toBe(
    201,
  );
  const gig = await json<RecordView>(
    await api(me)("/collections/Gigs/records", {
      body: { values: { Title: "Test Wedding", Fee: "50000", Date: "2026-12-12" } },
    }),
  );
  const pay = async (title: string, amount: string) =>
    json<RecordView>(
      await api(me)("/collections/Payments/records", {
        body: { values: { Title: title, Amount: amount, Gig: gig.id } },
      }),
    );
  const read = async () => json<RecordView>(await api(me)(`/records/${gig.id}`));
  return { gig, pay, read };
}

describe("calculated fields", () => {
  it("sums and counts linked payments, and the balance follows", async () => {
    const me = await signUp("Test Owner");
    const { gig, pay, read } = await gigsWithPayments(me);
    expect((await read()).named).toMatchObject({
      Paid: "₹0",
      "Payments made": "0",
      Balance: "₹50,000",
      "Follow up": "2026-12-19",
    });
    const advance = await pay("Test advance", "20000");
    await pay("Test second", "5000");
    expect((await read()).named).toMatchObject({
      Paid: "₹25,000",
      "Payments made": "2",
      Balance: "₹25,000",
    });

    // Deleting a payment, or moving it off the gig, takes it out.
    expect((await api(me)(`/records/${advance.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await read()).named).toMatchObject({ Paid: "₹5,000", Balance: "₹45,000" });

    // Calculated values filter like any other.
    const owing = await json<FindResult>(
      await api(me)("/collections/Gigs/find", {
        body: { filters: [{ field: "Balance", op: "gt", value: "40000" }] },
      }),
    );
    expect(owing.items.map((g) => g.id)).toEqual([gig.id]);
    // And the fee change flows through.
    await api(me)(`/records/${gig.id}`, { method: "PATCH", body: { values: { Fee: "60000" } } });
    expect((await read()).named).toMatchObject({ Balance: "₹55,000" });
  });

  it("can't be set by hand, and checks formulas when saved", async () => {
    const me = await signUp("Test Owner");
    const { gig } = await gigsWithPayments(me);
    expect(
      (await api(me)(`/records/${gig.id}`, { method: "PATCH", body: { values: { Balance: "1" } } })).status,
    ).toBe(400);
    const add = (field: unknown) => api(me)("/collections/Gigs/fields", { body: { field } });
    expect((await add({ name: "Bad", type: "money", options: { formula: "{Fee} -" } })).status).toBe(400);
    expect(
      (await add({ name: "Wrong type", type: "number", options: { formula: "{Fee} - {Paid}" } })).status,
    ).toBe(400);
    expect((await add({ name: "Times", type: "money", options: { formula: "{Fee} * {Paid}" } })).status).toBe(
      400,
    );
    expect((await add({ name: "Unknown", type: "money", options: { formula: "{Nope} + 1" } })).status).toBe(
      400,
    );
    // A formula may use another formula of the list.
    expect(
      (await add({ name: "Of formula", type: "money", options: { formula: "{Balance} + 1" } })).status,
    ).toBe(201);
  });

  it("works out new formulas for records already there, by name or alias", async () => {
    const me = await signUp("Test Owner");
    const { read } = await gigsWithPayments(me);
    // Fee also answers to "Price"; a new formula using the alias is filled in for the gig at once.
    await api(me)("/collections/Gigs/fields/Fee", { method: "PATCH", body: { aliases: ["Price"] } });
    expect(
      (
        await api(me)("/collections/Gigs/fields", {
          body: { field: { name: "Double", type: "money", options: { formula: "{Price} * 2" } } },
        })
      ).status,
    ).toBe(201);
    expect((await read()).named).toMatchObject({ Double: "₹1,00,000" });
    // A required field can't become calculated (nobody could fill it in).
    await api(me)("/collections/Gigs/fields", { body: { field: { name: "Deposit", type: "money" } } });
    await api(me)("/collections/Gigs/fields/Deposit", { method: "PATCH", body: { required: true } });
    expect(
      (
        await api(me)("/collections/Gigs/fields/Deposit", {
          method: "PATCH",
          body: { options: { formula: "{Fee} / 2" } },
        })
      ).status,
    ).toBe(400);
  });

  it("keeps rules on records whose rollups a linked record moves", async () => {
    const me = await signUp("Test Owner");
    const { pay, read } = await gigsWithPayments(me);
    expect(
      (
        await api(me)("/collections/Gigs/rules", {
          body: { kind: "check", require: [{ field: "Balance", op: "gte", value: "0" }] },
        })
      ).status,
    ).toBe(201);
    await pay("Test advance", "20000");
    // Paying more than the fee would make the gig's Balance negative: the payment is refused.
    const over = await api(me)("/collections/Payments/records", {
      body: { values: { Title: "Test too much", Amount: "40000", Gig: (await read()).id } },
    });
    expect(over.status).toBe(400);
    expect((await read()).named).toMatchObject({ Paid: "₹20,000", Balance: "₹30,000" });
  });

  it("wakes workflows that watch a calculated value, on the record a payment changes", async () => {
    const me = await signUp("Test Owner");
    const { pay } = await gigsWithPayments(me);
    const wf = await api(me)("/workflows", {
      body: {
        name: "Balance moved",
        when: { event: "changed", collection: "Gigs", field: "Balance" },
        then: [{ do: "notify", text: "Balance now {Balance}", to: ["me"] }],
        enabled: true,
      },
    });
    expect(wf.status).toBe(201);
    await pay("Test advance", "20000");
    const end = Date.now() + 8000;
    let seen = false;
    while (!seen && Date.now() < end) {
      const items = (await json<{ items: { body: string | null }[] }>(await api(me)("/me/notifications")))
        .items;
      seen = items.some((n) => n.body === "Balance now ₹30,000");
      if (!seen) await new Promise((r) => setTimeout(r, 200));
    }
    expect(seen).toBe(true);
  });

  it("counts or sums only the linked records that match", async () => {
    const me = await signUp("Test Filter");
    const { gig, pay, read } = await gigsWithPayments(me);
    const add = (field: unknown) => api(me)("/collections/Gigs/fields", { body: { field } });
    const big = await add({
      name: "Big payments",
      type: "money",
      options: {
        rollup: {
          via: "Payments",
          fn: "sum",
          of: "Amount",
          where: [{ field: "Amount", op: "gte", value: 10000 }],
        },
      },
    });
    expect(big.status).toBe(201);
    const p = await pay("Test small", "500");
    await pay("Test big", "12000");
    expect((await read()).named["Big payments"]).toBe("₹12,000");
    // A payment that grows past the line starts counting.
    await api(me)(`/records/${p.id}`, { method: "PATCH", body: { values: { Amount: "15000" } } });
    expect((await read()).named["Big payments"]).toBe("₹27,000");
    expect(gig.id).toBeTruthy();
    // Filters name fields of the linked list.
    const bad = await add({
      name: "Wrong",
      type: "number",
      options: { rollup: { via: "Payments", fn: "count", where: [{ field: "Nope", op: "empty" }] } },
    });
    expect(bad.status).toBe(400);
    // Nothing that changes by itself (stored values only move in writes).
    for (const w of [
      { field: "Amount", op: "period", value: "today" },
      { field: "Title", op: "eq", value: "me" },
    ])
      expect(
        (
          await add({
            name: "Moving",
            type: "number",
            options: { rollup: { via: "Payments", fn: "count", where: [w] } },
          })
        ).status,
      ).toBe(400);
    // A field a filtered rollup uses can't be removed until the rollup changes.
    const removed = await api(me)("/collections/Payments/fields/Amount", { method: "DELETE" });
    expect(removed.status).toBe(409);
  });

  it("decides, reads through a link, uses other formulas and averages", async () => {
    const me = await signUp("Test Formulas");
    const { gig, pay, read } = await gigsWithPayments(me);
    const add = (collection: string, field: unknown) =>
      api(me)(`/collections/${collection}/fields`, { body: { field } });
    await api(me)("/collections", {
      body: {
        name: "Clients",
        fields: [
          { name: "Name", type: "text" },
          { name: "Rate", type: "money" },
          { name: "City", type: "choice", options: { choices: ["Pune", "Mumbai"] } },
        ],
      },
    });
    const client = await json<RecordView>(
      await api(me)("/collections/Clients/records", {
        body: { values: { Name: "Test Client", Rate: "1500", City: "Pune" } },
      }),
    );
    expect((await add("Gigs", { name: "Client", type: "link", options: { target: "Clients" } })).status).toBe(
      201,
    );
    expect((await add("Gigs", { name: "Hours", type: "number" })).status).toBe(201);
    // Text and yes/no formulas, a formula of a formula, a field read through the link, an average.
    for (const f of [
      { name: "Status", type: "text", options: { formula: 'if({Paid} >= {Fee}, "Paid", "Due")' } },
      { name: "Settled", type: "boolean", options: { formula: "{Balance} <= 0" } },
      { name: "Half balance", type: "money", options: { formula: "{Balance} / 2" } },
      { name: "Quote", type: "money", options: { formula: "{Client.Rate} * {Hours}" } },
      { name: "Where", type: "text", options: { formula: 'join({Client.Name}, " in ", {Client.City})' } },
      {
        name: "Average payment",
        type: "money",
        options: { rollup: { via: "Payments", fn: "avg", of: "Amount" } },
      },
    ])
      expect((await add("Gigs", f)).status, f.name).toBe(201);
    await api(me)(`/records/${gig.id}`, {
      method: "PATCH",
      body: { values: { Client: client.id, Hours: 3 } },
    });
    await pay("Test one", "10000");
    await pay("Test two", "20000");
    expect((await read()).named).toMatchObject({
      Status: "Due",
      Settled: "No",
      "Half balance": "₹10,000",
      Quote: "₹4,500",
      Where: "Test Client in Pune",
      "Average payment": "₹15,000",
    });
    // The client's rate changes: the gig's quote follows.
    await api(me)(`/records/${client.id}`, { method: "PATCH", body: { values: { Rate: "2000" } } });
    expect((await read()).named.Quote).toBe("₹6,000");
    await pay("Test rest", "20000");
    expect((await read()).named).toMatchObject({ Status: "Paid", Settled: "Yes", "Half balance": "₹0" });
    // Text formulas filter like any text; yes/no ones like any yes/no.
    const settled = await json<FindResult>(
      await api(me)("/collections/Gigs/find", {
        body: { filters: [{ field: "Settled", op: "eq", value: true }] },
      }),
    );
    expect(settled.items.map((g) => g.id)).toEqual([gig.id]);

    // What's refused: a loop, a wrong result type, text in arithmetic, a link to many, a bad function.
    const bad = async (f: unknown) => (await add("Gigs", f)).status;
    expect(await bad({ name: "Loop", type: "money", options: { formula: "{Half balance} * 2" } })).toBe(201);
    expect(
      (
        await api(me)("/collections/Gigs/fields/Half balance", {
          method: "PATCH",
          body: { options: { formula: "{Loop} / 2" } },
        })
      ).status,
    ).toBe(400);
    expect(
      await bad({ name: "Wrong", type: "number", options: { formula: 'if({Paid} >= {Fee}, "Paid", 0)' } }),
    ).toBe(400);
    expect(await bad({ name: "Wrong 2", type: "money", options: { formula: "{Title} + 1" } })).toBe(400);
    expect(await bad({ name: "Wrong 3", type: "text", options: { formula: "nope({Title})" } })).toBe(400);
    expect(await bad({ name: "Wrong 4", type: "money", options: { formula: "{Payments.Amount}" } })).toBe(
      400,
    );
    expect(await bad({ name: "Wrong 5", type: "choice", options: { choices: ["a"], formula: '"a"' } })).toBe(
      400,
    );
  });

  it("works today() formulas out again each day", async () => {
    const me = await signUp("Test Today");
    const { gig, read } = await gigsWithPayments(me);
    expect(
      (
        await api(me)("/collections/Gigs/fields", {
          body: { field: { name: "Days to go", type: "number", options: { formula: "{Date} - today()" } } },
        })
      ).status,
    ).toBe(201);
    const ist = new Date(Date.now() + 330 * 60_000);
    const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    const days = Math.round((Date.UTC(2026, 11, 12) - today) / 86_400_000);
    expect((await read()).named["Days to go"]).toBe(String(days));
    // A new day: the alarm works the stored values out again (here: after they were put wrong).
    const spaces = await json<SpaceView[]>(await api(me)("/spaces"));
    const stub = env.SPACES.getByName(`space:${spaces[0]!.id}`);
    await runInDurableObject(stub, async (inst, state) => {
      const r = state.storage.sql
        .exec<{ values_json: string }>(`select values_json from records where id = ?`, gig.id)
        .one();
      const values = JSON.parse(r.values_json) as Record<string, unknown>;
      const f = state.storage.sql
        .exec<{ id: string }>(`select id from fields where name = 'Days to go'`)
        .one();
      values[f.id] = 999;
      state.storage.sql.exec(
        `update records set values_json = ? where id = ?`,
        JSON.stringify(values),
        gig.id,
      );
      state.storage.sql.exec(
        `insert or replace into _meta (key, value) values ('daily_formulas', '2000-01-01')`,
      );
      await (inst as unknown as { alarm(): Promise<void> }).alarm();
    });
    expect((await read()).named["Days to go"]).toBe(String(days));
  });
});
