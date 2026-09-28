// R1 step 1: the gig-centric foundation (docs/design/gig-centric.md). Per-object storage,
// idempotency and audit inside the gig, the outbox → queue → consumer path, retries that
// never give up, the pending list, and the flush/rebuild tools. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { isoDateIST, ulid } from "@assistant/shared";
import type { Actor } from "../src/core/objects/storage.ts";
import { outboxNote } from "../src/core/objects/storage.ts";
import { toAppError } from "../src/core/objects/errors.ts";
import { flushOutboxes, rebuildSummaries } from "../src/modules/gigs/objects/delivery.ts";
import {
  bookingName,
  createdMonthOf,
  monthName,
  monthOf,
  pendingName,
  pendingShard,
  personName,
} from "../src/modules/gigs/objects/names.ts";
import type { BookingObject } from "../src/modules/gigs/objects/booking.ts";

const actor = (userId: string): Actor => ({ userId, source: "web" });
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

function newGig(managerId: string, playerId: string) {
  const gigId = ulid();
  const stub = env.BOOKINGS.getByName(bookingName(gigId));
  const input = {
    gig_id: gigId,
    title: "Test Sangeet",
    events: [{ title: "Sangeet", start_at: inDays(10), venue_name: "Test Hall" }],
    people: [
      { user_id: managerId, name: "Test Manager", email: null, phone: null, role: "manager" as const },
      { user_id: playerId, name: "Test Player", email: null, phone: null, role: "player" as const },
    ],
  };
  return { gigId, stub, input };
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return toAppError(err);
  }
  return null;
}

/** Makes the next hand-overs to the queue fail inside this gig's object. */
async function breakQueue(stub: DurableObjectStub<BookingObject>) {
  await runInDurableObject(stub, (instance) => {
    const e = (instance as unknown as { env: Env }).env;
    (instance as unknown as { env: Env }).env = {
      ...e,
      SUMMARIES: { send: async () => Promise.reject(new Error("queue down")) } as unknown as Queue,
    };
  });
}
async function fixQueue(stub: DurableObjectStub<BookingObject>) {
  await runInDurableObject(stub, (instance) => {
    (instance as unknown as { env: Env }).env = env;
  });
}

describe("booking object", () => {
  it("creates a gig with its people, idempotently, and audits it", async () => {
    const { stub, input, gigId } = newGig("user-m1", "user-p1");
    const view = await stub.create(input, actor("user-m1"), "key-1");
    expect(view).toMatchObject({
      id: gigId,
      title: "Test Sangeet",
      status: "enquiry",
      version: 1,
      my_role: "manager",
    });
    expect(view.people.map((p) => [p.user_id, p.role])).toEqual([
      ["user-m1", "manager"],
      ["user-p1", "player"],
    ]);

    // Same key, same request: same answer, nothing done twice.
    expect(await stub.create(input, actor("user-m1"), "key-1")).toEqual(view);
    // Same key, different request: refused.
    expect(await errorOf(stub.create({ ...input, title: "Other" }, actor("user-m1"), "key-1"))).toMatchObject(
      {
        code: "conflict",
        details: { reason: "idempotency_key_reused" },
      },
    );
    // New key: the gig already exists.
    expect((await errorOf(stub.create(input, actor("user-m1"), "key-2")))?.code).toBe("conflict");

    await runInDurableObject(stub, (_i, state) => {
      const rows = state.storage.sql.exec(`select action from _audit`).toArray();
      expect(rows.map((r) => r.action)).toEqual(["create_gig"]);
    });
  });

  it("only shows the gig to people on it, and only managers change it", async () => {
    const { stub, input } = newGig("user-m2", "user-p2");
    await stub.create(input, actor("user-m2"), null);
    expect((await stub.view(actor("user-p2"))).my_role).toBe("player");
    expect((await errorOf(stub.view(actor("user-stranger"))))?.code).toBe("not_found");
    expect((await errorOf(stub.rename("X", 1, actor("user-p2"), null)))?.code).toBe("forbidden");
  });

  it("refuses an edit based on an old version", async () => {
    const { stub, input } = newGig("user-m3", "user-p3");
    await stub.create(input, actor("user-m3"), null);
    expect((await stub.rename("Renamed", 1, actor("user-m3"), null)).version).toBe(2);
    const err = await errorOf(stub.rename("Again", 1, actor("user-m3"), null));
    expect(err).toMatchObject({
      code: "conflict",
      details: { reason: "version_mismatch", current_version: 2 },
    });
  });
});

describe("outbox → queue → summaries", () => {
  it("delivers a new gig to its people and its month index", async () => {
    const { stub, input, gigId } = newGig("user-m4", "user-p4");
    await stub.create(input, actor("user-m4"), null);
    // The alarm fires by itself right after the change and hands the note to the queue.
    await waitFor(
      () => runInDurableObject(stub, (_i, state) => outboxNote(state.storage.sql)),
      (note) => note === null,
    );

    const player = env.PEOPLE.getByName(personName("user-p4"));
    const rows = await waitFor(
      () => player.events(),
      (r) => r.length === 1,
    );
    expect(rows[0]).toMatchObject({
      gig_id: gigId,
      gig_title: "Test Sangeet",
      venue_name: "Test Hall",
      role: "player",
    });

    const startAt = input.events[0]!.start_at;
    const month = env.MONTHS.getByName(monthName(monthOf(startAt)));
    // Other tests' gigs share this month's index; look at this gig's card only.
    const mine = async () => (await month.onDate(isoDateIST(startAt))).filter((c) => c.gig_id === gigId);
    const cards = await waitFor(mine, (c) => c.length > 0);
    expect(cards).toMatchObject([
      { gig_id: gigId, venue_key: "test hall", status: "enquiry", manager_user_ids: ["user-m4"] },
    ]);

    // The gig registered itself for the rebuild tool.
    expect(await env.MONTHS.getByName(monthName(createdMonthOf(gigId))).createdGigs()).toContain(gigId);
  });

  it("merges several changes into one waiting note", async () => {
    const { stub, input } = newGig("user-m5", "user-p5");
    await breakQueue(stub); // hold notes back so the merge is visible
    await stub.create(input, actor("user-m5"), null);
    await stub.rename("Renamed once", 1, actor("user-m5"), null);
    await stub.rename("Renamed twice", 2, actor("user-m5"), null);
    await runInDurableObject(stub, (_i, state) => {
      expect(state.storage.sql.exec(`select count(*) as n from _outbox`).one().n).toBe(1);
      expect(outboxNote(state.storage.sql)?.seq).toBe(3);
    });
    await fixQueue(stub);
    await runDurableObjectAlarm(stub);
    const rows = await waitFor(
      () => env.PEOPLE.getByName(personName("user-p5")).events(),
      (r) => r[0]?.gig_title === "Renamed twice",
    );
    expect(rows[0]?.gig_title).toBe("Renamed twice");
  });

  it("keeps the note when the queue refuses, retries later, and joins the pending list", async () => {
    const { stub, input, gigId } = newGig("user-m6", "user-p6");
    await breakQueue(stub);
    await stub.create(input, actor("user-m6"), null);

    // The first try happens by itself right after the change, and fails.
    await waitFor(
      () => runInDurableObject(stub, (_i, state) => outboxNote(state.storage.sql)?.attempts ?? 0),
      (n) => n >= 1,
    );
    await runInDurableObject(stub, async (_i, state) => {
      expect(outboxNote(state.storage.sql)).toMatchObject({ seq: 1, attempts: 1 });
      const next = await state.storage.getAlarm();
      expect(next).not.toBeNull();
      expect(next! - Date.now()).toBeGreaterThan(1000); // waits before trying again
    });
    await runDurableObjectAlarm(stub); // force the retry now instead of waiting
    await runInDurableObject(stub, (_i, state) => expect(outboxNote(state.storage.sql)?.attempts).toBe(2));
    const pending = env.PENDING.getByName(pendingName(pendingShard(gigId)));
    expect((await pending.list()).map((w) => w.gig_id)).toContain(gigId);

    // Queue back: "Flush outboxes" sends it now and the gig leaves the pending list.
    await fixQueue(stub);
    expect((await flushOutboxes(env)).gigs).toBeGreaterThanOrEqual(1);
    await waitFor(
      () => runInDurableObject(stub, (_i, state) => outboxNote(state.storage.sql)),
      (note) => note === null,
    );
    expect((await pending.list()).map((w) => w.gig_id)).not.toContain(gigId);
    await waitFor(
      () => env.PEOPLE.getByName(personName("user-p6")).events(),
      (r) => r.length === 1,
    );
  });

  it("rebuilds summaries straight from the gigs, even if the queue never delivered", async () => {
    const { stub, input, gigId } = newGig("user-m7", "user-p7");
    // The gig registers itself, but every queue hand-over fails.
    await breakQueue(stub);
    await stub.create(input, actor("user-m7"), null);
    await waitFor(
      () => runInDurableObject(stub, (_i, state) => outboxNote(state.storage.sql)?.attempts ?? 0),
      (n) => n >= 1,
    );
    expect(await env.PEOPLE.getByName(personName("user-p7")).events()).toEqual([]);

    const month = createdMonthOf(gigId);
    expect((await rebuildSummaries(env, month, month)).gigs).toBeGreaterThanOrEqual(1);
    const rows = await env.PEOPLE.getByName(personName("user-p7")).events();
    expect(rows.map((r) => r.gig_id)).toEqual([gigId]);
    await fixQueue(stub);
  });
});

describe("receivers", () => {
  const row = (gigId: string, title: string) => ({
    gig_id: gigId,
    event_id: `${gigId}-e1`,
    gig_title: title,
    event_title: null,
    event_type: null,
    client_name: null,
    start_at: inDays(5),
    end_at: null,
    venue_name: null,
    status: "confirmed",
    role: "player" as const,
    part: null,
    share_paise: 0,
  });

  it("ignore older deliveries and accept repeats of the current one", async () => {
    const person = env.PEOPLE.getByName(personName("user-r1"));
    expect(await person.apply("gig-1", 5, [row("gig-1", "v5")])).toBe(true);
    expect(await person.apply("gig-1", 3, [row("gig-1", "v3")])).toBe(false); // out of order
    expect(await person.apply("gig-1", 5, [row("gig-1", "v5")])).toBe(true); // duplicate: harmless
    expect((await person.events()).map((r) => r.gig_title)).toEqual(["v5"]);
    expect(await person.apply("gig-1", 6, [])).toBe(true); // removed from the gig
    expect(await person.events()).toEqual([]);
  });

  it("run their schema migrations once", async () => {
    const person = env.PEOPLE.getByName(personName("user-r2"));
    await person.events();
    await runInDurableObject(person, (_i, state) => {
      expect(state.storage.sql.exec(`select version from _schema`).one().version).toBe(7);
    });
  });
});
