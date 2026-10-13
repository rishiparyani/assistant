// Cards with controls (decision 2026-10-12 "Cards have controls"): a saved view keeps its card's
// arrangement and the controls on its rows, each checked against the field it writes. Fake data only.
import { describe, expect, it } from "vitest";
import type { SavedView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("card controls", () => {
  it("keeps controls bound to fields, and refuses ones that don't fit", async () => {
    const me = await signUp("Test Owner", undefined, { lists: false });
    const made = await api(me)("/collections", {
      body: {
        name: "Test setlist",
        fields: [
          { name: "Song", type: "text" },
          { name: "Ready", type: "boolean" },
          { name: "Status", type: "choice", options: { choices: ["Learning", "Ready"] } },
          { name: "Runs", type: "number" },
          { name: "Fee", type: "money" },
        ],
      },
    });
    expect(made.status).toBe(201);
    const saved = await api(me)("/views", {
      body: {
        name: "Practice",
        collection: "Test setlist",
        pinned: true,
        card: {
          arrangement: "list-plain",
          controls: [
            { field: "Ready", as: "switch" },
            { field: "Status", as: "chips" },
            { field: "Runs", as: "stepper", min: 0 },
            { field: "Fee", as: "button", label: "Paid ₹500", value: "500" },
          ],
        },
      },
    });
    expect(saved.status).toBe(201);
    const v = await json<SavedView>(saved);
    expect(v.card?.arrangement).toBe("list-plain");
    expect(v.card?.controls.map((c) => c.as)).toEqual(["switch", "chips", "stepper", "button"]);
    // Fields by id; a button's value is stored the way its field keeps it (paise for money).
    expect(v.card?.controls[0]!.field).not.toBe("Ready");
    expect(v.card?.controls[3]).toMatchObject({ label: "Paid ₹500", value: 50000 });

    const bad = async (control: object) =>
      api(me)(`/views/${v.id}`, { method: "PATCH", body: { card: { controls: [control] } } });
    const wrong = await bad({ field: "Song", as: "switch" });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(await json(wrong))).toContain("A switch needs a yes/no field; Song is text");
    expect((await bad({ field: "Fee", as: "button" })).status).toBe(400);
    expect((await bad({ field: "Runs", as: "slider", min: 10, max: 5 })).status).toBe(400);

    // Controls make a list card; asking for them on a number card is refused.
    const onlyControls = await json<SavedView>(
      await api(me)(`/views/${v.id}`, {
        method: "PATCH",
        body: { card: { controls: [{ field: "Ready", as: "tick" }] } },
      }),
    );
    expect(onlyControls.card?.arrangement).toBe("list-plain");
    const onNumber = await api(me)(`/views/${v.id}`, {
      method: "PATCH",
      body: { card: { arrangement: "number", controls: [{ field: "Ready", as: "tick" }] } },
    });
    expect(onNumber.status).toBe(400);
    expect(JSON.stringify(await json(onNumber))).toContain("Controls and row layouts go on list cards");
    await api(me)(`/views/${v.id}`, {
      method: "PATCH",
      body: {
        card: {
          arrangement: "list-plain",
          controls: [
            { field: "Ready", as: "switch" },
            { field: "Status", as: "chips" },
            { field: "Runs", as: "stepper", min: 0 },
            { field: "Fee", as: "button", label: "Paid ₹500", value: "500" },
          ],
        },
      },
    });

    // Other changes keep the card; null resets it.
    const renamed = await json<SavedView>(
      await api(me)(`/views/${v.id}`, { method: "PATCH", body: { name: "Practice list" } }),
    );
    expect(renamed.card?.controls).toHaveLength(4);
    const reset = await json<SavedView>(
      await api(me)(`/views/${v.id}`, { method: "PATCH", body: { card: null } }),
    );
    expect(reset.card).toBeNull();
  });
});
