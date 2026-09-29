// API tokens for Siri Shortcuts and scripts (T09), and the spoken brief. Fake data only.
import { describe, expect, it } from "vitest";
import type { ApiTokenView, BookingView, BriefView, CreatedApiTokenView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const withToken =
  (token: string) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { bearer: token, ...init });

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function makeToken(u: User, name: string, write = false) {
  const res = await as(u)("/me/tokens", { body: { name, write } });
  expect(res.status).toBe(201);
  return json<CreatedApiTokenView>(res);
}

describe("API tokens", () => {
  it("read-only tokens read; they can't write or manage tokens, feeds or admin", async () => {
    const me = await signUp("Test Me");
    const t = await makeToken(me, "Test Siri");
    expect(t.token).toMatch(/^ast_/);
    expect(t.scopes).toEqual(["read"]);
    const api = withToken(t.token);

    expect((await api("/me/gigs")).status).toBe(200);
    expect((await api("/me")).status).toBe(200);
    const write = await api("/gigs", { body: { title: "Test", events: [{ start_at: "2026-12-12T19:00" }] } });
    expect(write.status).toBe(403);
    expect((await api("/me/tokens")).status).toBe(403);
    expect((await api("/me/tokens", { body: { name: "Sneaky", write: true } })).status).toBe(403);
    expect((await api("/me/calendar")).status).toBe(403);
    expect((await api("/admin/me")).status).toBe(401); // admin is sessions only
    expect((await api("/live")).status).toBe(401);

    // Listed without the secret; revoking stops it at once.
    const list = await json<ApiTokenView[]>(await as(me)("/me/tokens"));
    expect(list.map((x) => x.name)).toEqual(["Test Siri"]);
    expect(JSON.stringify(list)).not.toContain(t.token);
    expect((await as(me)(`/me/tokens/${t.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api("/me/gigs")).status).toBe(401);
    expect((await withToken("ast_" + "x".repeat(43))("/me/gigs")).status).toBe(401);
  });

  it("write tokens act as their owner, audited as siri, with idempotency", async () => {
    const me = await signUp("Test Me");
    const stranger = await signUp("Test Stranger");
    const t = await makeToken(me, "Test Siri", true);
    expect(t.scopes).toEqual(["read", "write"]);
    const api = withToken(t.token);

    const key = crypto.randomUUID();
    const body = {
      title: "Test Siri Gig",
      status: "confirmed",
      fee: "20000",
      events: [{ start_at: "2026-12-12T19:00" }],
    };
    const first = await api("/gigs", { body, idempotencyKey: key });
    expect(first.status).toBe(201);
    const gig = await json<BookingView>(first);
    const again = await json<BookingView>(await api("/gigs", { body, idempotencyKey: key }));
    expect(again.id).toBe(gig.id);
    expect((await api("/gigs", { body, idempotencyKey: null })).status).toBe(400); // key required

    const pay = await api(`/gigs/${gig.id}/payments`, {
      body: { amount: "5000", paid_on: "2026-12-12", method: "upi" },
    });
    expect(pay.status).toBe(201);
    const history = await json<{ source: string; action: string }[]>(await as(me)(`/gigs/${gig.id}/history`));
    expect(history.every((h) => h.source === "siri")).toBe(true);

    // Another person's token can't see my gig.
    const theirs = await makeToken(stranger, "Test Other");
    expect((await withToken(theirs.token)(`/gigs/${gig.id}`)).status).toBe(404);

    // A retried "make token" can't show the secret twice.
    const k2 = crypto.randomUUID();
    expect((await as(me)("/me/tokens", { body: { name: "Test Once" }, idempotencyKey: k2 })).status).toBe(
      201,
    );
    expect((await as(me)("/me/tokens", { body: { name: "Test Once" }, idempotencyKey: k2 })).status).toBe(
      409,
    );
  });
});

describe("brief (Siri)", () => {
  it("speaks my next gig, my week and what's owed", async () => {
    const me = await signUp("Test Me");
    const api = withToken((await makeToken(me, "Test Siri")).token);
    const empty = await json<BriefView>(await api("/me/brief?what=next"));
    expect(empty.text).toBe("You have no upcoming gigs.");

    const soon = new Date(Date.now() + 2 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    await as(me)("/gigs", {
      body: {
        title: "Test Wedding",
        status: "confirmed",
        events: [{ start_at: `${soon}T19:00`, venue_name: "Test Hall" }],
      },
    });
    const next = await waitFor(
      () => api("/me/brief?what=next").then((r) => json<BriefView>(r)),
      (b) => b.items.length > 0,
    );
    expect(next.text).toMatch(
      /^Your next gig is Test Wedding, \w{3}, \d{1,2} \w{3}, 7:00 pm, at Test Hall\.$/,
    );
    const week = await json<BriefView>(await api("/me/brief?what=week"));
    expect(week.text).toMatch(/^One gig in the next 7 days: Test Wedding/);
    const owed = await json<BriefView>(await api("/me/brief?what=owed_to_me"));
    expect(owed.text).toBe("Nobody owes you anything for gigs you've played.");
    expect((await api("/me/brief?what=nonsense")).status).toBe(400);
  });

  it("skips cancelled gigs and counts gigs, not events", async () => {
    const me = await signUp("Test Me");
    const api = withToken((await makeToken(me, "Test Siri")).token);
    const day = (d: number) => new Date(Date.now() + d * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    for (let i = 0; i < 3; i++) {
      const g = await json<BookingView>(
        await as(me)("/gigs", {
          body: { title: `Test Off ${i}`, status: "confirmed", events: [{ start_at: `${day(1)}T1${i}:00` }] },
        }),
      );
      await as(me)(`/gigs/${g.id}/status`, { body: { action: "cancel" } });
    }
    await as(me)("/gigs", {
      body: {
        title: "Test Two Day",
        status: "confirmed",
        events: [{ start_at: `${day(2)}T19:00` }, { start_at: `${day(3)}T19:00` }],
      },
    });
    const next = await waitFor(
      () => api("/me/brief?what=next").then((r) => json<BriefView>(r)),
      (b) => b.items.length > 0 && b.items[0]!.title === "Test Two Day",
    );
    expect(next.text).toMatch(/^Your next gig is Test Two Day/);
    const week = await json<BriefView>(await api("/me/brief?what=week"));
    expect(week.text).toMatch(/^One gig in the next 7 days: Test Two Day/);
    const pick = await json<{ choices: Record<string, string> }>(await api("/me/pick?q=test"));
    expect(Object.keys(pick.choices)).toHaveLength(1);
  });

  it("offers gigs and a gig's people to choose from", async () => {
    const me = await signUp("Test Me");
    const api = withToken((await makeToken(me, "Test Siri")).token);
    const gig = await json<BookingView>(
      await as(me)("/gigs", {
        body: {
          title: "Test Pick Gig",
          events: [{ start_at: "2026-12-12T19:00" }, { start_at: "2026-12-13T19:00" }],
          people: [{ name: "Test Drummer" }],
        },
      }),
    );
    const gigs = await waitFor(
      () => api("/me/pick?q=pick").then((r) => json<{ choices: Record<string, string> }>(r)),
      (p) => Object.keys(p.choices).length > 0,
    );
    expect(gigs.choices).toEqual({ "Test Pick Gig · Sat, 12 Dec": gig.id });
    const people = await json<{ choices: Record<string, string> }>(await api(`/me/pick?gig_id=${gig.id}`));
    expect(Object.keys(people.choices)).toEqual(["Test Drummer"]);
  });
});
