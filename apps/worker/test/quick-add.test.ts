// Quick adds made by chat (decision "Chat makes, screens use"): a saved view can carry an add
// box with the fields the person chose. Fake data only.
import { describe, expect, it } from "vitest";
import type { SavedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("quick adds", () => {
  it("saves the fields of a quick add on a view, checks them, and removes it on request", async () => {
    const me = await signUp("Test Quick", undefined, { lists: false });
    await api(me)("/collections", {
      body: {
        name: "Spends",
        fields: [
          { name: "What", type: "text" },
          { name: "Amount", type: "money", required: true },
          { name: "Paid with", type: "choice", options: { choices: ["Cash", "UPI"] } },
          { name: "Double", type: "money", options: { formula: "{Amount} * 2" } },
        ],
      },
    });
    const save = (add_fields: string[]) =>
      api(me)("/views", {
        body: { name: `Test quick ${add_fields.join(" ")}`, collection: "Spends", pinned: true, add_fields },
      });
    // Required fields must be in it; calculated ones can't be.
    expect((await save(["What"])).status).toBe(400);
    expect((await save(["What", "Amount", "Double"])).status).toBe(400);
    const made = await save(["What", "Amount", "Paid with"]);
    expect(made.status).toBe(201);
    const view = await json<SavedView>(made);
    expect(view.add_fields).toHaveLength(3);

    // Changing the filters keeps the quick add; [] removes it.
    const kept = await json<SavedView>(
      await api(me)(`/views/${view.id}`, {
        method: "PATCH",
        body: { filters: [{ field: "Paid with", op: "eq", value: "UPI" }] },
      }),
    );
    expect(kept.add_fields).toEqual(view.add_fields);
    const gone = await json<SavedView>(
      await api(me)(`/views/${view.id}`, { method: "PATCH", body: { add_fields: [] } }),
    );
    expect(gone.add_fields).toEqual([]);

    // A plain view has none.
    const plain = await json<SavedView>(
      await api(me)("/views", { body: { name: "Test plain", collection: "Spends" } }),
    );
    expect(plain.add_fields).toEqual([]);
  });

  it("refuses one a list's required links would break, and hides one a later change breaks", async () => {
    const me = await signUp("Test Quick Links", undefined, { lists: false });
    await api(me)("/collections", { body: { name: "Gigs", fields: [{ name: "Title", type: "text" }] } });
    await api(me)("/collections", {
      body: {
        name: "Payments",
        fields: [
          { name: "Note", type: "text" },
          { name: "Amount", type: "money" },
          { name: "Gig", type: "link", required: true, options: { target: "Gigs" } },
        ],
      },
    });
    // A required link can't be filled by a quick add.
    expect(
      (
        await api(me)("/views", {
          body: { name: "Test pay", collection: "Payments", add_fields: ["Note", "Amount"] },
        })
      ).status,
    ).toBe(400);

    await api(me)("/collections", {
      body: {
        name: "Notes2",
        fields: [
          { name: "Title", type: "text" },
          { name: "Body", type: "long_text" },
        ],
      },
    });
    const view = await json<SavedView>(
      await api(me)("/views", { body: { name: "Test notes", collection: "Notes2", add_fields: ["Title"] } }),
    );
    expect(view.add_fields).toHaveLength(1);
    // A new required field it doesn't fill: the add box is hidden instead of failing.
    expect(
      (
        await api(me)("/collections/Notes2/fields", {
          body: { field: { name: "Tag", type: "text", required: true } },
        })
      ).status,
    ).toBe(201);
    const after = await json<{ view: SavedView }>(await api(me)(`/views/${view.id}`));
    expect(after.view.add_fields).toEqual([]);
  });
});
