// Recently deleted (decision 2026-10-14): deleted records wait 30 days, can be restored or
// deleted forever, and are then erased (values, comments and the history's copies of them).
// Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { HistoryItem, RecordView, SpaceView, TrashItem } from "@assistant/shared";
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

const trash = async (me: User, q = "") => json<TrashItem[]>(await api(me)(`/trash${q}`));
const expense = async (me: User, what: string, amount: string) =>
  json<RecordView>(
    await api(me)("/collections/Expenses/records", { body: { values: { What: what, Amount: amount } } }),
  );

/** Runs SQL inside my Personal space (to move time on). */
async function inSpace<T>(me: User, run: (sql: SqlStorage, storage: DurableObjectStorage) => T | Promise<T>) {
  const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
  const stub = env.SPACES.getByName(`space:${space!.id}`);
  return runInDurableObject(stub, async (_i, state) => run(state.storage.sql, state.storage));
}

describe("recently deleted", () => {
  it("lists deleted records, newest first, and restores one", async () => {
    const me = await signUp("Test Binner");
    const a = await expense(me, "Test cab", "300");
    const b = await expense(me, "Test tea", "40");
    await api(me)(`/records/${a.id}`, { method: "DELETE" });
    await api(me)(`/records/${b.id}`, { method: "DELETE" });
    const list = await trash(me);
    expect(list.map((t) => t.title)).toEqual(["Test tea", "Test cab"]);
    expect(list[1]).toMatchObject({ collection: "Expenses", deleted_by: "you" });
    expect(list[1]!.lines).toEqual(expect.arrayContaining(["Amount: ₹300"]));
    const days = (Date.parse(list[1]!.erase_at) - Date.parse(list[1]!.deleted_at)) / 86_400_000;
    expect(days).toBe(30);
    // One list's only.
    expect(await trash(me, "?collection=Notes")).toEqual([]);

    const back = await json<{ record: RecordView }>(
      await api(me)(`/trash/${a.id}/restore`, { method: "POST" }),
    );
    expect(back.record.named).toMatchObject({ What: "Test cab", Amount: "₹300" });
    expect((await trash(me)).map((t) => t.title)).toEqual(["Test tea"]);
    // Restoring again: it's already back.
    expect((await api(me)(`/trash/${a.id}/restore`, { method: "POST" })).status).toBe(409);
  });

  it("deletes forever: the values, comments and history details are gone", async () => {
    const me = await signUp("Test Binner");
    const r = await expense(me, "Test secret gift", "2500");
    await api(me)(`/records/${r.id}/comments`, { body: { body: "Test for Asha's birthday" } });
    await api(me)(`/records/${r.id}`, { method: "DELETE" });
    const res = await api(me)(`/trash/${r.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await json<{ erased: string[] }>(res)).erased).toEqual([r.id]);
    expect(await trash(me)).toEqual([]);
    expect((await api(me)(`/trash/${r.id}/restore`, { method: "POST" })).status).toBe(404);
    // Nothing of it is left in what changed, nor stored anywhere in the space.
    const history = await json<HistoryItem[]>(await api(me)("/history?limit=30"));
    expect(history.some((h) => h.record_id === r.id)).toBe(false);
    const left = await inSpace(me, (sql) => ({
      record: sql
        .exec<{ values_json: string; title: string }>(
          `select values_json, title from records where id = ?`,
          r.id,
        )
        .one(),
      audit: sql
        .exec<{ n: number }>(
          `select count(*) as n from _audit where entity_id = ? and (before_json like '%secret%' or after_json like '%secret%')`,
          r.id,
        )
        .one().n,
      comments: sql
        .exec<{ n: number }>(
          `select count(*) as n from comments where record_id = ? and body like '%birthday%'`,
          r.id,
        )
        .one().n,
    }));
    expect(left).toEqual({ record: { values_json: "{}", title: "" }, audit: 0, comments: 0 });
  });

  it("erases what's been there 30 days, on its own", async () => {
    const me = await signUp("Test Binner");
    const old = await expense(me, "Test old bill", "100");
    const fresh = await expense(me, "Test new bill", "200");
    await api(me)(`/records/${old.id}`, { method: "DELETE" });
    await api(me)(`/records/${fresh.id}`, { method: "DELETE" });
    // 31 days pass for the first one.
    await inSpace(me, async (sql, storage) => {
      sql.exec(
        `update records set deleted_at = ? where id = ?`,
        new Date(Date.now() - 31 * 86_400_000).toISOString(),
        old.id,
      );
      await storage.setAlarm(Date.now() + 50);
    });
    expect(await until(async () => (await trash(me)).length === 1)).toBe(true);
    expect((await trash(me)).map((t) => t.title)).toEqual(["Test new bill"]);
    const purged = await inSpace(me, (sql) =>
      sql
        .exec<{ title: string; purged_at: string | null }>(
          `select title, purged_at from records where id = ?`,
          old.id,
        )
        .one(),
    );
    expect(purged.title).toBe("");
    expect(purged.purged_at).not.toBeNull();
  });

  it("lists a delete that took others with it once; restoring brings them all", async () => {
    const me = await signUp("Test Binner");
    await api(me)("/collections", { body: { name: "Trips", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections", {
      body: {
        name: "Costs",
        fields: [
          { name: "Title", type: "text" },
          { name: "Trip", type: "link", options: { target: "Trips", on_delete: "cascade" } },
        ],
      },
    });
    const trip = await json<RecordView>(
      await api(me)("/collections/Trips/records", { body: { values: { Title: "Test Goa" } } }),
    );
    const cost = await json<RecordView>(
      await api(me)("/collections/Costs/records", {
        body: { values: { Title: "Test train", Trip: trip.id } },
      }),
    );
    await api(me)(`/records/${trip.id}`, { method: "DELETE" });
    const list = await trash(me);
    expect(list.map((t) => [t.title, t.also_restores])).toEqual([["Test Goa", 1]]);
    await api(me)(`/trash/${trip.id}/restore`, { method: "POST" });
    expect((await json<RecordView>(await api(me)(`/records/${cost.id}`))).named.Trip).toEqual(["Test Goa"]);
  });

  it("is only for people who can change the space", async () => {
    const me = await signUp("Test Binner");
    const other = await signUp("Test Stranger");
    const r = await expense(me, "Test lunch", "150");
    await api(me)(`/records/${r.id}`, { method: "DELETE" });
    expect((await api(other)(`/trash/${r.id}/restore`, { method: "POST" })).status).toBe(404);
    expect((await api(other)(`/trash/${r.id}`, { method: "DELETE" })).status).toBe(404);
    expect(await trash(other)).toEqual([]);
  });
});
