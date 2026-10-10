// Who may use the assistant (chat-first step 4): owners always, others only when an owner
// switches it on for them. Owners come from ADMIN_EMAILS in vitest.config.ts. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView, CreatedShare, RecordView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

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
});
