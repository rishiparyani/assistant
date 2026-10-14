// Undo that can't damage data (decision 2026-10-14): deletes come back with their links and
// what they took along, Undo never quietly overwrites a later change, and what workflows did
// because of a change can be undone with it. Fake data only.
import { describe, expect, it } from "vitest";
import type { HistoryItem, RecordView } from "@assistant/shared";
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

/** A trip with costs that roll up into it; a cost's link to its trip cascades on delete. */
async function trips(me: User) {
  await api(me)("/collections", {
    body: { name: "Trips", fields: [{ name: "Title", type: "text" }] },
  });
  await api(me)("/collections", {
    body: {
      name: "Costs",
      fields: [
        { name: "Title", type: "text" },
        { name: "Amount", type: "money" },
        { name: "Trip", type: "link", options: { target: "Trips", on_delete: "cascade" } },
      ],
    },
  });
  await api(me)("/collections/Trips/fields", {
    body: {
      field: { name: "Spent", type: "money", options: { rollup: { via: "Costs", fn: "sum", of: "Amount" } } },
    },
  });
  const trip = await json<RecordView>(
    await api(me)("/collections/Trips/records", { body: { values: { Title: "Test Goa" } } }),
  );
  const cost = async (title: string, amount: string) =>
    json<RecordView>(
      await api(me)("/collections/Costs/records", {
        body: { values: { Title: title, Amount: amount, Trip: trip.id } },
      }),
    );
  return {
    trip,
    cost,
    spent: async () => (await json<RecordView>(await api(me)(`/records/${trip.id}`))).named.Spent,
  };
}

const history = async (me: User) => json<HistoryItem[]>(await api(me)("/history?limit=30"));

describe("undo", () => {
  it("brings a deleted expense back with its link, and the totals follow", async () => {
    const me = await signUp("Test Undoer");
    const { trip, cost, spent } = await trips(me);
    const train = await cost("Test train", "3000");
    await cost("Test hotel", "8000");
    await cost("Test food", "2000");
    expect(await spent()).toBe("₹13,000");

    expect((await api(me)(`/records/${train.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await spent()).toBe("₹10,000");
    const del = (await history(me)).find((h) => h.action === "delete_record")!;
    expect(del).toMatchObject({ title: "Test train", undoable: true });
    expect(del.lines).toEqual(expect.arrayContaining(["Amount: ₹3,000"]));

    const res = await api(me)(`/history/${del.id}/undo`, { method: "POST" });
    expect(res.status).toBe(200);
    const back = await json<{ record: RecordView }>(res);
    expect(back.record.named).toMatchObject({ Title: "Test train", Amount: "₹3,000", Trip: ["Test Goa"] });
    expect(await spent()).toBe("₹13,000");
    // It's found again, and the delete shows as undone (and can't be undone twice).
    const found = await json<{ items: RecordView[] }>(
      await api(me)("/collections/Costs/find", { body: { search: "Test train" } }),
    );
    expect(found.items.map((i) => i.id)).toEqual([train.id]);
    expect((await history(me)).find((h) => h.id === del.id)).toMatchObject({ undoable: false });
    expect((await api(me)(`/history/${del.id}/undo`, { method: "POST" })).status).toBe(409);
    expect(trip.id).toBeTruthy();
  });

  it("brings back what a delete took with it", async () => {
    const me = await signUp("Test Undoer");
    const { trip, cost } = await trips(me);
    const a = await cost("Test train", "3000");
    const b = await cost("Test hotel", "8000");
    const out = await json<{ deleted: string[] }>(await api(me)(`/records/${trip.id}`, { method: "DELETE" }));
    expect(out.deleted.sort()).toEqual([trip.id, a.id, b.id].sort());
    const del = (await history(me)).find((h) => h.action === "delete_record" && h.record_id === trip.id)!;
    expect(del.also_restores).toBe(2);
    await api(me)(`/history/${del.id}/undo`, { method: "POST" });
    const back = await json<RecordView>(await api(me)(`/records/${trip.id}`));
    expect(back.named.Spent).toBe("₹11,000");
    expect((await json<RecordView>(await api(me)(`/records/${a.id}`))).named.Trip).toEqual(["Test Goa"]);
    expect((await json<RecordView>(await api(me)(`/records/${b.id}`))).named.Trip).toEqual(["Test Goa"]);
  });

  it("won't overwrite a later change without asking", async () => {
    const me = await signUp("Test Undoer");
    const r = await json<RecordView>(
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: "Test cab", Amount: "500" } },
      }),
    );
    await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { Amount: "600" } } });
    await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { Amount: "700" } } });
    // A change to another field later doesn't get in the way.
    await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { What: "Test taxi" } } });
    const h = await history(me);
    const first = h.find((x) => x.lines[0] === "Amount: ₹500 → ₹600")!;
    expect(first.changed_since).toEqual({ by: ["you"], fields: ["Amount"] });
    const stopped = await api(me)(`/history/${first.id}/undo`, { method: "POST" });
    expect(stopped.status).toBe(409);
    const err = (await json<{ error: { message: string; details: { reason: string } } }>(stopped)).error;
    expect(err.details.reason).toBe("changed_since");
    expect(err.message).toMatch(/^You changed Amount after this/);
    // Still ₹700: nothing was put back.
    expect((await json<RecordView>(await api(me)(`/records/${r.id}`))).named.Amount).toBe("₹700");
    // Asked and agreed: put back.
    const forced = await json<{ record: RecordView }>(
      await api(me)(`/history/${first.id}/undo`, { method: "POST", body: { force: true } }),
    );
    expect(forced.record.named).toMatchObject({ Amount: "₹500", What: "Test taxi" });
    // The newest change has nothing after it.
    const latest = (await history(me)).find((x) => x.lines[0] === "What: Test cab → Test taxi")!;
    expect(latest.changed_since).toBeNull();
  });

  it("asks before undoing an add that was changed since", async () => {
    const me = await signUp("Test Undoer");
    const r = await json<RecordView>(
      await api(me)("/collections/Expenses/records", {
        body: { values: { What: "Test tea", Amount: "40" } },
      }),
    );
    await api(me)(`/records/${r.id}`, { method: "PATCH", body: { values: { Amount: "50" } } });
    const add = (await history(me)).find((x) => x.action === "add_record")!;
    expect(add.changed_since).toEqual({ by: ["you"], fields: ["Amount"] });
    expect((await api(me)(`/history/${add.id}/undo`, { method: "POST" })).status).toBe(409);
    expect((await api(me)(`/records/${r.id}`)).status).toBe(200);
    await api(me)(`/history/${add.id}/undo`, { method: "POST", body: { force: true } });
    expect((await api(me)(`/records/${r.id}`)).status).toBe(404);
  });

  it("shows what a workflow did because of a change, and undoes it too when asked", async () => {
    const me = await signUp("Test Undoer");
    await api(me)("/workflows", {
      body: {
        name: "Big costs",
        when: { event: "added", collection: "Expenses" },
        check: [{ field: "Amount", op: "gt", value: "5000" }],
        then: [
          { do: "add", collection: "Notes", values: { Title: "Test check {What}" } },
          { do: "notify", text: "Big expense: {What}", to: ["me"] },
        ],
        enabled: true,
      },
    });
    await api(me)("/collections/Expenses/records", {
      body: { values: { What: "Test amp", Amount: "6000" } },
    });
    const notes = async () =>
      (
        await json<{ items: RecordView[] }>(
          await api(me)("/collections/Notes/find", { body: { search: "Test check" } }),
        )
      ).items;
    expect(await until(async () => (await notes()).length === 1)).toBe(true);
    let item!: HistoryItem;
    expect(
      await until(async () => {
        item = (await history(me)).find((h) => h.action === "add_record" && h.title === "Test amp")!;
        return item.followups.length === 1 && item.told.length === 1;
      }),
    ).toBe(true);
    expect(item.followups[0]).toMatchObject({ line: "Added “Test check Test amp”", undoable: true });
    expect(item.told).toEqual(["you"]);

    // Something it didn't lead to is refused.
    expect(
      (
        await api(me)(`/history/${item.id}/undo`, {
          method: "POST",
          body: { with: ["01J00000000000000000000000"] },
        })
      ).status,
    ).toBe(400);

    const out = await json<{ also: string[] }>(
      await api(me)(`/history/${item.id}/undo`, { method: "POST", body: { with: [item.followups[0]!.id] } }),
    );
    expect(out.also).toEqual([item.followups[0]!.id]);
    expect(await notes()).toEqual([]);
    const amp = await json<{ items: RecordView[] }>(
      await api(me)("/collections/Expenses/find", { body: { search: "Test amp" } }),
    );
    expect(amp.items).toEqual([]);
  });

  it("keeps what a workflow did when only the change is undone", async () => {
    const me = await signUp("Test Undoer");
    await api(me)("/workflows", {
      body: {
        name: "Echo",
        when: { event: "added", collection: "Expenses" },
        then: [{ do: "add", collection: "Notes", values: { Title: "Test echo {What}" } }],
        enabled: true,
      },
    });
    await api(me)("/collections/Expenses/records", {
      body: { values: { What: "Test pick", Amount: "100" } },
    });
    let item!: HistoryItem;
    expect(
      await until(async () => {
        item = (await history(me)).find((h) => h.action === "add_record" && h.title === "Test pick")!;
        return item.followups.length === 1;
      }),
    ).toBe(true);
    await api(me)(`/history/${item.id}/undo`, { method: "POST" });
    const notes = await json<{ items: RecordView[] }>(
      await api(me)("/collections/Notes/find", { body: { search: "Test echo" } }),
    );
    expect(notes.items.map((n) => n.title)).toEqual(["Test echo Test pick"]);
  });
});
