// The space page (FS4, docs/design/from-scratch.md §3): who is in a space and with what role,
// and who something in it is shared with. Fake data only.
import { describe, expect, it } from "vitest";
import type { CreatedShare, RecordView, SpacePerson, SpaceView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("a space's people", () => {
  it("lists members with roles, then people something is shared with; others get 404", async () => {
    const owner = await signUp("Test Owner");
    const space = await json<SpaceView>(await api(owner)("/spaces", { body: { name: "Test building" } }));
    const q = `?space=${space.id}`;
    await api(owner)(`/collections${q}`, {
      body: { name: "Complaints", space: space.id, fields: [{ name: "Title", type: "text" }] },
    });
    const rec = await json<RecordView>(
      await api(owner)(`/collections/Complaints/records`, {
        body: { space: space.id, values: { Title: "Test lift not working" } },
      }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", {
        body: { space: space.id, record_id: rec.id, access: "view", hide_fields: [] },
      }),
    );
    const resident = await signUp("Test Resident");
    await api(resident)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });

    const people = await json<SpacePerson[]>(await api(owner)(`/spaces/${space.id}/people`));
    expect(people).toEqual([
      { user_id: owner.id, name: "Test Owner", role: "owner", shares: [] },
      { user_id: resident.id, name: "Test Resident", role: "shared", shares: ["Test lift not working"] },
    ]);
    // Someone outside the space never learns it exists.
    expect((await api(resident)(`/spaces/${space.id}/people`)).status).toBe(404);
  });
});
