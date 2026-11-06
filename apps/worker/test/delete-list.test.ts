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

  it("leaves the lists that link to it working", async () => {
    // Codex on PR 230: a link to the deleted list broke sharing the setup that's left.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Homes", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Guests",
        fields: [
          { name: "Title", type: "text" },
          { name: "Home", type: "link", options: { target: "Test Homes" } },
        ],
      },
    });
    const home = await json<RecordView>(
      await api(me)("/collections/Test Homes/records", { body: { values: { Title: "Test A1" } } }),
    );
    await api(me)("/collections/Test Guests/records", {
      body: { values: { Title: "Test guest", Home: [home.id] } },
    });
    expect((await api(me)("/collections/Test Homes", { method: "DELETE" })).status).toBe(200);
    // The list that's left reads, adds, and travels as a setup.
    expect((await api(me)("/collections")).status).toBe(200);
    expect((await api(me)("/collections/Test Guests")).status).toBe(200);
    expect(
      (await api(me)("/collections/Test Guests/records", { body: { values: { Title: "Test later" } } }))
        .status,
    ).toBe(201);
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const setup = (await env.SPACES.getByName(`space:${space!.id}`).describeSetup(
      { userId: me.id, source: "web" },
      null,
    )) as unknown as { collections: { name: string }[] };
    expect(setup.collections.map((c) => c.name)).toContain("Test Guests");
    expect(setup.collections.map((c) => c.name)).not.toContain("Test Homes");
    // And rehearses.
    const copy = await api(me)("/spaces/Personal/practice", { body: {} });
    expect(copy.status).toBeLessThan(300);
    const practice = await json<SpaceView>(copy);
    expect(
      (await api(me)(`/spaces/${practice.id}/practice/run`, { body: { collection: "Test Guests" } })).status,
    ).not.toBe(500);
    await api(me)(`/spaces/${practice.id}/practice`, { method: "DELETE" });
  });

  it("brings the totals it fed down to nothing when erased", async () => {
    // Codex on PR 230: an order still totalled 12 after its line items were erased.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Orders", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Items",
        fields: [
          { name: "Title", type: "text" },
          { name: "N", type: "number" },
          { name: "Order", type: "link", options: { target: "Test Orders" } },
        ],
      },
    });
    expect(
      (
        await api(me)("/collections/Test Orders/fields", {
          body: {
            field: {
              name: "Total",
              type: "number",
              options: { rollup: { via: "Test Items", fn: "sum", of: "N" } },
            },
          },
        })
      ).status,
    ).toBe(201);
    const order = await json<RecordView>(
      await api(me)("/collections/Test Orders/records", { body: { values: { Title: "Test order" } } }),
    );
    await api(me)("/collections/Test Items/records", {
      body: { values: { Title: "Test item", N: 12, Order: [order.id] } },
    });
    const orders = await json<{ fields: { id: string; name: string }[] }>(
      await api(me)("/collections/Test Orders"),
    );
    const totalId = orders.fields.find((x) => x.name === "Total")!.id;
    const total = async () =>
      (await json<RecordView>(await api(me)(`/records/${order.id}`))).values[totalId] ?? null;
    expect(await total()).toBe(12);
    await api(me)("/collections/Test Items", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    expect([0, null]).toContain(await total());
  });

  it("erases an answered question with the list too", async () => {
    // Codex on PR 230: a question answered before the delete kept its words, answers and link.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Done Asks", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/workflows", {
      body: {
        name: "Test ask once",
        when: { event: "added", collection: "Test Done Asks" },
        then: [{ do: "ask", who: ["me"], text: "OK {Title}?", choices: ["Yes", "No"] }],
        enabled: true,
      },
    });
    await api(me)("/collections/Test Done Asks/records", { body: { values: { Title: "Test quillwort" } } });
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
    expect(qs[0]?.text).toContain("quillwort");
    expect((await api(me)(`/cards/${qs[0]!.share_id}/answer`, { body: { answer: "Yes" } })).status).toBe(200);
    // The run has gone on: nothing waits on the question any more.
    const waits = () =>
      inSpace(me, (sql) => Number(sql.exec(`select count(*) as n from workflow_waits`).one().n));
    for (let i = 0; i < 40 && (await waits()) > 0; i++) await new Promise((r) => setTimeout(r, 200));
    expect(await waits()).toBe(0);
    await api(me)("/collections/Test Done Asks", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    const after = await asked();
    expect(after.map((q) => q.text)).toEqual([""]);
    expect(after[0]!.revoked).not.toBeNull();
    const answers = await inSpace(me, (sql) =>
      Number(sql.exec(`select count(*) as n from question_answers`).one().n),
    );
    expect(answers).toBe(0);
  });

  it("erases a question asked before questions kept their flow", async () => {
    // Codex on PR 230: questions from before the upgrade have no flow or record on them.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Old Asks", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/workflows", {
      body: {
        name: "Test ask long ago",
        when: { event: "added", collection: "Test Old Asks" },
        then: [{ do: "ask", who: ["me"], text: "OK {Title}?", choices: ["Yes", "No"] }],
        enabled: true,
      },
    });
    await api(me)("/collections/Test Old Asks/records", { body: { values: { Title: "Test bramblewick" } } });
    const asked = () =>
      inSpace(me, (sql) =>
        sql
          .exec<{ id: string; text: string; share_id: string }>(`select id, text, share_id from questions`)
          .toArray(),
      );
    let qs = await asked();
    for (let i = 0; i < 40 && !qs.length; i++) {
      await new Promise((r) => setTimeout(r, 200));
      qs = await asked();
    }
    expect((await api(me)(`/cards/${qs[0]!.share_id}/answer`, { body: { answer: "Yes" } })).status).toBe(200);
    const waits = () =>
      inSpace(me, (sql) => Number(sql.exec(`select count(*) as n from workflow_waits`).one().n));
    for (let i = 0; i < 40 && (await waits()) > 0; i++) await new Promise((r) => setTimeout(r, 200));
    // As it was before the upgrade: no flow or record on it.
    await inSpace(me, (sql) => sql.exec(`update questions set workflow_id = null, record_id = null`));
    await api(me)("/collections/Test Old Asks", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    expect((await asked()).map((q) => q.text)).toEqual([""]);
  });

  it("reads a field whose name has a dot in it as one name", async () => {
    // Codex on PR 230: {Fee.total} was read as a link Fee, so it stayed once Fee.total went.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Venues",
        fields: [
          { name: "Title", type: "text" },
          { name: "Rate", type: "number" },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Bookings2",
        fields: [
          { name: "Title", type: "text" },
          { name: "Venue", type: "link", options: { target: "Test Venues" } },
        ],
      },
    });
    for (const field of [
      { name: "Fee.total", type: "number", options: { formula: "{Venue.Rate} * 2" } },
      { name: "Double", type: "number", options: { formula: "{Fee.total} * 2" } },
    ])
      expect((await api(me)("/collections/Test Bookings2/fields", { body: { field } })).status).toBe(201);
    await api(me)("/collections/Test Venues", { method: "DELETE" });
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const setup = (await env.SPACES.getByName(`space:${space!.id}`).describeSetup(
      { userId: me.id, source: "web" },
      ["Test Bookings2"],
    )) as unknown as { collections: { name: string; fields: { name: string }[] }[] };
    expect(setup.collections[0]!.fields.map((f) => f.name)).toEqual(["Title"]);
    const friend = await signUp("Test Friend");
    expect((await api(friend)("/setups", { body: setup })).status).toBe(201);
  });

  it("works out again the formulas that read it through a link when erased", async () => {
    // Codex on PR 230: {Client.Rate} * 2 still read 24 after Clients was erased.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Clients",
        fields: [
          { name: "Title", type: "text" },
          { name: "Rate", type: "number" },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Jobs",
        fields: [
          { name: "Title", type: "text" },
          { name: "Client", type: "link", options: { target: "Test Clients" } },
        ],
      },
    });
    expect(
      (
        await api(me)("/collections/Test Jobs/fields", {
          body: { field: { name: "Double", type: "number", options: { formula: "{Client.Rate} * 2" } } },
        })
      ).status,
    ).toBe(201);
    const client = await json<RecordView>(
      await api(me)("/collections/Test Clients/records", { body: { values: { Title: "Test C", Rate: 12 } } }),
    );
    const job = await json<RecordView>(
      await api(me)("/collections/Test Jobs/records", {
        body: { values: { Title: "Test J", Client: [client.id] } },
      }),
    );
    const jobs = await json<{ fields: { id: string; name: string }[] }>(
      await api(me)("/collections/Test Jobs"),
    );
    const doubleId = jobs.fields.find((x) => x.name === "Double")!.id;
    const double = async () =>
      (await json<RecordView>(await api(me)(`/records/${job.id}`))).values[doubleId] ?? null;
    expect(await double()).toBe(24);
    await api(me)("/collections/Test Clients", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    expect(await double()).not.toBe(24);
  });

  it("travels as a setup that can be made, without the formulas that read it", async () => {
    // Codex on PR 230: {Client.Rate} * 2 stayed in the setup once Client was left out, and
    // making it failed with "No field Client.Rate".
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Firms",
        fields: [
          { name: "Title", type: "text" },
          { name: "Rate", type: "number" },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Gigs",
        fields: [
          { name: "Title", type: "text" },
          { name: "Firm", type: "link", options: { target: "Test Firms" } },
        ],
      },
    });
    for (const field of [
      { name: "Double", type: "number", options: { formula: "{Firm.Rate} * 2" } },
      { name: "Quad", type: "number", options: { formula: "{Double} * 2" } },
    ])
      expect((await api(me)("/collections/Test Gigs/fields", { body: { field } })).status).toBe(201);
    // A view filtered on the link that stays behind (Codex on PR 230).
    expect(
      (
        await api(me)("/views", {
          body: { name: "Test No firm", collection: "Test Gigs", filters: [{ field: "Firm", op: "empty" }] },
        })
      ).status,
    ).toBe(201);
    // And a rule on it: one gig per firm (Codex on PR 230).
    expect(
      (await api(me)("/collections/Test Gigs/rules", { body: { kind: "unique", fields: ["Firm"] } })).status,
    ).toBe(201);
    await api(me)("/collections/Test Firms", { method: "DELETE" });
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const setup = (await env.SPACES.getByName(`space:${space!.id}`).describeSetup(
      { userId: me.id, source: "web" },
      ["Test Gigs"],
    )) as unknown as { collections: { name: string; fields: { name: string }[] }[] };
    expect(setup.collections.map((c) => c.name)).toEqual(["Test Gigs"]);
    expect(setup.collections[0]!.fields.map((f) => f.name)).toEqual(["Title"]);
    const friend = await signUp("Test Friend");
    expect((await api(friend)("/setups", { body: setup })).status).toBe(201);
  });

  it("leaves out formulas reading a left-out field across a link", async () => {
    // Codex on PR 230: Orders' {Client.Rate} * 2 stayed while Clients' Rate (from the deleted
    // Firms) was left out, and making the setup failed.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Agencies",
        fields: [
          { name: "Title", type: "text" },
          { name: "Rate", type: "number" },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Buyers",
        fields: [
          { name: "Title", type: "text" },
          { name: "Agency", type: "link", options: { target: "Test Agencies" } },
        ],
      },
    });
    await api(me)("/collections/Test Buyers/fields", {
      body: { field: { name: "Rate", type: "number", options: { formula: "{Agency.Rate} * 2" } } },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Sales",
        fields: [
          { name: "Title", type: "text" },
          { name: "Buyer", type: "link", options: { target: "Test Buyers" } },
        ],
      },
    });
    expect(
      (
        await api(me)("/collections/Test Sales/fields", {
          body: { field: { name: "Fee", type: "number", options: { formula: "{Buyer.Rate} * 2" } } },
        })
      ).status,
    ).toBe(201);
    await api(me)("/collections/Test Agencies", { method: "DELETE" });
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const setup = (await env.SPACES.getByName(`space:${space!.id}`).describeSetup(
      { userId: me.id, source: "web" },
      ["Test Sales"],
    )) as unknown as { collections: { name: string; fields: { name: string }[] }[] };
    const sales = setup.collections.find((c) => c.name === "Test Sales")!;
    expect(sales.fields.map((f) => f.name)).not.toContain("Fee");
    const friend = await signUp("Test Friend");
    expect((await api(friend)("/setups", { body: setup })).status).toBe(201);
  });

  it("leaves out totals over a left-out field", async () => {
    // Codex on PR 230: Orders' Total summed Clients' Fee, Fee was left out once Firms was
    // deleted, and making the setup failed with "Say which field to sum".
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Studios",
        fields: [
          { name: "Title", type: "text" },
          { name: "Rate", type: "number" },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Artists",
        fields: [
          { name: "Title", type: "text" },
          { name: "Studio", type: "link", options: { target: "Test Studios" } },
        ],
      },
    });
    await api(me)("/collections/Test Artists/fields", {
      body: { field: { name: "Fee", type: "number", options: { formula: "{Studio.Rate} * 2" } } },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Shows",
        fields: [
          { name: "Title", type: "text" },
          { name: "Artists", type: "link", options: { target: "Test Artists", many: true } },
        ],
      },
    });
    expect(
      (
        await api(me)("/collections/Test Shows/fields", {
          body: {
            field: {
              name: "Total",
              type: "number",
              options: { rollup: { via: "Artists", fn: "sum", of: "Fee" } },
            },
          },
        })
      ).status,
    ).toBe(201);
    await api(me)("/collections/Test Studios", { method: "DELETE" });
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const setup = (await env.SPACES.getByName(`space:${space!.id}`).describeSetup(
      { userId: me.id, source: "web" },
      ["Test Shows"],
    )) as unknown as { collections: { name: string; fields: { name: string }[] }[] };
    expect(setup.collections.find((c) => c.name === "Test Shows")!.fields.map((f) => f.name)).not.toContain(
      "Total",
    );
    const friend = await signUp("Test Friend");
    expect((await api(friend)("/setups", { body: setup })).status).toBe(201);
  });

  it("lets go of what its records linked to when erased", async () => {
    // Codex on PR 230: a firm an erased client linked to (block on delete) couldn't be deleted.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Offices", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Staff",
        fields: [
          { name: "Title", type: "text" },
          { name: "Office", type: "link", options: { target: "Test Offices", on_delete: "block" } },
        ],
      },
    });
    const office = await json<RecordView>(
      await api(me)("/collections/Test Offices/records", { body: { values: { Title: "Test HQ" } } }),
    );
    await api(me)("/collections/Test Staff/records", {
      body: { values: { Title: "Test Asha", Office: [office.id] } },
    });
    await api(me)("/collections/Test Staff", { method: "DELETE" });
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(me)(`/records/${office.id}`, { method: "DELETE" })).status).toBeLessThan(300);
  });

  it("leaves out formulas that read a left-out field by its alias", async () => {
    // Codex on PR 230: {Customer.Rate} for a link named Client (alias Customer) stayed.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: {
        name: "Test Patrons",
        fields: [
          { name: "Title", type: "text" },
          { name: "Rate", type: "number" },
        ],
      },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Tabs",
        fields: [
          { name: "Title", type: "text" },
          { name: "Patron", type: "link", options: { target: "Test Patrons" }, aliases: ["Guest"] },
        ],
      },
    });
    expect(
      (
        await api(me)("/collections/Test Tabs/fields", {
          body: { field: { name: "Double", type: "number", options: { formula: "{Guest.Rate} * 2" } } },
        })
      ).status,
    ).toBe(201);
    await api(me)("/collections/Test Patrons", { method: "DELETE" });
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const setup = (await env.SPACES.getByName(`space:${space!.id}`).describeSetup(
      { userId: me.id, source: "web" },
      ["Test Tabs"],
    )) as unknown as { collections: { name: string; fields: { name: string }[] }[] };
    expect(setup.collections[0]!.fields.map((f) => f.name)).toEqual(["Title"]);
    const friend = await signUp("Test Friend");
    expect((await api(friend)("/setups", { body: setup })).status).toBe(201);
  });

  it("tags a nudge with its flow, so it's held back with the list", async () => {
    // Codex on PR 230: a nudge waiting to go out had no flow, and went out after the delete.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Nudged", fields: [{ name: "Title", type: "text" }] },
    });
    const flow = await json<{ id: string }>(
      await api(me)("/workflows", {
        body: {
          name: "Test ask again",
          when: { event: "added", collection: "Test Nudged" },
          then: [{ do: "ask", who: ["me"], text: "OK {Title}?", choices: ["Yes", "No"] }],
          enabled: true,
        },
      }),
    );
    await api(me)("/collections/Test Nudged/records", { body: { values: { Title: "Test one" } } });
    let waitId: string | undefined;
    for (let i = 0; i < 40 && !waitId; i++) {
      waitId = await inSpace(
        me,
        (sql) => sql.exec<{ id: string }>(`select id from workflow_waits limit 1`).toArray()[0]?.id,
      );
      if (!waitId) await new Promise((r) => setTimeout(r, 200));
    }
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const stub = env.SPACES.getByName(`space:${space!.id}`);
    // Nudged and read in one go inside the space, before its alarm can send them (CI: they
    // were sometimes gone already).
    const tagged = await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(`delete from workflow_notes`);
      const space = instance as unknown as {
        nudgeNow: (a: { userId: string; source: string }, k: null, id: string) => Promise<unknown>;
      };
      await space.nudgeNow({ userId: me.id, source: "web" }, null, waitId!);
      return state.storage.sql
        .exec<{ workflow_id: string | null }>(`select workflow_id from workflow_notes`)
        .toArray();
    });
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((n) => n.workflow_id === flow.id)).toBe(true);
    await api(me)("/collections/Test Nudged", { method: "DELETE" });
    expect(
      await inSpace(me, (sql) => Number(sql.exec(`select count(*) as n from workflow_notes`).one().n)),
    ).toBe(0);
  });

  it("works out the totals over it again when it comes back", async () => {
    // Codex on PR 230: an order edited while its items were away kept 0 after they came back.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Baskets", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)("/collections", {
      body: {
        name: "Test Fruit",
        fields: [
          { name: "Title", type: "text" },
          { name: "N", type: "number" },
          { name: "Basket", type: "link", options: { target: "Test Baskets" } },
        ],
      },
    });
    await api(me)("/collections/Test Baskets/fields", {
      body: {
        field: {
          name: "Total",
          type: "number",
          options: { rollup: { via: "Test Fruit", fn: "sum", of: "N" } },
        },
      },
    });
    const basket = await json<RecordView>(
      await api(me)("/collections/Test Baskets/records", { body: { values: { Title: "Test basket" } } }),
    );
    await api(me)("/collections/Test Fruit/records", {
      body: { values: { Title: "Test apple", N: 12, Basket: [basket.id] } },
    });
    const col = await json<{ fields: { id: string; name: string }[] }>(
      await api(me)("/collections/Test Baskets"),
    );
    const totalId = col.fields.find((x) => x.name === "Total")!.id;
    const total = async () =>
      (await json<RecordView>(await api(me)(`/records/${basket.id}`))).values[totalId] ?? null;
    expect(await total()).toBe(12);
    await api(me)("/collections/Test Fruit", { method: "DELETE" });
    // Away, it counts for nothing (Codex on PR 230: the total kept counting its records).
    expect([0, null]).toContain(await total());
    await api(me)(`/records/${basket.id}`, { method: "PATCH", body: { values: { Title: "Test basket 2" } } });
    expect([0, null]).toContain(await total());
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    expect((await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} })).status).toBe(200);
    expect(await total()).toBe(12);
  });

  it("holds back its flows' messages while away, and sends them when it comes back", async () => {
    // Codex on PR 230: a message waiting to go out was sent after its list was deleted.
    const me = await signUp("Test Owner");
    await api(me)("/collections", {
      body: { name: "Test Quiet", fields: [{ name: "Title", type: "text" }] },
    });
    const flow = await json<{ id: string }>(
      await api(me)("/workflows", {
        body: {
          name: "Test tell",
          when: { event: "added", collection: "Test Quiet" },
          then: [{ do: "notify", text: "{Title}", to: ["me"] }],
          enabled: true,
        },
      }),
    );
    await api(me)("/collections/Test Quiet", { method: "DELETE" });
    const notes = () =>
      inSpace(me, (sql) =>
        Number(sql.exec(`select count(*) as n from workflow_notes where workflow_id = ?`, flow.id).one().n),
      );
    // Restored, a message it had waiting is there to go out again.
    await inSpace(me, (sql) => {
      const t = sql.exec<{ took_json: string }>(`select took_json from list_trash`).one();
      const took = JSON.parse(t.took_json) as { runs: { notes?: unknown[] } };
      took.runs.notes = [
        {
          id: "n1",
          user_id: me.id,
          note_json: JSON.stringify({ kind: "message", title: "Test" }),
          attempts: 0,
          next_at: "2100-01-01T00:00:00.000Z",
          workflow_id: flow.id,
        },
      ];
      sql.exec(`update list_trash set took_json = ?`, JSON.stringify(took));
    });
    expect(await notes()).toBe(0);
    const [t] = await json<DeletedList[]>(await api(me)("/trash/lists"));
    await api(me)(`/trash/lists/${t!.collection_id}/restore`, { body: {} });
    expect(await notes()).toBe(1);
  });

  it("takes its flows' waiting messages aside when deleted", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections", { body: { name: "Test Hush", fields: [{ name: "Title", type: "text" }] } });
    const flow = await json<{ id: string }>(
      await api(me)("/workflows", {
        body: {
          name: "Test tell 2",
          when: { event: "added", collection: "Test Hush" },
          then: [{ do: "notify", text: "{Title}", to: ["me"] }],
          enabled: true,
        },
      }),
    );
    await inSpace(me, (sql) =>
      sql.exec(
        `insert into workflow_notes (id, user_id, note_json, next_at, workflow_id) values ('n2', ?, ?, '2100-01-01T00:00:00.000Z', ?)`,
        me.id,
        JSON.stringify({ kind: "message", title: "Test" }),
        flow.id,
      ),
    );
    await api(me)("/collections/Test Hush", { method: "DELETE" });
    const left = await inSpace(me, (sql) =>
      Number(sql.exec(`select count(*) as n from workflow_notes where workflow_id = ?`, flow.id).one().n),
    );
    expect(left).toBe(0);
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
