// R1 step 5: collective and custom tags, autofill, people added before they had an
// account, and duplicate warnings. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  AutofillView,
  BookingView,
  DuplicateWarning,
  MyEventView,
  MyReportView,
  MyTagView,
  Page,
} from "@assistant/shared";
import { env } from "cloudflare:workers";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const day = (d: number) => new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
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

async function create(u: User, body: Record<string, unknown>) {
  const res = await as(u)("/gigs", {
    body: { title: "Test Gig", events: [{ start_at: `${day(10)}T19:00`, venue_name: "Test Hall" }], ...body },
  });
  expect(res.status).toBe(201);
  return json<BookingView>(res);
}

describe("tags", () => {
  it("keeps one tag however it's typed, suggests my tags, and filters reports by them", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const a = await create(owner, {
      title: "Test A",
      collective: "Test Monsoon Project",
      tags: ["Wedding", "Out of town"],
      people: [{ user_id: mate.id }],
    });
    const b = await create(mate, {
      title: "Test B",
      collective: "test  monsoon project",
      tags: ["wedding"],
      people: [{ user_id: owner.id }],
    });
    expect(b.collective!.id).toBe(a.collective!.id);
    expect(b.tags[0]!.id).toBe(a.tags[0]!.id);
    expect(a.tags.map((t) => t.name)).toEqual(["Wedding", "Out of town"]);

    const tags = await waitFor(
      async () => json<MyTagView[]>(await as(owner)("/me/tags")),
      (t) => t.find((x) => x.name === "Wedding")?.gigs === 2,
    );
    expect(tags.map((t) => [t.kind, t.gigs])).toEqual([
      ["collective", 2],
      ["custom", 2],
      ["custom", 1],
    ]);

    const range = `from=${day(0)}&to=${day(30)}`;
    const report = async (q: string) =>
      (await json<MyReportView>(await as(owner)(`/me/report?${range}&${q}`))).gigs.map((g) => g.gig_title);
    expect(await report("collective=Test%20Monsoon%20Project")).toEqual(["Test A", "Test B"]);
    expect(await report("tags=wedding,out%20of%20town")).toEqual(["Test A"]);
    expect(await report("tags=Nope")).toEqual([]);

    // Players and strangers can't add tags to the shared registry through an edit.
    const stranger = await signUp("Test Stranger");
    for (const u of [mate, stranger]) {
      const res = await as(u)(`/gigs/${a.id}`, {
        method: "PATCH",
        body: { version: a.version, tags: [`Test Spam ${u.id}`] },
      });
      expect([403, 404]).toContain(res.status);
      const row = await env.DB.prepare(`select count(*) as n from tags where name = ?`)
        .bind(`Test Spam ${u.id}`)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
    }

    // Clearing the collective on an edit.
    const edited = await json<BookingView>(
      await as(owner)(`/gigs/${a.id}`, {
        method: "PATCH",
        body: { version: a.version, collective: null, tags: [] },
      }),
    );
    expect(edited).toMatchObject({ collective: null, tags: [] });
  });

  it("fills in the people from my last gig with that collective, names only", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const hidden = await signUp("Test Hidden");
    await create(owner, {
      collective: "Test Autofill Band",
      people: [{ user_id: mate.id }, { name: "Test Dep" }],
    });
    const fill = await waitFor(
      async () => json<AutofillView>(await as(owner)("/me/autofill?collective=test%20autofill%20band")),
      (f) => f.people.length === 2,
    );
    expect(fill.people).toEqual([
      { user_id: mate.id, name: "Test Mate" },
      { user_id: null, name: "Test Dep" },
    ]);

    // A player who may not see the lineup gets nothing from that gig.
    await create(owner, {
      collective: "Test Private Band",
      settings: { players_see_lineup: false },
      people: [{ user_id: hidden.id }, { name: "Test Dep" }],
    });
    await waitFor(
      async () => json<Page<MyEventView>>(await as(hidden)("/me/gigs")),
      (p) => p.items.length === 1,
    );
    const none = await json<AutofillView>(await as(hidden)("/me/autofill?collective=Test%20Private%20Band"));
    expect(none).toEqual({ from_gig: null, people: [] });
  });
});

describe("people without accounts", () => {
  it("attaches gigs to an account when that email signs up", async () => {
    const owner = await signUp("Test Owner");
    const email = `test-later-${Date.now()}@example.com`;
    const gig = await create(owner, { people: [{ email, name: "Test Later" }] });
    expect(gig.people.find((p) => p.name === "Test Later")!.has_account).toBe(false);

    const later = await signUp("Test Later", email);
    const mine = await waitFor(
      async () => json<Page<MyEventView>>(await as(later)("/me/gigs")),
      (p) => p.items.length === 1,
    );
    expect(mine.items[0]).toMatchObject({ gig_id: gig.id, role: "player" });
    const view = await json<BookingView>(await as(later)(`/gigs/${gig.id}`));
    expect(view.people.find((p) => p.is_me)).toMatchObject({ name: "Test Later", has_account: true });
  });
});

describe("duplicate warnings", () => {
  it("warns only about gigs of people I've played with, by venue or client", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const stranger = await signUp("Test Stranger");
    await create(owner, { title: "Test Together", people: [{ user_id: mate.id }] });
    const date = day(20);
    await create(mate, {
      title: "Test Mate's Gig",
      client: { name: "Test Client Co" },
      events: [{ start_at: `${date}T20:00`, venue_name: "Test Grand Hall" }],
    });

    const check = (u: User, q: string) =>
      as(u)(`/me/duplicates?start_at=${date}T18:00&${q}`).then((r) => json<DuplicateWarning[]>(r));
    const warnings = await waitFor(
      () => check(owner, "venue_name=test%20grand%20%20hall"),
      (w) => w.length === 1,
    );
    expect(warnings[0]).toMatchObject({
      manager_name: "Test Mate",
      venue_name: "Test Grand Hall",
      match: "venue",
    });
    expect(warnings[0]!.message).toContain("Test Mate has a gig on");
    expect(await check(owner, "client_name=TEST%20CLIENT%20CO")).toMatchObject([{ match: "client" }]);
    expect(await check(stranger, "venue_name=Test%20Grand%20Hall")).toEqual([]);
    expect(await check(mate, "venue_name=Test%20Grand%20Hall")).toEqual([]); // my own gig
    expect(await check(owner, "venue_name=Elsewhere")).toEqual([]);
  });
});
