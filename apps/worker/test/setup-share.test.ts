// Setup sharing (home-first.md §5.4): the structure of my lists travels to someone I know as a
// card in their chat; Make it builds it in their space; no records go. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  ChatView,
  CollectionView,
  CreatedShare,
  RecordView,
  RuleView,
  SavedView,
  SharedSetup,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("setup sharing", () => {
  it("sends the lists, links, rules and views as one card; Make it builds them, without records", async () => {
    const owner = await signUp("Test Owner");
    const rahul = await signUp("Rahul Test");
    // Rahul joins a shared note, so the owner knows him by name.
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test band note" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    await api(rahul)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });

    // Clients ← Bookings (link), a rollup on Clients, a check rule, a pinned view with a quick add.
    expect(
      (
        await api(owner)("/collections", {
          body: {
            name: "Clients",
            fields: [
              { name: "Name", type: "text" },
              { name: "Phone", type: "text" },
            ],
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(owner)("/collections", {
          body: {
            name: "Bookings",
            fields: [
              { name: "Title", type: "text" },
              { name: "Date", type: "date", required: true },
              { name: "Fee", type: "money", aliases: ["Price"] },
              { name: "Status", type: "choice", options: { choices: ["Enquiry", "Confirmed"] } },
              { name: "Client", type: "link", options: { target: "Clients" } },
            ],
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(owner)("/collections/Clients/fields", {
          body: {
            field: { name: "Booked", type: "number", options: { rollup: { via: "Bookings", fn: "count" } } },
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(owner)("/collections/Bookings/rules", {
          body: { kind: "check", require: [{ field: "Fee", op: "gt", value: 0 }], message: "Fee first" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(owner)("/views", {
          body: {
            name: "Confirmed gigs",
            collection: "Bookings",
            filters: [{ field: "Status", op: "eq", value: "Confirmed" }],
            sort: { field: "Date", dir: "asc" },
            pinned: true,
            add_fields: ["Title", "Date"],
          },
        })
      ).status,
    ).toBe(201);
    const booking = await json<RecordView>(
      await api(owner)("/collections/Bookings/records", {
        body: { values: { Title: "Test wedding", Date: "2026-12-12", Fee: "15000", Status: "Confirmed" } },
      }),
    );
    expect(booking.id).toBeTruthy();

    // Someone the owner doesn't know: candidates, never a guess.
    expect(
      (await api(owner)("/setups/share", { body: { to: ["Nobody"], collections: ["Bookings"] } })).status,
    ).toBe(404);
    // A check made only of a link filter (a record id: data) stays behind.
    const client = await json<RecordView>(
      await api(owner)("/collections/Clients/records", { body: { values: { Name: "Test Client Co" } } }),
    );
    expect(
      (
        await api(owner)("/collections/Bookings/rules", {
          body: {
            kind: "check",
            require: [{ field: "Client", op: "eq", value: client.id }],
            only_if: [{ field: "Status", op: "eq", value: "Enquiry" }],
          },
        })
      ).status,
    ).toBe(201);
    // Bookings alone: Clients comes along (the link needs it). The same request twice (a retry)
    // delivers one card.
    const shareOnce = {
      body: { to: ["Rahul"], collections: ["Bookings"], name: "Gig bookings" },
      idempotencyKey: "test-share-setup-1",
    };
    const sent = await json<SharedSetup>(await api(owner)("/setups/share", shareOnce));
    expect((await api(owner)("/setups/share", shareOnce)).status).toBe(201);
    expect(sent.to.map((p) => p.name)).toEqual(["Rahul Test"]);
    expect(sent.collections.sort()).toEqual(["Bookings", "Clients"]);
    expect(sent.words).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Client in Bookings links to Clients"),
        expect.stringContaining("Booked in Clients counts the records linked through Bookings"),
        expect.stringContaining(
          "A view “Confirmed gigs” of Bookings, on the shortcuts bar, with a quick add for Title, Date",
        ),
      ]),
    );
    expect(sent.words.join("\n")).not.toContain("Test wedding");

    // Rahul's chat has the card; nothing is made before the tap.
    const chat = await json<ChatView>(await api(rahul)("/chats/main"));
    expect(chat.items.filter((i) => i.card).length).toBe(1);
    const card = chat.items.find((i) => i.card)!.card!;
    expect(card.title).toBe("Make “Gig bookings” (from Test Owner)");
    expect(card.status).toBe("waiting");
    expect(card.details[0]).toContain("none of their records");
    expect((await json<CollectionView[]>(await api(rahul)("/collections"))).map((c) => c.name)).not.toContain(
      "Bookings",
    );
    expect(
      (await api(rahul)(`/chats/main/actions/${card.action_id}/confirm`, { method: "POST" })).status,
    ).toBe(200);

    // After the tap, one more turn (owner, 2026-10-23: "how do I use it?"): how to use it,
    // messages to try, and the flows that fit as answers to tap; the app's prompt stays unseen.
    const after = await json<ChatView>(await api(rahul)("/chats/main"));
    const tail = after.items.slice(after.items.findIndex((i) => i.card?.status === "done"));
    expect(tail.map((i) => i.role)).toEqual(["card", "note", "live", "assistant", "choices"]);
    expect(tail[3]!.text).toContain('"Add one"');
    expect(tail[4]!.choices!.options.map((o) => o.label)).toEqual([
      "Remind me when one is a week old",
      "Not now",
    ]);
    expect(after.items.some((i) => i.role === "user")).toBe(false);

    const cols = await json<CollectionView[]>(await api(rahul)("/collections"));
    const bookings = cols.find((c) => c.name === "Bookings")!;
    const clients = cols.find((c) => c.name === "Clients")!;
    expect(bookings.fields.map((f) => [f.name, f.type])).toEqual([
      ["Title", "text"],
      ["Date", "date"],
      ["Fee", "money"],
      ["Status", "choice"],
      ["Client", "link"],
    ]);
    expect(bookings.fields.find((f) => f.name === "Client")!.options.target).toBe(clients.id);
    expect(bookings.fields.find((f) => f.name === "Fee")!.aliases).toEqual(["Price"]);
    expect(bookings.fields.find((f) => f.name === "Date")!.required).toBe(true);
    expect(clients.fields.find((f) => f.name === "Booked")!.options.rollup).toMatchObject({ fn: "count" });
    const rules = await json<RuleView[]>(await api(rahul)("/collections/Bookings/rules"));
    expect(rules.map((r) => r.words)).toEqual([expect.stringContaining("Fee is more than 0")]);
    const views = await json<SavedView[]>(await api(rahul)("/views"));
    const v = views.find((x) => x.name === "Confirmed gigs")!;
    expect(v.pinned).toBe(true);
    expect(v.add_fields.length).toBe(2);
    expect(v.filters).toEqual([expect.objectContaining({ op: "eq", value: "Confirmed" })]);
    // Structure only: no records came along.
    const found = await json<{ items: RecordView[] }>(
      await api(rahul)("/collections/Bookings/find", { body: {} }),
    );
    expect(found.items).toEqual([]);
    // Owner's own space is untouched.
    expect(
      (await json<CollectionView[]>(await api(owner)("/collections"))).filter((c) => c.name === "Bookings")
        .length,
    ).toBe(1);
  });

  it("refuses when the person has no assistant, and more lists than a setup holds", async () => {
    const owner = await signUp("Test Owner Two");
    const priya = await signUp("Priya Test", undefined, { assistant: false });
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test note" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    await api(priya)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    const res = await api(owner)("/setups/share", { body: { to: ["Priya"], collections: ["Notes"] } });
    expect(res.status).toBe(400);
    expect((await json<{ error: { message: string } }>(res)).error.message).toContain(
      "doesn't have the assistant",
    );
    expect(
      (await json<ChatView>(await api(priya)("/chats/main").catch(() => new Response("{}")))).items ?? [],
    ).toEqual([]);
  });
});
