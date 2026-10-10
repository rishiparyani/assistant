// Who may use the assistant (chat-first step 4): owners always, others only when an owner
// switches it on for them. Owners come from ADMIN_EMAILS in vitest.config.ts. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView, CreatedShare, RecordView } from "@assistant/shared";
import { exports } from "cloudflare:workers";
import { call, json, signUp } from "./http.ts";

const BASE = "http://localhost:8787";
const worker = () => (exports as unknown as { default: Fetcher }).default;

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

let owner: User | null = null;
/** The owner from ADMIN_EMAILS (signed up once for this file). */
async function theOwner() {
  owner ??= await signUp("Test Owner", "second.owner@example.com", { assistant: false });
  return owner;
}

describe("assistant access", () => {
  it("is off for collaborators until an owner switches it on, and back off", async () => {
    const boss = await theOwner();
    // The owner has it without being switched on.
    expect((await json<ChatView>(await api(boss)("/chat"))).assistant_on).toBe(true);
    expect((await api(boss)("/chat", { body: { text: "hi" } })).status).toBe(200);

    const friend = await signUp("Test Friend", undefined, { assistant: false });
    expect((await json<ChatView>(await api(friend)("/chat"))).assistant_on).toBe(false);
    expect((await api(friend)("/chat", { body: { text: "hi" } })).status).toBe(403);
    // Lists still work without it.
    expect(
      (await api(friend)("/collections/Notes/records", { body: { values: { Title: "Test note" } } })).status,
    ).toBe(201);

    // The owner knows the friend once they join something.
    const note = await json<RecordView>(
      await api(boss)("/collections/Notes/records", { body: { values: { Title: "Test shared" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(boss)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    await api(friend)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    const people = await json<{ user_id: string; on: boolean }[]>(await api(boss)("/assistant/people"));
    expect(people.find((p) => p.user_id === friend.id)?.on).toBe(false);

    const on = await api(boss)(`/assistant/people/${friend.id}`, { method: "PUT", body: { on: true } });
    expect(on.status).toBe(200);
    expect((await api(friend)("/chat", { body: { text: "hi" } })).status).toBe(200);
    await api(boss)(`/assistant/people/${friend.id}`, { method: "PUT", body: { on: false } });
    expect((await api(friend)("/chat", { body: { text: "hi" } })).status).toBe(403);
  });

  it("only owners switch it, and only for people they know", async () => {
    const boss = await theOwner();
    const friend = await signUp("Test Friend", undefined, { assistant: false });
    const stranger = await signUp("Test Stranger", undefined, { assistant: false });
    expect((await api(friend)("/assistant/people")).status).toBe(404);
    expect(
      (await api(friend)(`/assistant/people/${friend.id}`, { method: "PUT", body: { on: true } })).status,
    ).toBe(404);
    expect(
      (await api(boss)(`/assistant/people/${stranger.id}`, { method: "PUT", body: { on: true } })).status,
    ).toBe(404);
  });

  it("a replayed switch doesn't undo a later one, and the person's open app hears it", async () => {
    const boss = await theOwner();
    const friend = await signUp("Test Friend", undefined, { assistant: false });
    const note = await json<RecordView>(
      await api(boss)("/collections/Notes/records", { body: { values: { Title: "Test again" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(boss)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    await api(friend)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });

    // The friend's app is open.
    const ws = (
      await worker().fetch(`${BASE}/api/live`, {
        headers: { cookie: friend.cookie, origin: BASE, upgrade: "websocket" },
      })
    ).webSocket!;
    ws.accept();
    const got: string[] = [];
    ws.addEventListener("message", (e) => got.push(String(e.data)));

    const turnOn = () =>
      api(boss)(`/assistant/people/${friend.id}`, {
        method: "PUT",
        body: { on: true },
        idempotencyKey: "test-access-on",
      });
    expect((await turnOn()).status).toBe(200);
    const until = Date.now() + 5000;
    while (!got.some((m) => m.includes("assistant_changed")) && Date.now() < until)
      await new Promise((r) => setTimeout(r, 100));
    expect(got.some((m) => m.includes("assistant_changed"))).toBe(true);
    ws.close(1000);

    await api(boss)(`/assistant/people/${friend.id}`, { method: "PUT", body: { on: false } });
    // The first request replayed (say its answer was lost): it changes nothing now.
    expect((await turnOn()).status).toBe(200);
    expect((await api(friend)("/chat", { body: { text: "hi" } })).status).toBe(403);
  });

  it("shows owners as always on, and their switch can't be changed", async () => {
    const boss = await theOwner();
    const other = await signUp("Test Owner Two", "owner.admin@example.com", { assistant: false });
    const note = await json<RecordView>(
      await api(boss)("/collections/Notes/records", { body: { values: { Title: "Test owners" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(boss)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    await api(other)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    const people = await json<{ user_id: string; on: boolean; fixed: boolean }[]>(
      await api(boss)("/assistant/people"),
    );
    expect(people.find((p) => p.user_id === other.id)).toMatchObject({ on: true, fixed: true });
    expect(
      (await api(boss)(`/assistant/people/${other.id}`, { method: "PUT", body: { on: false } })).status,
    ).toBe(400);
  });
});
