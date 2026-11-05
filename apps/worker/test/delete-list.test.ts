// Deleting a list (owner, 2026-11-05: "How do I delete the setup?"): the list goes to Recently
// deleted with its views, flows, rules and share links, and comes back with exactly those.
// Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type {
  CollectionView,
  CreatedShare,
  DeletedList,
  RecordView,
  SavedView,
  SpaceView,
  WorkflowView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

/** Runs SQL inside my Personal space. */
async function inSpace<T>(me: User, run: (sql: SqlStorage) => T) {
  const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
  return runInDurableObject(env.SPACES.getByName(`space:${space!.id}`), async (_i, state) =>
    run(state.storage.sql),
  );
}

describe("deleting a list", () => {
  it("takes its views, flows and links with it, and brings them all back", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Visitors",
        fields: [
          { name: "Title", type: "text" },
          { name: "Status", type: "text" },
        ],
      },
    });
    const rec = await json<RecordView>(
      await api(me)("/collections/Test Visitors/records", { body: { values: { Title: "Test courier" } } }),
    );
    await api(me)("/views", {
      body: { name: "Test at the gate", collection: "Test Visitors", pinned: true },
    });
    const flow = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          name: "Test tell me",
          when: { event: "added", collection: "Test Visitors" },
          then: [{ do: "notify", text: "{Title}", to: ["me"] }],
          enabled: true,
        },
      }),
    );
    const { share } = await json<CreatedShare>(
      await api(me)("/shares", { body: { form: "Test Visitors", for: "Guards" } }),
    );
    // A view of another list stays.
    await api(me)("/views", { body: { name: "Test notes view", collection: "Notes" } });

    const del = await api(me)("/collections/Test Visitors", { method: "DELETE" });
    expect(del.status).toBe(200);
    const names = async () =>
      (await json<CollectionView[]>(await api(me)("/collections"))).map((c) => c.name);
    expect(await names()).not.toContain("Test Visitors");
    const views = async () => (await json<SavedView[]>(await api(me)("/views"))).map((v) => v.name);
    expect(await views()).not.toContain("Test at the gate");
    expect(await views()).toContain("Test notes view");
    expect((await json<WorkflowView[]>(await api(me)("/workflows"))).some((w) => w.id === flow.id)).toBe(
      false,
    );
    const shares = async () => (await json<{ id: string }[]>(await api(me)("/shares"))).map((s) => s.id);
    expect(await shares()).not.toContain(share.id);
    // Its records can't be opened or found while it's away.
    expect((await api(me)(`/records/${rec.id}`)).status).toBe(404);
    const found = await json<{ kind: string; title?: string }[]>(await api(me)("/search?q=courier"));
    expect(found.some((h) => h.title === "Test courier")).toBe(false);

    const trashed = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect(trashed.map((t) => [t.name, t.records, t.views, t.flows, t.links])).toEqual([
      ["Test Visitors", 1, 1, 1, 1],
    ]);

    // Its name is free again; restoring while another list has it says so.
    await api(me)("/collections", {
      body: { name: "Test Visitors", fields: [{ name: "Title", type: "text" }] },
    });
    const clash = await api(me)(`/trash/lists/${trashed[0]!.collection_id}/restore`, { body: {} });
    expect(clash.status).toBe(409);
    await api(me)("/collections/Test Visitors", { method: "DELETE" });
    // Back, with exactly what it took: the view, the flow (on, as it was), the link, the record.
    const back = await api(me)(`/trash/lists/${trashed[0]!.collection_id}/restore`, { body: {} });
    expect(back.status).toBe(200);
    expect(await names()).toContain("Test Visitors");
    expect(await views()).toEqual(expect.arrayContaining(["Test at the gate", "Test notes view"]));
    const flows = await json<WorkflowView[]>(await api(me)("/workflows"));
    expect(flows.find((w) => w.id === flow.id)?.enabled).toBe(true);
    expect(await shares()).toContain(share.id);
    expect((await api(me)(`/records/${rec.id}`)).status).toBe(200);
    // The other "Test Visitors" (deleted after) is still in Recently deleted.
    expect((await json<DeletedList[]>(await api(me)("/trash/lists"))).map((t) => t.records)).toEqual([0]);
  });

  it("erases a deleted list for good", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Test Old", fields: [{ name: "Title", type: "text" }] } });
    const rec = await json<RecordView>(
      await api(me)("/collections/Test Old/records", { body: { values: { Title: "Test secret" } } }),
    );
    await api(me)("/collections/Test Old", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    expect(await json<DeletedList[]>(await api(me)("/trash/lists"))).toEqual([]);
    expect((await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} })).status).toBe(404);
    expect((await api(me)(`/records/${rec.id}`)).status).toBe(404);
    // Nothing of its values stays, the search copies included (Codex on PR 230).
    const left = await inSpace(me, (sql) => ({
      values: sql.exec(`select count(*) as n from record_values where record_id = ?`, rec.id).one().n,
      words: sql.exec(`select count(*) as n from record_words where record_id = ?`, rec.id).one().n,
      title: sql.exec(`select title from records where id = ?`, rec.id).one().title,
    }));
    expect(left).toEqual({ values: 0, words: 0, title: "" });
  });

  it("leaves search when erased straight after the delete", async () => {
    // Codex on PR 230: erased before search caught up with the delete, its copies stayed.
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Test Gone", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections/Test Gone/records", { body: { values: { Title: "Test quibblefrond" } } });
    const index = env.SEARCH.getByName(`search:${me.id}`);
    const until = async (n: number) => {
      let hits = -1;
      for (let i = 0; i < 80; i++) {
        hits = (await index.query("quibblefrond")).length;
        if (hits === n) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return hits;
    };
    expect(await until(1)).toBe(1);
    await api(me)("/collections/Test Gone", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" });
    expect(await until(0)).toBe(0);
  });

  it("keeps a question that was waiting, and brings it back with the list", async () => {
    // Codex on PR 230: an approval waiting when the list was deleted was lost for good.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Asks",
        fields: [
          { name: "Title", type: "text" },
          { name: "Answer", type: "text" },
        ],
      },
    });
    await api(me)("/workflows", {
      body: {
        name: "Test ask me",
        when: { event: "added", collection: "Test Asks" },
        then: [{ do: "ask", who: ["me"], text: "OK {Title}?", choices: ["Yes", "No"], save_to: "Answer" }],
        enabled: true,
      },
    });
    await api(me)("/collections/Test Asks/records", { body: { values: { Title: "Test one" } } });
    const state = () =>
      inSpace(me, (sql) => ({
        waits: sql.exec(`select count(*) as n from workflow_waits`).one().n,
        open: sql.exec(`select count(*) as n from questions where closed_at is null`).one().n,
      }));
    let waiting = false;
    for (let i = 0; i < 40 && !waiting; i++) {
      waiting = (await state()).waits === 1;
      if (!waiting) await new Promise((r) => setTimeout(r, 200));
    }
    expect(await state()).toEqual({ waits: 1, open: 1 });
    await api(me)("/collections/Test Asks", { method: "DELETE" });
    expect(await state()).toEqual({ waits: 0, open: 0 });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} });
    expect(await state()).toEqual({ waits: 1, open: 1 });
  });

  it("erases a waiting question with the list, and its link stops working", async () => {
    // Codex on PR 230: after Delete forever the question kept the record's words, still open
    // to the people asked.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Gone Asks", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/workflows", {
      body: {
        name: "Test ask me too",
        when: { event: "added", collection: "Test Gone Asks" },
        then: [{ do: "ask", who: ["me"], text: "OK {Title}?", choices: ["Yes", "No"] }],
        enabled: true,
      },
    });
    await api(me)("/collections/Test Gone Asks/records", { body: { values: { Title: "Test zephyrine" } } });
    const asked = () =>
      inSpace(me, (sql) =>
        sql
          .exec<{ text: string; share_id: string; revoked: string | null }>(
            `select q.text, q.share_id, s.revoked_at as revoked from questions q join shares s on s.id = q.share_id`,
          )
          .toArray(),
      );
    let qs = await asked();
    for (let i = 0; i < 40 && !qs.length; i++) {
      await new Promise((r) => setTimeout(r, 200));
      qs = await asked();
    }
    expect(qs[0]?.text).toContain("zephyrine");
    await api(me)("/collections/Test Gone Asks", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    const after = await asked();
    expect(after.map((q) => q.text)).toEqual([""]);
    expect(after[0]!.revoked).not.toBeNull();
    expect((await api(me)(`/cards/${after[0]!.share_id}`)).status).toBe(404);
  });

  it("works its formulas out again when it comes back", async () => {
    // Codex on PR 230: a today() formula kept the value from before the delete.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Sums",
        fields: [
          { name: "Title", type: "text" },
          { name: "N", type: "number" },
          { name: "Twice", type: "number", options: { formula: "{N} * 2" } },
        ],
      },
    });
    const rec = await json<RecordView>(
      await api(me)("/collections/Test Sums/records", { body: { values: { Title: "Test a", N: 3 } } }),
    );
    await api(me)("/collections/Test Sums", { method: "DELETE" });
    // As if the day turned while it was away: its stored result is out of date.
    await inSpace(me, (sql) => {
      const r = sql
        .exec<{ values_json: string }>(`select values_json from records where id = ?`, rec.id)
        .one();
      const v = JSON.parse(r.values_json) as Record<string, unknown>;
      for (const k of Object.keys(v)) if (v[k] === 6) v[k] = 999;
      sql.exec(`update records set values_json = ? where id = ?`, JSON.stringify(v), rec.id);
    });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} })).status).toBe(200);
    const back = await json<RecordView>(await api(me)(`/records/${rec.id}`));
    expect(JSON.stringify(back)).not.toContain("999");
    expect(Object.values(back.values)).toContain(6);
  });

  it("brings a scheduled flow back with one next run, not two", async () => {
    // Codex on PR 230: restore scheduled a new run and put the kept one back, so both ran.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Daily", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/workflows", {
      body: {
        name: "Test every day",
        when: { event: "schedule", collection: "Test Daily", every: "day", at: "09:30" },
        then: [{ do: "notify", text: "Test morning", to: ["me"] }],
        enabled: true,
      },
    });
    const jobs = () => inSpace(me, (sql) => sql.exec(`select count(*) as n from workflow_jobs`).one().n);
    expect(await jobs()).toBe(1);
    await api(me)("/collections/Test Daily", { method: "DELETE" });
    expect(await jobs()).toBe(0);
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} });
    expect(await jobs()).toBe(1);
  });

  it("comes back when a view of its name was made meanwhile, and search can still be rebuilt", async () => {
    // Codex on PR 230: the restore failed on the views' unique names, and rebuilding search
    // threw on the deleted list's records.
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Test Gate", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections/Test Gate/records", { body: { values: { Title: "Test parcel" } } });
    await api(me)("/views", { body: { name: "Test At gate", collection: "Test Gate" } });
    await api(me)("/collections/Test Gate", { method: "DELETE" });
    expect((await api(me)("/search/rebuild", { body: {} })).status).toBeLessThan(300);
    await api(me)("/views", { body: { name: "Test At gate", collection: "Notes" } });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} })).status).toBe(200);
    const views = (await json<SavedView[]>(await api(me)("/views"))).map((v) => v.name);
    expect(views).toEqual(expect.arrayContaining(["Test At gate", "Test At gate 2"]));
  });

  it("leaves a shared card that showed records of the deleted list readable", async () => {
    // Codex on PR 230: the whole card failed to open once a list linking to it was deleted.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Trips", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Stops",
        fields: [
          { name: "Title", type: "text" },
          { name: "Trip", type: "link", options: { target: "Test Trips" } },
        ],
      },
    });
    const trip = await json<RecordView>(
      await api(me)("/collections/Test Trips/records", { body: { values: { Title: "Test Goa" } } }),
    );
    await api(me)("/collections/Test Stops/records", {
      body: { values: { Title: "Test beach", Trip: [trip.id] } },
    });
    const { link, share } = await json<CreatedShare>(
      await api(me)("/shares", { body: { record_id: trip.id, include: ["Test Stops"] } }),
    );
    const friend = await signUp("Test Friend");
    await api(friend)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(200);
    await api(me)("/collections/Test Stops", { method: "DELETE" });
    const opened = await api(friend)(`/cards/${share.id}`);
    expect(opened.status).toBe(200);
    expect(JSON.stringify(await opened.json())).not.toContain("Test beach");
    // And the owner's list of shares still loads, without the deleted part.
    const mine = await api(me)("/shares");
    expect(mine.status).toBe(200);
    expect(JSON.stringify(await mine.json())).not.toContain("Test Stops");
  });
});
