// Deleting a space (decision 2026-11-05 "The space is the setup"): it leaves everyone's spaces,
// its links stop working and its flows stop; Recently deleted brings it all back. Fake data only.
import { describe, expect, it } from "vitest";
import type { CreatedShare, DeletedSpace, SpaceView, WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("deleting a space", () => {
  it("takes the whole setup away for everyone, and brings it back", async () => {
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Club" } }));
    const q = `?space=${sp.id}`;
    await api(me)("/collections", {
      body: { space: sp.id, name: "Test Requests", fields: [{ name: "Title", type: "text" }] },
    });
    const flow = await json<WorkflowView>(
      await api(me)("/workflows", {
        body: {
          space: sp.id,
          name: "Test tell me",
          when: { event: "added", collection: "Test Requests" },
          then: [{ do: "notify", text: "{Title}", to: ["me"] }],
          enabled: true,
        },
      }),
    );
    const { link, share } = await json<CreatedShare>(
      await api(me)("/shares", { body: { space: sp.id, form: "Test Requests", for: "Members" } }),
    );
    const friend = await signUp("Test Friend");
    await api(friend)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    const friendCards = async () =>
      (await json<{ share_id: string }[]>(await api(friend)("/cards"))).map((c) => c.share_id);
    expect(await friendCards()).toContain(share.id);

    // Personal can't be deleted; the space can, by its owner.
    expect((await api(me)("/spaces/Personal", { method: "DELETE" })).status).toBe(400);
    expect((await api(friend)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await api(me)(`/spaces/${sp.id}`, { method: "DELETE" })).status).toBe(200);

    const spaces = async () => (await json<SpaceView[]>(await api(me)("/spaces"))).map((s) => s.name);
    expect(await spaces()).not.toContain("Test Club");
    // The friend's link stops working.
    expect(await friendCards()).not.toContain(share.id);
    expect((await api(friend)(`/cards/${share.id}`)).status).toBe(404);
    // Its name can be used again meanwhile; in Recently deleted, only for its owner.
    const listed = await json<DeletedSpace[]>(await api(me)("/trash/spaces"));
    expect(listed.map((d) => [d.name, d.lists])).toEqual([["Test Club", 1]]);
    expect(await json<DeletedSpace[]>(await api(friend)("/trash/spaces"))).toEqual([]);
    expect((await api(friend)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(404);

    // Back as it was: the space, the friend's link, the flow on.
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(200);
    expect(await spaces()).toContain("Test Club");
    expect(await friendCards()).toContain(share.id);
    const flows = await json<WorkflowView[]>(await api(me)(`/workflows${q}`));
    expect(flows.find((w) => w.id === flow.id)?.enabled).toBe(true);
    expect(await json<DeletedSpace[]>(await api(me)("/trash/spaces"))).toEqual([]);
  });

  it("says when a space with that name is back already", async () => {
    const me = await signUp("Test Owner");
    const sp = await json<SpaceView>(await api(me)("/spaces", { body: { name: "Test Home" } }));
    await api(me)(`/spaces/${sp.id}`, { method: "DELETE" });
    await api(me)("/spaces", { body: { name: "Test Home" } });
    expect((await api(me)(`/trash/spaces/${sp.id}/restore`, { body: {} })).status).toBe(409);
  });
});
