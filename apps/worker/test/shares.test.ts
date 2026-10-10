// Sharing a card (docs/design/universal.md §11): join links, view and edit access, hidden
// fields, and that nothing else in the owner's space is reachable. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  CreatedShare,
  FindResult,
  RecordView,
  ShareView,
  SharedCardView,
  SharedFormView,
  SharedListView,
  SharedWithMe,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function setUp() {
  const owner = await signUp("Test Owner");
  await api(owner)("/collections", {
    body: {
      name: "Shows",
      fields: [
        { name: "Title", type: "text" },
        { name: "Fee", type: "money" },
        { name: "Venue notes", type: "long_text" },
      ],
    },
  });
  await api(owner)("/collections", {
    body: {
      name: "Guests",
      fields: [
        { name: "Name", type: "text" },
        { name: "Arrived", type: "boolean" },
        { name: "Phone", type: "text" },
        { name: "Show", type: "link", options: { target: "Shows" } },
      ],
    },
  });
  const show = await json<RecordView>(
    await api(owner)("/collections/Shows/records", {
      body: { values: { Title: "Test Fest", Fee: "50000", "Venue notes": "Test gate 2" } },
    }),
  );
  await api(owner)("/collections/Guests/records", {
    body: { values: { Name: "Test Guest", Show: show.id, Phone: "00000" } },
  });
  return { owner, show };
}

const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

describe("sharing a card", () => {
  it("lets people join by link and see only what's shared", async () => {
    const { owner, show } = await setUp();
    const made = await api(owner)("/shares", {
      body: { record_id: show.id, include: ["Guests"], access: "edit", hide_fields: ["Fee", "Phone"] },
    });
    expect(made.status).toBe(201);
    const { share, link } = await json<CreatedShare>(made);
    expect(link).toMatch(/\/join#shr_/);
    expect(share).toMatchObject({
      title: "Test Fest",
      access: "edit",
      include: [{ title: "Guests" }],
      hidden_fields: [{ name: "Fee" }, { name: "Phone" }],
    });

    const friend = await signUp("Test Friend");
    // Before joining: nothing.
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(404);
    const joined = await api(friend)("/cards/join", { body: { token: tokenOf(link) } });
    expect(joined.status).toBe(200);
    const list = await json<SharedWithMe[]>(await api(friend)("/cards"));
    expect(list).toEqual([
      expect.objectContaining({ share_id: share.id, title: "Test Fest", owner: "Test Owner" }),
    ]);

    const card = await json<SharedCardView>(await api(friend)(`/cards/${share.id}`));
    expect(card.record.fields.map((f) => f.name)).toEqual(["Title", "Venue notes"]);
    expect(card.sections).toHaveLength(1);
    expect(card.sections[0]!.fields.map((f) => f.name)).toEqual(["Name", "Arrived"]);
    expect(card.sections[0]!.records.map((r) => r.title)).toEqual(["Test Guest"]);
    expect(JSON.stringify(card)).not.toContain("50000");
    expect(JSON.stringify(card)).not.toContain("00000");

    // Edit: shared fields only.
    const guest = card.sections[0]!.records[0]!;
    const ok = await api(friend)(`/cards/${share.id}/records/${guest.id}`, {
      method: "PATCH",
      body: { values: { Arrived: "yes" } },
    });
    expect(ok.status).toBe(200);
    expect((await api(owner)(`/records/${guest.id}`)).status).toBe(200);
    expect((await json<RecordView>(await api(owner)(`/records/${guest.id}`))).named.Arrived).toBeTruthy();
    const hidden = await api(friend)(`/cards/${share.id}/records/${guest.id}`, {
      method: "PATCH",
      body: { values: { Phone: "11111" } },
    });
    expect(hidden.status).toBe(403);
    const added = await api(friend)(`/cards/${share.id}/records`, {
      body: { section: card.sections[0]!.key, values: { Name: "Test Plus One" } },
    });
    expect(added.status).toBe(201);
    const after = await json<SharedCardView>(added);
    expect(after.sections[0]!.records.map((r) => r.title)).toContain("Test Plus One");

    // The rest of the owner's space stays closed.
    expect((await api(friend)(`/records/${show.id}`)).status).toBe(404);
    expect(
      (
        await api(friend)(`/cards/${share.id}/records/${show.id}`, {
          method: "PATCH",
          body: { values: { Fee: "1" } },
        })
      ).status,
    ).toBe(403);

    // The owner sees who joined; turning the share off closes it.
    const shares = await json<ShareView[]>(await api(owner)(`/shares?record_id=${show.id}`));
    expect(shares[0]!.people.map((p) => p.name)).toEqual(["Test Friend"]);
    expect((await api(owner)(`/shares/${share.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(404);
    expect(await json<SharedWithMe[]>(await api(friend)("/cards"))).toEqual([]);
  });

  it("keeps view-only shares read-only and old links dead after a reset", async () => {
    const { owner, show } = await setUp();
    const { share, link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: show.id } }),
    );
    expect(share.access).toBe("view");
    const friend = await signUp("Test Friend");
    await api(friend)("/cards/join", { body: { token: tokenOf(link) } });
    const card = await json<SharedCardView>(await api(friend)(`/cards/${share.id}`));
    expect(card.sections).toEqual([]);
    expect(card.record.fields.every((f) => !f.editable)).toBe(true);
    expect(
      (
        await api(friend)(`/cards/${share.id}/records/${show.id}`, {
          method: "PATCH",
          body: { values: { Title: "Test changed" } },
        })
      ).status,
    ).toBe(403);

    const reset = await json<CreatedShare>(await api(owner)(`/shares/${share.id}/reset`, { method: "POST" }));
    expect(reset.link).not.toBe(link);
    const late = await signUp("Test Late");
    expect((await api(late)("/cards/join", { body: { token: tokenOf(link) } })).status).toBe(404);
    expect((await api(late)("/cards/join", { body: { token: tokenOf(reset.link) } })).status).toBe(200);
    // People who joined before the reset stay.
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(200);

    // Leaving.
    expect((await api(friend)(`/cards/${share.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(404);
  });

  it("gives the same working link when a request is repeated", async () => {
    const { owner, show } = await setUp();
    const body = { record_id: show.id };
    const first = await json<CreatedShare>(
      await call("/api/shares", { cookie: owner.cookie, body, idempotencyKey: "test-share-key" }),
    );
    const again = await json<CreatedShare>(
      await call("/api/shares", { cookie: owner.cookie, body, idempotencyKey: "test-share-key" }),
    );
    expect(again.link).toBe(first.link);
    expect(again.share.id).toBe(first.share.id);
    const friend = await signUp("Test Friend");
    expect((await api(friend)("/cards/join", { body: { token: tokenOf(first.link) } })).status).toBe(200);
  });

  it("rejects made-up links and unknown parts", async () => {
    const { owner, show } = await setUp();
    const friend = await signUp("Test Friend");
    const bad = `shr_01HZZZZZZZZZZZZZZZZZZZZZZZ_${"a".repeat(43)}`;
    expect((await api(friend)("/cards/join", { body: { token: bad } })).status).toBe(404);
    const wrong = await api(owner)("/shares", { body: { record_id: show.id, include: ["Nothing here"] } });
    expect(wrong.status).toBe(400);
    const title = await api(owner)("/shares", { body: { record_id: show.id, hide_fields: ["Title"] } });
    expect(title.status).toBe(400);
    // Others can't share my records.
    expect((await api(friend)("/shares", { body: { record_id: show.id } })).status).toBe(404);
  });
});

describe("sharing views and forms", () => {
  it("shares a view live, with its filters, and keeps edits inside it", async () => {
    const { owner } = await setUp();
    await api(owner)("/collections/Shows/records", { body: { values: { Title: "Test Small", Fee: "100" } } });
    const view = await json<{ id: string }>(
      await api(owner)("/views", {
        body: {
          name: "Big shows",
          collection: "Shows",
          filters: [{ field: "Fee", op: "gte", value: "1000" }],
        },
      }),
    );
    const { share, link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { view: "Big shows", access: "edit", hide_fields: ["Fee"] } }),
    );
    expect(share).toMatchObject({ kind: "view", target_id: view.id, title: "Big shows", record_id: null });
    const friend = await signUp("Test Friend");
    await api(friend)("/cards/join", { body: { token: tokenOf(link) } });
    const opened = await json<SharedListView>(await api(friend)(`/cards/${share.id}`));
    expect(opened.share.kind).toBe("view");
    expect(opened.records.map((r) => r.title)).toEqual(["Test Fest"]);
    expect(opened.fields.map((f) => f.name)).toEqual(["Title", "Venue notes"]);
    // A record outside the view can't be changed through it.
    const all = await json<FindResult>(await api(owner)("/collections/Shows/find", { body: {} }));
    const small = all.items.find((r) => r.title === "Test Small")!;
    expect(
      (
        await api(friend)(`/cards/${share.id}/records/${small.id}`, {
          method: "PATCH",
          body: { values: { "Venue notes": "Test x" } },
        })
      ).status,
    ).toBe(404);
    const fest = opened.records[0]!;
    expect(
      (
        await api(friend)(`/cards/${share.id}/records/${fest.id}`, {
          method: "PATCH",
          body: { values: { "Venue notes": "Test updated" } },
        })
      ).status,
    ).toBe(200);
  });

  it("lets people fill in a form and see only their own answers", async () => {
    const { owner } = await setUp();
    const { share, link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { form: "Guests", hide_fields: ["Arrived"] } }),
    );
    expect(share.kind).toBe("form");
    const a = await signUp("Test Asha");
    const b = await signUp("Test Ben");
    for (const u of [a, b]) await api(u)("/cards/join", { body: { token: tokenOf(link) } });
    const form = await json<SharedFormView>(await api(a)(`/cards/${share.id}`));
    expect(form.fields.map((f) => f.name)).toEqual(["Name", "Phone"]);
    expect(form.mine).toEqual([]);
    const sent = await api(a)(`/cards/${share.id}/records`, {
      body: { section: "form", values: { Name: "Test Asha's friend" } },
    });
    expect(sent.status).toBe(201);
    expect((await json<SharedFormView>(sent)).mine.map((r) => r.title)).toEqual(["Test Asha's friend"]);
    // Ben sees none of Asha's answers; the owner sees them all.
    expect((await json<SharedFormView>(await api(b)(`/cards/${share.id}`))).mine).toEqual([]);
    const guests = await json<FindResult>(await api(owner)("/collections/Guests/find", { body: {} }));
    expect(guests.items.map((r) => r.title)).toContain("Test Asha's friend");
    // Hidden fields can't be filled in.
    expect(
      (
        await api(b)(`/cards/${share.id}/records`, {
          body: { section: "form", values: { Name: "Test x", Arrived: "yes" } },
        })
      ).status,
    ).toBe(403);
  });

  it("opens link-only views and forms without signing in", async () => {
    const { owner } = await setUp();
    await api(owner)("/views", { body: { name: "All shows", collection: "Shows" } });
    const view = await json<CreatedShare>(
      await api(owner)("/shares", {
        body: { view: "All shows", public: true, access: "edit", hide_fields: ["Fee"] },
      }),
    );
    // Link-only views are read-only.
    expect(view.share).toMatchObject({ public: true, access: "view" });
    const opened = await json<SharedListView>(
      await call("/api/link/open", { body: { token: tokenOf(view.link) } }),
    );
    expect(opened.records.map((r) => r.title)).toEqual(["Test Fest"]);
    expect(JSON.stringify(opened)).not.toContain("50000");

    const form = await json<CreatedShare>(
      await api(owner)("/shares", { body: { form: "Guests", public: true } }),
    );
    const ok = await call("/api/link/submit", {
      body: { token: tokenOf(form.link), values: { Name: "Test Walk-in" } },
    });
    expect(ok.status).toBe(201);
    const guests = await json<FindResult>(await api(owner)("/collections/Guests/find", { body: {} }));
    expect(guests.items.map((r) => r.title)).toContain("Test Walk-in");

    // A card link, or a link that's been turned off, doesn't open without signing in.
    const card = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: guests.items[0]!.id } }),
    );
    expect((await call("/api/link/open", { body: { token: tokenOf(card.link) } })).status).toBe(404);
    await api(owner)(`/shares/${form.share.id}`, { method: "DELETE" });
    expect(
      (await call("/api/link/submit", { body: { token: tokenOf(form.link), values: { Name: "Test late" } } }))
        .status,
    ).toBe(404);
    // Cards can't be link-only.
    expect(
      (await api(owner)("/shares", { body: { record_id: guests.items[0]!.id, public: true } })).status,
    ).toBe(400);
  });
});
