// Deleting a space (decision 2026-11-05 "The space is the setup"): it leaves everyone's spaces,
// its links stop working and its flows stop; Recently deleted brings it all back. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import type { CreatedShare, DeletedSpace, SpaceView, WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("deleting a space", () => {
  it("takes the whole setup away for everyone, and brings it back", async () => {
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Club" } }));
    const q = `?space=${sp.id}`;
    await api(me)("/collections", {
      body: { space: sp.id, name: "Test Requests", fields: [{ name: "Title", type: "text" }] },
    });
    const flow = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          space: sp.id,
          name: "Test tell me",
          when: { event: "added", collection: "Test Requests" },
          then: [{ do: "notify", text: "{Title}", to: ["me"] }],
          enabled: true,
        },
      }),
    );
    const { link, share } = await json<CreatedShare>(
      await api(me)("/shares", { body: { space: sp.id, form: "Test Requests", for: "Members" } }),
    );
    const friend = await signUp("Test Friend");
    await api(friend)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    const friendCards = async () =>
      (await json<{ share_id: string }[]>(await api(friend)("/cards"))).map((c) => c.share_id);
    expect(await friendCards()).toContain(share.id);

    // Personal can't be deleted; the space can, by its owner.
    expect((await api(me)("/spaces/Personal", { method: "DELETE" })).status).toBe(400);
    expect((await api(friend)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);

    const spaces = async () => (await json<SpaceView[]>(await api(me)("/spaces"))).map((s) => s.name);
    expect(await spaces()).not.toContain("Test Club");
    // The friend's link stops working.
    expect(await friendCards()).not.toContain(share.id);
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(404);
    // Its name can be used again meanwhile; in Recently deleted, only for its owner.
    const listed = await json<DeletedSpace[]>(await api(me)("/trash/spaces"));
    expect(listed.map((d) => [d.name, d.lists])).toEqual([["Test Club", 1]]);
    expect(await json<DeletedSpace[]>(await api(friend)("/trash/spaces"))).toEqual([]);
    expect((await api(friend)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(404);

    // Back as it was: the space, the friend's link, the flow on.
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(200);
    expect(await spaces()).toContain("Test Club");
    expect(await friendCards()).toContain(share.id);
    const flows = await json<WorkflowView[]>(await api(me)(`/workflows${q}`));
    expect(flows.find((w) => w.id === flow.id)?.enabled).toBe(true);
    expect(await json<DeletedSpace[]>(await api(me)("/trash/spaces"))).toEqual([]);
  });

  it("leaves search, and comes back to it", async () => {
    // Codex on PR 230: its records stayed in the members' search indexes for good.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Found" } }));
    await api(me)("/collections", {
      body: { space: sp.id, name: "Test Notes", fields: [{ name: "Title", type: "text" }] },
    });
    await api(me)(`/collections/Test Notes/records?space=${sp.id}`, {
      body: { values: { Title: "Test zorbleplum" } },
    });
    const index = env.SEARCH.getByName(`search:${me.id}`);
    const hits = async () => (await index.query("zorbleplum")).length;
    const until = async (n: number) => {
      for (let i = 0; i < 80 && (await hits()) !== n; i++) await new Promise((r) => setTimeout(r, 100));
      return hits();
    };
    expect(await until(1)).toBe(1);
    await api(me)(`/spaces/${sp.id}`, { method: "DELETE" });
    expect(await hits()).toBe(0);
    expect(await until(0)).toBe(0);
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(200);
    expect(await until(1)).toBe(1);
  });

  it("isn't deleted again by a late retry after it came back", async () => {
    // Codex on PR 230: the same Idempotency-Key after a restore deleted it a second time.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Twice" } }));
    const del = () => api(me)(`/spaces/${sp.id}`, { method: "DELETE", idempotencyKey: "test-key-1" });
    expect((await del()).status).toBe(200);
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(200);
    expect((await del()).status).toBe(200);
    expect((await json<SpaceView[]>(await api(me)("/spaces"))).map((s) => s.name)).toContain("Test Twice");
  });

  it("isn't brought back by a late retry after it was deleted again", async () => {
    // Codex on PR 230: the same Idempotency-Key after a second delete restored it again.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Again" } }));
    const restore = () =>
      api(me)(`/trash/spaces/${sp.id}/restore`, { body: {}, idempotencyKey: "test-restore-1" });
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await restore()).status).toBe(200);
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await restore()).status).toBe(200);
    expect((await json<SpaceView[]>(await api(me)("/spaces"))).map((s) => s.name)).not.toContain(
      "Test Again",
    );
    expect((await json<DeletedSpace[]>(await api(me)("/trash/spaces"))).map((d) => d.name)).toContain(
      "Test Again",
    );
  });

  it("is erased whole once its time is up, questions and all", async () => {
    // Codex on PR 230: questions asked outside a flow kept their words and answers for good.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Old Club" } }));
    await api(me)("/collections", {
      body: { space: sp.id, name: "Test Things", fields: [{ name: "Title", type: "text" }] },
    });
    const stub = env.SPACES.getByName(`space:${sp.id}`);
    await runInDurableObject(stub, async (_i, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `insert into questions (id, text, share_id, created_at) values ('q1', 'Test marzipan?', 'sh1', '2026-01-01')`,
      );
      sql.exec(
        `insert into question_answers (question_id, user_id, answer, at) values ('q1', 'u1', 'Yes', '2026-01-01')`,
      );
    });
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    // Its time is up.
    await runInDurableObject(stub, async (_i, state) => {
      state.storage.sql.exec(
        `update _meta set value = '2000-01-01T00:00:00.000Z' where key = 'space_deleted_at'`,
      );
    });
    await runDurableObjectAlarm(stub).catch(() => undefined);
    let left: unknown = "not read";
    for (let i = 0; i < 20 && left === "not read"; i++)
      left = await env.SPACES.getByName(`space:${sp.id}`)
        .exportData()
        .catch(async () => {
          await new Promise((r) => setTimeout(r, 100));
          return "not read";
        });
    expect(left).toBeNull();
    expect(await json<DeletedSpace[]>(await api(me)("/trash/spaces"))).toEqual([]);
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(404);
  });

  it("holds back a message waiting to go out, and sends it if it comes back", async () => {
    // Codex on PR 230: a pending message reached the inbox after the space was deleted.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Quiet" } }));
    const stub = env.SPACES.getByName(`space:${sp.id}`);
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    const waiting = () =>
      runInDurableObject(stub, async (_i, state) =>
        Number(state.storage.sql.exec(`select count(*) as n from workflow_notes`).one().n),
      );
    await runInDurableObject(stub, async (_i, state) => {
      state.storage.sql.exec(
        `insert into workflow_notes (id, user_id, note_json, next_at) values ('n1', ?, ?, '2000-01-01T00:00:00.000Z')`,
        me.id,
        JSON.stringify({ kind: "message", title: "Test held back" }),
      );
    });
    await runDurableObjectAlarm(stub);
    expect(await waiting()).toBe(1);
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(200);
    await runDurableObjectAlarm(stub);
    expect(await waiting()).toBe(0);
  });

  it("tells the screens that have it open that it's gone", async () => {
    // Codex on PR 230: the deleted space's change note never went out, so open homes kept it.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Seen" } }));
    const stub = env.SPACES.getByName(`space:${sp.id}`);
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    await runDurableObjectAlarm(stub);
    const left = await runInDurableObject(stub, async (_i, state) =>
      Number(state.storage.sql.exec(`select count(*) as n from _outbox`).one().n),
    );
    expect(left).toBe(0);
  });

  it("tells open screens again once the space list says it's gone", async () => {
    // Codex on PR 230: the ping could go out before the list was updated, and nothing followed.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Late List" } }));
    const stub = env.SPACES.getByName(`space:${sp.id}`);
    // The space deletes and its ping goes out before the list hears of it.
    await stub.deleteSpace({ userId: me.id, source: "web" });
    await runDurableObjectAlarm(stub);
    const notes = () =>
      runInDurableObject(stub, async (_i, state) =>
        Number(state.storage.sql.exec(`select count(*) as n from _outbox`).one().n),
      );
    expect(await notes()).toBe(0);
    // The list is updated now: another ping is owed.
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await notes()).toBe(1);
  });

  it("keeps listing a rehearsal it couldn't erase, so it can still be ended", async () => {
    // Codex on PR 230: a copy whose erase failed was hidden with its data left behind.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Stuck" } }));
    // A copy whose object won't end (it was never made a practice copy).
    const stuck = `01STUCK${crypto.randomUUID().replace(/-/g, "").slice(0, 19).toUpperCase()}`;
    await env.DB.batch([
      env.DB.prepare(
        `insert into spaces (id, name, kind, owner_user_id, practice_of) values (?, 'Practice: Test Stuck', 'shared', ?, ?)`,
      ).bind(stuck, me.id, sp.id),
      env.DB.prepare(`insert into space_members (space_id, user_id, role) values (?, ?, 'owner')`).bind(
        stuck,
        me.id,
      ),
    ]);
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);
    const row = await env.DB.prepare(`select deleted_at from spaces where id = ?`)
      .bind(stuck)
      .first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeNull();
  });

  it("erases its rehearsals' copies with it", async () => {
    // Codex on PR 230: the copies were hidden but kept the data for good.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Rehearsed" } }));
    await api(me)("/collections", {
      body: { space: sp.id, name: "Test Things", fields: [{ name: "Title", type: "text" }] },
    });
    const copy = await json<SpaceView>(await api(me)(`/spaces/${sp.id}/practice`, { body: {} }));
    expect(await env.SPACES.getByName(`space:${copy.id}`).exportData()).not.toBeNull();
    await api(me)(`/spaces/${sp.id}`, { method: "DELETE" });
    // Erasing resets the copy's object; it answers again once it has started over, empty.
    let left: unknown = "not read";
    for (let i = 0; i < 20 && left === "not read"; i++)
      left = await env.SPACES.getByName(`space:${copy.id}`)
        .exportData()
        .catch(async () => {
          await new Promise((r) => setTimeout(r, 100));
          return "not read";
        });
    expect(left).toBeNull();
  });

  it("can be restored again after a restore that got only half way", async () => {
    // Codex on PR 230: the space's object was back but the space list still said deleted, and
    // a second restore was refused, leaving it stranded.
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Half" } }));
    await api(me)(`/spaces/${sp.id}`, { method: "DELETE" });
    await env.SPACES.getByName(`space:${sp.id}`).restoreSpace({ userId: me.id, source: "web" });
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(200);
    expect((await json<SpaceView[]>(await api(me)("/spaces"))).map((s) => s.name)).toContain("Test Half");
  });

  it("says when a space with that name is back already", async () => {
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Home" } }));
    await api(me)(`/spaces/${sp.id}`, { method: "DELETE" });
    await api(me)("/spaces", { body: { name: "Test Home" } });
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(409);
  });
});
