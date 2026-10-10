// Formulas and rollups (chat-first step 6): calculated in the write, kept current when linked
// records change, filterable like any value. Fake data only.
import { describe, expect, it } from "vitest";
import type { FindResult, RecordView } from "@assistant/shared";
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
    expect(
      (await add({ name: "Of formula", type: "money", options: { formula: "{Balance} + 1" } })).status,
    ).toBe(400);
  });
});
