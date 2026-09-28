// Address book: learned from gigs I manage, edited by me, private to me. Fake data only.
import { describe, expect, it } from "vitest";
import type { BookingView, ContactView } from "@assistant/shared";
import { env } from "cloudflare:workers";
import { call, json, signUp } from "./http.ts";
import { personName } from "../src/modules/gigs/objects/names.ts";

type User = Awaited<ReturnType<typeof signUp>>;
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

const contacts = async (u: User, query = "") => json<ContactView[]>(await as(u)(`/me/contacts${query}`));

describe("address book", () => {
  it("learns the client, venues and people from gigs I manage, not ones I play", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const res = await as(owner)("/gigs", {
      body: {
        title: "Test Wedding",
        client: { name: "Test Client Co", phone: "+91 90000 00001" },
        events: [{ start_at: "2026-12-12T19:00", venue_name: "Test Hall", venue_city: "Test City" }],
        people: [{ user_id: mate.id }, { name: "Test Drummer", email: "drummer@example.com" }],
      },
    });
    expect(res.status).toBe(201);
    await json<BookingView>(res);

    const book = await waitFor(
      () => contacts(owner),
      (c) => c.length === 4,
    );
    const by = (kind: string) =>
      book
        .filter((c) => c.kind === kind)
        .map((c) => c.name)
        .sort();
    expect(by("client")).toEqual(["Test Client Co"]);
    expect(by("venue")).toEqual(["Test Hall"]);
    expect(by("person")).toEqual(["Test Drummer", "Test Mate"]);
    const client = book.find((c) => c.kind === "client")!;
    expect(client.phone).toBe("+91 90000 00001");
    expect(client.gigs).toBe(1);
    expect(book.find((c) => c.kind === "venue")!.city).toBe("Test City");
    expect(book.find((c) => c.name === "Test Mate")!.user_id).toBe(mate.id);

    // A player's address book stays empty (only managers learn); nobody sees mine.
    await new Promise((r) => setTimeout(r, 300));
    expect(await contacts(mate)).toEqual([]);

    // Search and kind filters.
    expect((await contacts(owner, "?kind=venue")).map((c) => c.name)).toEqual(["Test Hall"]);
    expect((await contacts(owner, "?q=drummer@")).map((c) => c.name)).toEqual(["Test Drummer"]);
  });

  it("adds, edits and removes contacts; duplicates are refused; deleted stays deleted", async () => {
    const me = await signUp("Test Me");
    const add = await as(me)("/me/contacts", {
      body: { kind: "venue", name: "Test  Club", city: "Test City" },
    });
    expect(add.status).toBe(201);
    const club = await json<ContactView>(add);
    expect(club.name).toBe("Test Club");

    const dupe = await as(me)("/me/contacts", { body: { kind: "venue", name: "test club" } });
    expect(dupe.status).toBe(409);
    // Same name, another kind is fine.
    expect((await as(me)("/me/contacts", { body: { kind: "client", name: "Test Club" } })).status).toBe(201);

    const bad = await as(me)("/me/contacts", { body: { kind: "person", name: "X", email: "nope" } });
    expect(bad.status).toBe(400);

    const edit = await as(me)(`/me/contacts/${club.id}`, {
      method: "PATCH",
      body: { phone: "+91 90000 00002", city: null },
    });
    expect(edit.status).toBe(200);
    const edited = await json<ContactView>(edit);
    expect(edited.phone).toBe("+91 90000 00002");
    expect(edited.city).toBeNull();
    expect(edited.name).toBe("Test Club");

    // Retrying the same request (same key) doesn't repeat it.
    const key = crypto.randomUUID();
    const first = await as(me)("/me/contacts", {
      body: { kind: "person", name: "Test Singer" },
      idempotencyKey: key,
    });
    const again = await as(me)("/me/contacts", {
      body: { kind: "person", name: "Test Singer" },
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);
    expect((await json<ContactView>(again)).id).toBe((await json<ContactView>(first)).id);

    const del = await as(me)(`/me/contacts/${club.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await contacts(me, "?kind=venue")).length).toBe(0);
    expect((await as(me)(`/me/contacts/${club.id}`, { method: "PATCH", body: { notes: "x" } })).status).toBe(
      404,
    );

    // A gig at that venue doesn't bring it back...
    await as(me)("/gigs", {
      body: { title: "Test Gig", events: [{ start_at: "2026-12-20T19:00", venue_name: "Test Club" }] },
    });
    await new Promise((r) => setTimeout(r, 800));
    expect((await contacts(me, "?kind=venue")).length).toBe(0);
    // ...but adding it by hand does.
    expect((await as(me)("/me/contacts", { body: { kind: "venue", name: "Test Club" } })).status).toBe(201);
    expect((await contacts(me, "?kind=venue")).map((c) => c.id)).toEqual([club.id]);
  });

  it("finds contacts by the start of any word or phone digits, and keeps renamed ones", async () => {
    const me = await signUp("Test Me");
    await as(me)("/me/contacts", {
      body: { kind: "venue", name: "Test Blue Frog", city: "Test Pune", phone: "+91 90000 12345" },
    });
    const names = async (q: string) => (await contacts(me, `?q=${encodeURIComponent(q)}`)).map((c) => c.name);
    expect(await names("frog")).toEqual(["Test Blue Frog"]);
    expect(await names("blu fro")).toEqual(["Test Blue Frog"]);
    expect(await names("pune")).toEqual(["Test Blue Frog"]);
    expect(await names("+91 90000")).toEqual(["Test Blue Frog"]);
    expect(await names("12345")).toEqual([]); // the middle of a number isn't a word start
    expect(await names("rog")).toEqual([]);

    // A learned client I rename is still the one gigs with the old name link to.
    await as(me)("/gigs", {
      body: { title: "Test A", client: { name: "Test Old Co" }, events: [{ start_at: "2026-12-12T19:00" }] },
    });
    const learned = await waitFor(
      () => contacts(me, "?kind=client"),
      (c) => c.length === 1,
    );
    await as(me)(`/me/contacts/${learned[0]!.id}`, { method: "PATCH", body: { name: "Test New Co" } });
    await as(me)("/gigs", {
      body: { title: "Test B", client: { name: "Test Old Co" }, events: [{ start_at: "2026-12-13T19:00" }] },
    });
    const after = await waitFor(
      () => contacts(me, "?kind=client"),
      (c) => c[0]?.gigs === 2,
    );
    expect(after.map((c) => [c.name, c.gigs])).toEqual([["Test New Co", 2]]);
  });

  it("exports and restores an address book without overwriting", async () => {
    const me = await signUp("Test Me");
    await as(me)("/me/contacts", { body: { kind: "client", name: "Test Backup Client" } });
    const person = env.PEOPLE.getByName(personName(me.id));
    const rows = await person.exportContacts();
    expect(rows.length).toBe(1);
    expect(await person.importContacts(rows)).toBe(0);
    const other = await signUp("Test Other");
    expect(await env.PEOPLE.getByName(personName(other.id)).importContacts(rows)).toBe(1);
    expect((await contacts(other)).map((c) => c.name)).toEqual(["Test Backup Client"]);
  });
});
