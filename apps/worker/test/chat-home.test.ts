// A home for each chat (decision 2026-10-14): admins (several), a shared space that belongs to
// the chat, its members following the chat's, and only admins changing how it's set up.
// Fake data only.
import { describe, expect, it } from "vitest";
import {
  ulid,
  type CollectionView,
  type CreatedShare,
  type GroupView,
  type RecordView,
  type SpaceView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** The owner knows Asha and Kabir (they joined a shared note); a family chat with both. */
async function family() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test trip ideas" } } }),
  );
  const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
  const asha = await signUp("Test Asha");
  const kabir = await signUp("Test Kabir");
  for (const u of [asha, kabir]) await api(u)("/cards/join", { body: { token: tokenOf(link) } });
  const g = await json<GroupView>(
    await api(owner)("/groups", {
      body: { id: ulid(), name: "Test Family", people: ["Test Asha", "Test Kabir"] },
    }),
  );
  const asId = g.members.find((m) => m.name === "Test Asha")!.user_id;
  const kabirId = g.members.find((m) => m.name === "Test Kabir")!.user_id;
  return { owner, asha, kabir, g, asId, kabirId };
}

describe("chat admins", () => {
  it("lets admins make admins, and always keeps one", async () => {
    const { owner, asha, g, asId } = await family();
    // A member can't.
    expect(
      (await api(asha)(`/groups/${g.id}/members/${asId}/role`, { body: { role: "admin" } })).status,
    ).toBe(403);
    const v = await json<GroupView>(
      await api(owner)(`/groups/${g.id}/members/${asId}/role`, { body: { role: "admin" } }),
    );
    expect(
      v.members
        .filter((m) => m.role === "owner")
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Test Asha", "Test Owner"]);
    expect(v.messages.at(-1)!.text).toBe("Test Owner made Test Asha an admin");
    // Now the first admin can step down and leave; the last admin can't.
    const ownerId = v.members.find((m) => m.name === "Test Owner")!.user_id;
    await api(owner)(`/groups/${g.id}/members/${ownerId}/role`, { body: { role: "member" } });
    expect(
      (await api(asha)(`/groups/${g.id}/members/${asId}/role`, { body: { role: "member" } })).status,
    ).toBe(409);
    expect((await api(asha)(`/groups/${g.id}/leave`, { method: "POST" })).status).toBe(409);
    expect((await api(owner)(`/groups/${g.id}/leave`, { method: "POST" })).status).toBe(200);
  });
});

describe("a chat's home", () => {
  it("is started by an admin, shared with the chat, and set up only by admins", async () => {
    const { owner, asha, kabir, g, asId } = await family();
    expect((await api(asha)(`/groups/${g.id}/home`, { method: "POST" })).status).toBe(403);
    const v = await json<GroupView>(await api(owner)(`/groups/${g.id}/home`, { method: "POST" }));
    expect(v.space_id).toBeTruthy();
    expect(v.messages.at(-1)!.text).toBe("Test Owner started a home for this chat");
    // Starting again finds the same home.
    expect(
      (await json<GroupView>(await api(owner)(`/groups/${g.id}/home`, { method: "POST" }))).space_id,
    ).toBe(v.space_id);
    const space = `?space=${v.space_id}`;
    // The admin starts a list there; everyone in the chat gets the home.
    const list = await api(owner)(`/lists/start`, { body: { space: v.space_id, kind: "reminders" } });
    expect(list.status).toBeLessThan(300);
    expect(await until(async () => (await api(kabir)(`/collections${space}`)).status === 200)).toBe(true);
    const spaces = await json<SpaceView[]>(await api(kabir)("/spaces"));
    expect(spaces.map((s) => s.name)).toContain("Test Family");
    // A member adds and ticks; a member can't change how it's set up.
    const r = await api(kabir)("/collections/Reminders/records", {
      body: { space: v.space_id, values: { Title: "Test pack chargers" } },
    });
    expect(r.status).toBe(201);
    const cols = await json<CollectionView[]>(await api(kabir)(`/collections${space}`));
    expect(cols.map((c) => c.name)).toEqual(["Reminders"]);
    expect(
      (
        await api(kabir)("/collections", {
          body: { space: v.space_id, name: "Test Kabir's list", fields: [{ name: "Title", type: "text" }] },
        })
      ).status,
    ).toBe(403);
    // Made an admin, Asha can.
    await api(owner)(`/groups/${g.id}/members/${asId}/role`, { body: { role: "admin" } });
    expect(
      await until(
        async () =>
          (
            await api(asha)("/collections", {
              body: { space: v.space_id, name: "Test Packing", fields: [{ name: "Title", type: "text" }] },
            })
          ).status === 201,
      ),
    ).toBe(true);
    // Someone who leaves the chat loses its home; strangers never see it.
    await api(kabir)(`/groups/${g.id}/leave`, { method: "POST" });
    expect(await until(async () => (await api(kabir)(`/collections${space}`)).status === 404)).toBe(true);
    const stranger = await signUp("Test Stranger");
    expect((await api(stranger)(`/collections${space}`)).status).toBe(404);
  });

  it("in a chat for two, either person starts and arranges it", async () => {
    const { owner, asha } = await family();
    const d = await json<GroupView>(
      await api(owner)("/groups", { body: { id: ulid(), people: ["Test Asha"], direct: true } }),
    );
    const v = await json<GroupView>(await api(asha)(`/groups/${d.id}/home`, { method: "POST" }));
    expect(v.space_id).toBeTruthy();
    expect(
      await until(
        async () =>
          (await api(owner)(`/lists/start`, { body: { space: v.space_id, kind: "notes" } })).status < 300,
      ),
    ).toBe(true);
  });
});
