// R1 step 2: gig-centric gigs over HTTP (docs/design/gig-centric.md). Each gig is its own
// Durable Object; access comes from the gig's people and roles. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, MyEventView, Page } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const inDays = (d: number, hh = "19:00") => {
  const t = new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
  return `${t}T${hh}`;
};

const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function createGig(u: User, body: Record<string, unknown> = {}, key?: string) {
  return as(u)("/gigs", {
    body: {
      title: "Test Sangeet",
      event_type: "wedding",
      client: { name: "Test Client Co", phone: "+91 90000 00000" },
      events: [{ title: "Sangeet", start_at: inDays(10), venue_name: "Test Hall", venue_city: "Pune" }],
      ...body,
    },
    idempotencyKey: key,
  });
}

const myGigs = async (u: User, q = "") => json<Page<MyEventView>>(await as(u)(`/me/gigs${q}`));

describe("creating gigs", () => {
  it("creates a gig with events and people, and makes the creator a manager", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const res = await createGig(owner, {
      people: [
        { email: mate.email, role: "player" },
        { name: "Test Stand-in", phone: "+91 90000 00001" },
      ],
    });
    expect(res.status).toBe(201);
    const gig = await json<BookingView>(res);
    expect(gig).toMatchObject({
      title: "Test Sangeet",
      event_type: "wedding",
      status: "enquiry",
      version: 1,
      client: { name: "Test Client Co", phone: "+91 90000 00000", organisation: null },
      my_role: "manager",
    });
    expect(gig.events).toMatchObject([
      {
        title: "Sangeet",
        venue_name: "Test Hall",
        venue_city: "Pune",
        start_display: expect.stringContaining("7:00 pm IST"),
      },
    ]);
    expect(gig.people.map((p) => [p.name, p.role, p.has_account, p.is_me])).toEqual([
      ["Test Owner", "manager", true, true],
      ["Test Mate", "player", true, false],
      ["Test Stand-in", "player", false, false],
    ]);
  });

  it("gives a retried create the same gig, and refuses a different request with the same key", async () => {
    const owner = await signUp();
    const first = await json<BookingView>(await createGig(owner, {}, "create-1"));
    const again = await createGig(owner, {}, "create-1");
    expect(again.status).toBe(201);
    expect((await json<BookingView>(again)).id).toBe(first.id);
    const other = await createGig(owner, { title: "Something else" }, "create-1");
    expect(other.status).toBe(409);
  });

  it("validates input and needs sign-in", async () => {
    const owner = await signUp();
    expect((await createGig(owner, { events: [] })).status).toBe(400);
    expect((await createGig(owner, { people: [{ user_id: "01NOPE" }] })).status).toBe(400);
    expect(
      (await createGig(owner, { events: [{ start_at: inDays(3, "22:00"), end_at: inDays(3, "20:00") }] }))
        .status,
    ).toBe(400);
    expect((await call("/api/gigs", { body: { title: "x" } })).status).toBe(401);
  });
});

describe("access and edits", () => {
  it("shows the gig only to its people; only managers change it; stale versions are refused", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const stranger = await signUp();
    const gig = await json<BookingView>(await createGig(owner, { people: [{ user_id: mate.id }] }));

    expect((await json<BookingView>(await as(mate)(`/gigs/${gig.id}`))).my_role).toBe("player");
    expect((await as(stranger)(`/gigs/${gig.id}`)).status).toBe(404);
    expect(
      (await as(mate)(`/gigs/${gig.id}`, { method: "PATCH", body: { version: 1, title: "X" } })).status,
    ).toBe(403);

    const edited = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}`, {
        method: "PATCH",
        body: { version: 1, title: "Test Sangeet (edited)", client: null },
      }),
    );
    expect(edited).toMatchObject({ title: "Test Sangeet (edited)", client: null, version: 2 });
    const stale = await as(owner)(`/gigs/${gig.id}`, {
      method: "PATCH",
      body: { version: 1, notes: "late" },
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.details).toMatchObject({
      reason: "version_mismatch",
      current_version: 2,
    });

    const history = await json<{ action: string }[]>(await as(owner)(`/gigs/${gig.id}/history`));
    expect(history.map((h) => h.action)).toEqual(["update_gig", "create_gig"]);
    expect((await as(mate)(`/gigs/${gig.id}/history`)).status).toBe(403);
  });

  it("moves through statuses and refuses impossible ones", async () => {
    const owner = await signUp();
    const gig = await json<BookingView>(await createGig(owner));
    const status = (action: string, reason?: string) =>
      as(owner)(`/gigs/${gig.id}/status`, { body: { action, reason } });
    expect((await json<BookingView>(await status("confirm"))).status).toBe("confirmed");
    expect((await json<BookingView>(await status("confirm"))).status).toBe("confirmed"); // no-op
    expect((await json<BookingView>(await status("complete"))).status).toBe("completed");
    const res = await status("cancel", "Too late");
    expect(res.status).toBe(409);
    expect((await json(res)).error.details).toMatchObject({ reason: "invalid_transition" });
  });

  it("adds, edits and removes events, keeping at least one", async () => {
    const owner = await signUp();
    const gig = await json<BookingView>(await createGig(owner));
    const added = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/events`, {
        body: { title: "Reception", start_at: inDays(11, "20:00"), venue_name: "Test Lawn" },
      }),
    );
    expect(added.events.map((e) => e.title)).toEqual(["Sangeet", "Reception"]);
    const reception = added.events[1]!;
    const moved = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/events/${reception.id}`, {
        method: "PATCH",
        body: { version: added.version, start_at: inDays(9, "20:00") },
      }),
    );
    expect(moved.events.map((e) => e.title)).toEqual(["Reception", "Sangeet"]); // sorted by time
    const removed = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/events/${reception.id}`, { method: "DELETE" }),
    );
    expect(removed.events.map((e) => e.title)).toEqual(["Sangeet"]);
    const last = await as(owner)(`/gigs/${gig.id}/events/${removed.events[0]!.id}`, { method: "DELETE" });
    expect(last.status).toBe(409);
  });

  it("adds people, changes roles, keeps a manager, and removed people lose access", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const gig = await json<BookingView>(await createGig(owner));
    const withMate = await json<BookingView>(
      await as(owner)(`/gigs/${gig.id}/people`, { body: { email: mate.email.toUpperCase() } }),
    );
    const matePerson = withMate.people.find((p) => p.name === "Test Mate")!;
    expect(matePerson).toMatchObject({ role: "player", has_account: true });
    expect((await as(owner)(`/gigs/${gig.id}/people`, { body: { user_id: mate.id } })).status).toBe(409);

    // Owner can't step down while they're the only manager.
    const ownerPerson = withMate.people.find((p) => p.is_me)!;
    const stepDown = await as(owner)(`/gigs/${gig.id}/people/${ownerPerson.id}`, {
      method: "PATCH",
      body: { role: "player" },
    });
    expect(stepDown.status).toBe(409);

    // Promote the mate; now the mate can edit.
    await as(owner)(`/gigs/${gig.id}/people/${matePerson.id}`, {
      method: "PATCH",
      body: { role: "manager" },
    });
    const current = await json<BookingView>(await as(mate)(`/gigs/${gig.id}`));
    expect(current.my_role).toBe("manager");
    // The mate removes the owner; the owner loses access.
    const removed = await as(mate)(`/gigs/${gig.id}/people/${ownerPerson.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await as(owner)(`/gigs/${gig.id}`)).status).toBe(404);
  });
});

describe("my gigs", () => {
  it("lists the events I'm on from my own summaries, in pages", async () => {
    const owner = await signUp();
    const mate = await signUp();
    const g1 = await json<BookingView>(
      await createGig(owner, { title: "Test One", people: [{ user_id: mate.id }] }),
    );
    await json<BookingView>(
      await createGig(owner, {
        title: "Test Two",
        events: [
          { title: "Mehendi", start_at: inDays(20, "17:00") },
          { title: "Reception", start_at: inDays(21, "20:00") },
        ],
      }),
    );

    const mine = await waitFor(
      () => myGigs(owner),
      (p) => p.items.length === 3,
    );
    expect(mine.items.map((i) => [i.gig_title, i.event_title, i.role])).toEqual([
      ["Test One", "Sangeet", "manager"],
      ["Test Two", "Mehendi", "manager"],
      ["Test Two", "Reception", "manager"],
    ]);
    expect(mine.items[0]).toMatchObject({ client_name: "Test Client Co", event_type: "wedding" });

    const page1 = await myGigs(owner, "?limit=2");
    expect(page1.items).toHaveLength(2);
    const page2 = await myGigs(owner, `?limit=2&cursor=${page1.next_cursor}`);
    expect(page2.items.map((i) => i.event_title)).toEqual(["Reception"]);
    expect(page2.next_cursor).toBeNull();

    // The mate sees only the gig they're on, as a player.
    const mates = await waitFor(
      () => myGigs(mate),
      (p) => p.items.length === 1,
    );
    expect(mates.items.map((i) => [i.gig_title, i.role])).toEqual([["Test One", "player"]]);

    // Deleting the gig removes it from everyone's list.
    expect((await as(owner)(`/gigs/${g1.id}`, { method: "DELETE" })).status).toBe(200);
    await waitFor(
      () => myGigs(mate),
      (p) => p.items.length === 0,
    );
    expect((await myGigs(mate)).items).toEqual([]);
    expect((await as(owner)(`/gigs/${g1.id}`)).status).toBe(404);
  });
});
