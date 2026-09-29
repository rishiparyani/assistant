// Guest lists: everyone adds their own guests within the limits; managers see all and
// share a secret link with the venue (read-only, or with door check-in). Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, GuestLinkView, SharedGuestListView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function band() {
  const manager = await signUp("Test Manager");
  const player = await signUp("Test Player");
  const other = await signUp("Test Other");
  const gig = await json<BookingView>(
    await as(manager)("/gigs", {
      body: {
        title: "Test Guest Gig",
        status: "confirmed",
        events: [{ start_at: "2026-12-12T20:00", venue_name: "Test Club", venue_city: "Test City" }],
        people: [{ user_id: player.id }, { user_id: other.id }],
      },
    }),
  );
  return { manager, player, other, gig };
}
const add = (u: User, gigId: string, guests: unknown[], extra: Record<string, unknown> = {}) =>
  as(u)(`/gigs/${gigId}/guests`, { body: { guests, ...extra } });

describe("guest lists", () => {
  it("players add their own guests and see only them; managers see everyone's", async () => {
    const { manager, player, other, gig } = await band();
    let res = await add(player, gig.id, [
      { name: "Test Guest A", plus_ones: 1 },
      { name: "Test Guest B", note: "press" },
    ]);
    expect(res.status).toBe(201);
    let g = await json<BookingView>(res);
    expect(g.guest_list.guests.map((x) => x.name)).toEqual(["Test Guest A", "Test Guest B"]);
    expect(g.guest_list.my_heads).toBe(3);
    expect(g.guest_list.link).toBeNull(); // players don't see link settings
    await add(other, gig.id, [{ name: "Test Guest C" }]);

    g = await json<BookingView>(await as(player)(`/gigs/${gig.id}`));
    expect(g.guest_list.guests.map((x) => x.name)).toEqual(["Test Guest A", "Test Guest B"]);
    expect(g.guest_list.heads).toBe(4);

    g = await json<BookingView>(await as(manager)(`/gigs/${gig.id}`));
    expect(g.guest_list.guests.map((x) => [x.name, x.host_name])).toEqual([
      ["Test Guest A", "Test Player"],
      ["Test Guest B", "Test Player"],
      ["Test Guest C", "Test Other"],
    ]);
    // A player can't touch someone else's guest, or add for someone else, or mark arrivals.
    const c = g.guest_list.guests.find((x) => x.name === "Test Guest C")!;
    const a = g.guest_list.guests.find((x) => x.name === "Test Guest A")!;
    expect((await as(player)(`/gigs/${gig.id}/guests/${c.id}`, { method: "DELETE" })).status).toBe(404);
    const otherPerson = g.people.find((p) => p.name === "Test Other")!;
    expect((await add(player, gig.id, [{ name: "X" }], { host_person_id: otherPerson.id })).status).toBe(403);
    expect(
      (await as(player)(`/gigs/${gig.id}/guests/${a.id}`, { method: "PATCH", body: { arrived: true } }))
        .status,
    ).toBe(403);
    // The host edits their own; a manager can add for someone and mark arrivals.
    res = await as(player)(`/gigs/${gig.id}/guests/${a.id}`, { method: "PATCH", body: { plus_ones: 2 } });
    expect((await json<BookingView>(res)).guest_list.my_heads).toBe(4);
    res = await add(manager, gig.id, [{ name: "Test Guest D" }], { host_person_id: otherPerson.id });
    expect(res.status).toBe(201);
    g = await json<BookingView>(
      await as(manager)(`/gigs/${gig.id}/guests/${a.id}`, { method: "PATCH", body: { arrived: true } }),
    );
    expect(g.guest_list.arrived_heads).toBe(3);

    const stranger = await signUp("Test Stranger");
    expect((await add(stranger, gig.id, [{ name: "X" }])).status).toBe(404);
  });

  it("keeps to the total and per-person limits, and closes for players", async () => {
    const { manager, player, gig } = await band();
    await as(manager)(`/gigs/${gig.id}/guest-list`, {
      method: "PATCH",
      body: { total_limit: 5, per_person_limit: 3 },
    });
    expect((await add(player, gig.id, [{ name: "Test A", plus_ones: 1 }])).status).toBe(201);
    let res = await add(player, gig.id, [{ name: "Test B", plus_ones: 1 }]);
    expect(res.status).toBe(409);
    expect((await json<{ error: { details: { reason: string } } }>(res)).error.details.reason).toBe(
      "guest_limit_reached",
    );
    expect((await add(player, gig.id, [{ name: "Test B" }])).status).toBe(201);
    expect((await add(manager, gig.id, [{ name: "Test M", plus_ones: 1 }])).status).toBe(201);
    res = await add(manager, gig.id, [{ name: "Test N" }]);
    expect((await json<{ error: { details: { reason: string } } }>(res)).error.details.reason).toBe(
      "guest_list_full",
    );
    // Raising plus-ones also counts.
    const mine = (await json<BookingView>(await as(player)(`/gigs/${gig.id}`))).guest_list.guests[0]!;
    expect(
      (await as(player)(`/gigs/${gig.id}/guests/${mine.id}`, { method: "PATCH", body: { plus_ones: 5 } }))
        .status,
    ).toBe(409);

    // Closed: players can't change their list; managers still can.
    await as(manager)(`/gigs/${gig.id}/guest-list`, {
      method: "PATCH",
      body: { closes_at: "2020-01-01T10:00", total_limit: null },
    });
    const g = await json<BookingView>(await as(player)(`/gigs/${gig.id}`));
    expect(g.guest_list.open).toBe(false);
    res = await as(player)(`/gigs/${gig.id}/guests/${mine.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect((await as(manager)(`/gigs/${gig.id}/guests/${mine.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("shares a secret link with the venue: list, door check-in, reset and off", async () => {
    const { manager, player, gig } = await band();
    await add(player, gig.id, [{ name: "Test Zed", plus_ones: 1, note: "press" }, { name: "test amy" }]);
    expect((await as(player)(`/gigs/${gig.id}/guest-link`, { body: {} })).status).toBe(403);

    const link = await json<GuestLinkView>(await as(manager)(`/gigs/${gig.id}/guest-link`, { body: {} }));
    expect(link.enabled).toBe(true);
    expect(link.check_in).toBe(true);
    const token = link.url!.split("/guests/")[1]!;
    expect(token.startsWith(`gl_${gig.id}_`)).toBe(true);
    // Asking again keeps the same link.
    const again = await json<GuestLinkView>(await as(manager)(`/gigs/${gig.id}/guest-link`, { body: {} }));
    expect(again.url).toBe(link.url);

    // The venue opens it without signing in.
    let res = await call(`/api/shared/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const shared = await json<SharedGuestListView>(res);
    expect(shared.gig_title).toBe("Test Guest Gig");
    expect(shared.venue).toBe("Test Club, Test City");
    expect(shared.heads).toBe(3);
    expect(shared.guests.map((x) => [x.name, x.guest_of, x.plus_ones, x.note])).toEqual([
      ["test amy", "Test Player", 0, null],
      ["Test Zed", "Test Player", 1, "press"],
    ]);
    expect(JSON.stringify(shared)).not.toContain("fee");

    // Door check-in (needs a key; retrying is harmless).
    const zed = shared.guests.find((x) => x.name === "Test Zed")!;
    expect(
      (
        await call(`/api/shared/${token}/arrive`, {
          body: { guest_id: zed.id, arrived: true },
          idempotencyKey: null,
        })
      ).status,
    ).toBe(400);
    const key = crypto.randomUUID();
    res = await call(`/api/shared/${token}/arrive`, {
      body: { guest_id: zed.id, arrived: true },
      idempotencyKey: key,
    });
    expect((await json<SharedGuestListView>(res)).arrived_heads).toBe(2);
    res = await call(`/api/shared/${token}/arrive`, {
      body: { guest_id: zed.id, arrived: true },
      idempotencyKey: key,
    });
    expect(res.status).toBe(200);
    const g = await json<BookingView>(await as(manager)(`/gigs/${gig.id}`));
    expect(g.guest_list.arrived_heads).toBe(2);

    // Read-only link: check-in refused.
    await as(manager)(`/gigs/${gig.id}/guest-link`, { body: { check_in: false } });
    res = await call(`/api/shared/${token}/arrive`, { body: { guest_id: zed.id, arrived: false } });
    expect(res.status).toBe(403);

    // A wrong or old token gets 404, without saying why.
    expect((await call(`/api/shared/${token.slice(0, -2)}xx`)).status).toBe(404);
    expect((await call(`/api/shared/gl_nope`)).status).toBe(404);
    const reset = await json<GuestLinkView>(
      await as(manager)(`/gigs/${gig.id}/guest-link`, { body: { reset: true } }),
    );
    expect(reset.url).not.toBe(link.url);
    expect((await call(`/api/shared/${token}`)).status).toBe(404);
    await as(manager)(`/gigs/${gig.id}/guest-link`, { method: "DELETE" });
    expect((await call(`/api/shared/${reset.url!.split("/guests/")[1]}`)).status).toBe(404);
  });
});
