// Groups arriving in parts: "Rahul +2" can come in one at a time. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, GigHistoryView, GuestLinkView, SharedGuestListView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("guests arriving in parts", () => {
  it("counts each head of a group as it arrives, at the gig and at the venue's door", async () => {
    const manager = await signUp("Test Manager");
    const player = await signUp("Test Player");
    let gig = await json<BookingView>(
      await as(manager)("/gigs", {
        body: {
          title: "Test Club Night",
          status: "confirmed",
          events: [{ start_at: "2026-12-12T20:00", venue_name: "Test Club" }],
          people: [{ user_id: player.id }],
        },
      }),
    );
    gig = await json<BookingView>(
      await as(player)(`/gigs/${gig.id}/guests`, {
        body: { guests: [{ name: "Test Rahul", plus_ones: 2 }] },
      }),
    );
    const rahul = gig.guest_list.guests[0]!;
    const patch = (u: User, body: Record<string, unknown>) =>
      as(u)(`/gigs/${gig.id}/guests/${rahul.id}`, { method: "PATCH", body });

    // Players can't mark arrivals.
    expect((await patch(player, { arrived_count: 1 })).status).toBe(403);

    // Rahul comes first; the other two later.
    let view = await json<BookingView>(await patch(manager, { arrived_count: 1 }));
    expect(view.guest_list.guests[0]).toMatchObject({ arrived_count: 1, arrived: false });
    expect(view.guest_list.arrived_heads).toBe(1);
    view = await json<BookingView>(await patch(manager, { arrived_count: 3 }));
    expect(view.guest_list.guests[0]).toMatchObject({ arrived_count: 3, arrived: true });
    expect(view.guest_list.arrived_heads).toBe(3);
    // Never more than the group; a smaller group trims the count; arrived:false clears it.
    view = await json<BookingView>(await patch(manager, { arrived_count: 9 }));
    expect(view.guest_list.guests[0]!.arrived_count).toBe(3);
    view = await json<BookingView>(await patch(manager, { plus_ones: 1 }));
    expect(view.guest_list.guests[0]).toMatchObject({ arrived_count: 2, arrived: true });
    view = await json<BookingView>(await patch(manager, { arrived: false }));
    expect(view.guest_list.guests[0]!.arrived_count).toBe(0);
    await patch(manager, { plus_ones: 2 });

    // The venue's door: one at a time too.
    const link = await json<GuestLinkView>(await as(manager)(`/gigs/${gig.id}/guest-link`, { body: {} }));
    const token = link.url!.split("/guests/")[1]!;
    const door = (body: Record<string, unknown>) =>
      call(`/api/shared/${token}/arrive`, {
        body: { guest_id: rahul.id, ...body },
        idempotencyKey: crypto.randomUUID(),
      });
    let shared = await json<SharedGuestListView>(await door({ arrived_count: 2 }));
    expect(shared.guests[0]).toMatchObject({ arrived_count: 2, arrived: false });
    expect(shared.arrived_heads).toBe(2);
    shared = await json<SharedGuestListView>(await door({ arrived: true }));
    expect(shared.guests[0]).toMatchObject({ arrived_count: 3, arrived: true });
    expect((await door({ arrived_count: -1 })).status).toBe(400);

    // The history says who came in, and keeps an edit that also trimmed arrivals.
    const h = await json<GigHistoryView>(await as(manager)(`/gigs/${gig.id}/history`));
    expect(h.items.slice(0, 2).map((e) => [e.who, e.summary, e.details])).toEqual([
      ["The venue", "Marked 1 more of Test Rahul's group as arrived", ["3 of 3 in"]],
      ["The venue", "Marked 2 more of Test Rahul's group as arrived", ["2 of 3 in"]],
    ]);
    const trimmed = h.items.find((e) => e.details.includes("Plus-ones: 2 → 1"))!;
    expect(trimmed).toMatchObject({
      summary: "Changed guest Test Rahul",
      details: ["Plus-ones: 2 → 1", "Corrected Test Rahul's arrivals", "2 of 2 in"],
    });
  });
});
