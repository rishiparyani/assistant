// Several chats in one space (docs/design/chats-home.md 6): anyone in a shared space starts a
// chat inside it, for everyone or some of its people; only the space's people can be in it, and
// it never changes who is in the space. Fake data only.
import { describe, expect, it } from "vitest";
import {
  ulid,
  type CreatedShare,
  type GroupSummary,
  type GroupView,
  type RecordView,
  type SpacePerson,
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

/** A space made from a chat with Asha and Kabir; Dev knows the owner but isn't in the space. */
async function building() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test notes" } } }),
  );
  const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
  const asha = await signUp("Test Asha");
  const kabir = await signUp("Test Kabir");
  const dev = await signUp("Test Dev");
  for (const u of [asha, kabir, dev]) await api(u)("/cards/join", { body: { token: tokenOf(link) } });
  const g = await json<GroupView>(
    await api(owner)("/groups", {
      body: { id: ulid(), name: "Test Building", people: ["Test Asha", "Test Kabir"] },
    }),
  );
  const home = await json<GroupView>(await api(owner)(`/groups/${g.id}/home`, { method: "POST" }));
  const space = home.space_id!;
  // The space's people follow the chat (through the alarm): wait until Asha is in it.
  expect(
    await until(async () => {
      const r = await api(asha)(`/spaces/${space}/people`);
      return r.status === 200;
    }),
  ).toBe(true);
  return { owner, asha, kabir, dev, space, home };
}

const people = async (u: User, space: string) =>
  (await json<SpacePerson[]>(await api(u)(`/spaces/${space}/people`)))
    .filter((p) => p.role !== "shared")
    .map((p) => p.name)
    .sort();

describe("chats inside a space", () => {
  it("starts a private chat for some of the space's people, and leaves the space as it was", async () => {
    const { owner, asha, kabir, space } = await building();
    const before = await people(owner, space);
    // A member (not only the owner) can start one.
    const r = await api(asha)(`/spaces/${space}/chats`, {
      body: { id: ulid(), name: "Test Committee", people: ["Test Owner"] },
    });
    expect(r.status).toBe(201);
    const chat = await json<GroupView>(r);
    expect(chat.space_id).toBe(space);
    expect(chat.in_space).toBe(true);
    expect(chat.members.map((m) => m.name).sort()).toEqual(["Test Asha", "Test Owner"]);
    // Kabir isn't in it: he doesn't see it, and can't open it.
    const his = await json<GroupSummary[]>(await api(kabir)("/groups"));
    expect(his.some((g) => g.id === chat.id)).toBe(false);
    expect((await api(kabir)(`/groups/${chat.id}`)).status).toBe(404);
    // The owner sees it as one of the space's chats.
    const mine = await json<GroupSummary[]>(await api(owner)("/groups"));
    const row = mine.find((g) => g.id === chat.id)!;
    expect(row.space_id).toBe(space);
    expect(row.in_space).toBe(true);
    expect(mine.find((g) => g.space_id === space && !g.in_space)).toBeTruthy();
    // The space's people are the same as before (the new chat never syncs them).
    await new Promise((res) => setTimeout(res, 600));
    expect(await people(owner, space)).toEqual(before);
  });

  it("is for everyone in the space when no one is named", async () => {
    const { kabir, space } = await building();
    const chat = await json<GroupView>(
      await api(kabir)(`/spaces/${space}/chats`, { body: { id: ulid(), name: "Test Repairs" } }),
    );
    expect(chat.members.map((m) => m.name).sort()).toEqual(["Test Asha", "Test Kabir", "Test Owner"]);
  });

  it("takes only the space's people, now and later", async () => {
    const { owner, space } = await building();
    // Dev knows the owner (a shared note) but isn't in the space.
    const no = await api(owner)(`/spaces/${space}/chats`, {
      body: { id: ulid(), name: "Test Garden", people: ["Test Dev"] },
    });
    expect(no.status).toBe(404);
    const chat = await json<GroupView>(
      await api(owner)(`/spaces/${space}/chats`, {
        body: { id: ulid(), name: "Test Garden", people: ["Test Asha"] },
      }),
    );
    expect((await api(owner)(`/groups/${chat.id}/people`, { body: { people: ["Test Dev"] } })).status).toBe(
      404,
    );
    const added = await json<GroupView>(
      await api(owner)(`/groups/${chat.id}/people`, { body: { people: ["Test Kabir"] } }),
    );
    expect(added.members.map((m) => m.name).sort()).toEqual(["Test Asha", "Test Kabir", "Test Owner"]);
  });

  it("is refused to someone outside the space, and in a personal space", async () => {
    const { dev, owner, space } = await building();
    expect(
      (await api(dev)(`/spaces/${space}/chats`, { body: { id: ulid(), name: "Test Sneak" } })).status,
    ).toBe(404);
    const personal = await api(owner)(`/spaces/Personal/chats`, { body: { id: ulid(), name: "Test Me" } });
    expect(personal.status).toBe(400);
  });
});
