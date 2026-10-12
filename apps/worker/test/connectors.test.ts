// Connectors (decision 2026-10-12): a person connects their own Google Calendar (fake Google
// here), reads it, adds to it, and disconnects; the access lives in their own object and the
// consent link works once. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
type Connector = { kind: string; connected: boolean; account: string | null; available: boolean };

async function connect(u: User, code: string) {
  const { url } = await json<{ url: string }>(
    await api(u)("/connectors/google-calendar/connect", { body: {} }),
  );
  const state = new URL(url).searchParams.get("state")!;
  const back = await call(
    `/api/connectors/google-calendar/callback?state=${encodeURIComponent(state)}&code=${code}`,
  );
  return { state, back };
}

describe("Google Calendar connector", () => {
  it("connects, reads, adds and disconnects, for this person only", async () => {
    const me = await signUp("Test Owner");
    const before = await json<Connector[]>(await api(me)("/connectors"));
    expect(before).toEqual([
      expect.objectContaining({ kind: "google-calendar", connected: false, available: true }),
    ]);
    // Not connected yet: the calendar says how to connect.
    expect((await api(me)("/connectors/google-calendar/events")).status).toBe(400);

    const { state, back } = await connect(me, "fake-code-owner");
    expect(back.status).toBe(200);
    expect(await back.text()).toContain("Google Calendar is connected");
    // The state works once.
    const again = await call(
      `/api/connectors/google-calendar/callback?state=${encodeURIComponent(state)}&code=fake-code-owner`,
    );
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("expired");

    const after = await json<Connector[]>(await api(me)("/connectors"));
    expect(after[0]).toMatchObject({ connected: true, account: "owner@example.com" });

    const tomorrow = new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
    const added = await api(me)("/connectors/google-calendar/events", {
      body: { title: "Test rehearsal", start: `${tomorrow}T19:00`, place: "Test Studio" },
    });
    expect(added.status).toBe(201);
    expect(await json(added)).toMatchObject({ title: "Test rehearsal", start: `${tomorrow}T19:00:00+05:30` });
    // The same request again (a retry with its Idempotency-Key) returns the same event, once.
    const body = { title: "Test soundcheck", start: `${tomorrow}T17:00` };
    const first = await json<{ id: string }>(
      await api(me)("/connectors/google-calendar/events", { body, idempotencyKey: "test-cal-1" }),
    );
    const replay = await json<{ id: string }>(
      await api(me)("/connectors/google-calendar/events", { body, idempotencyKey: "test-cal-1" }),
    );
    expect(replay.id).toBe(first.id);
    const list = await json<{ events: { title: string }[] }>(
      await api(me)("/connectors/google-calendar/events?days=3"),
    );
    expect(list.events.map((e) => e.title).sort()).toEqual(["Test rehearsal", "Test soundcheck"]);

    // Someone else has no calendar of mine.
    const other = await signUp("Test Other");
    expect((await api(other)("/connectors/google-calendar/events")).status).toBe(400);
    // A state naming me can't be used without its secret.
    const forged = await call(
      `/api/connectors/google-calendar/callback?state=${me.id}.guess&code=fake-code-x`,
    );
    expect(forged.status).toBe(400);

    // Disconnect: forgotten here, and the calendar can't be read any more.
    const gone = await json<Connector[]>(await api(me)("/connectors/google-calendar", { method: "DELETE" }));
    expect(gone[0]).toMatchObject({ connected: false, account: null });
    expect((await api(me)("/connectors/google-calendar/events")).status).toBe(400);
  });

  it("says when Google said no", async () => {
    const me = await signUp("Test Owner");
    const { back } = await connect(me, "denied");
    expect(back.status).toBe(400);
    expect(await back.text()).toContain("couldn't be connected");
    expect((await json<Connector[]>(await api(me)("/connectors")))[0]!.connected).toBe(false);
  });

  it("gives the assistant the calendar only once it's connected, and adding waits for a tap", async () => {
    const me = await signUp("Test Owner");
    const say = (text: string) => api(me)("/chat", { body: { text } }).then((r) => json<ChatView>(r));
    const before = await say("Test: put the rehearsal in my calendar");
    expect(before.items.at(-1)!.text).toBe("No calendar here.");
    await connect(me, "fake-code-chat");
    const after = await say("Test: put the rehearsal in my calendar");
    const card = after.items.find((i) => i.card?.tool === "calendar_add_event")!.card!;
    expect(card.status).toBe("waiting");
    // Nothing is added before the tap; the tap adds it once.
    const list = () =>
      api(me)("/connectors/google-calendar/events?from=2030-01-05&days=1").then((r) =>
        json<{ events: { title: string }[] }>(r),
      );
    expect((await list()).events).toEqual([]);
    expect((await api(me)(`/chat/actions/${card.action_id}/confirm`, { body: {} })).status).toBe(200);
    expect((await list()).events.map((e) => e.title)).toEqual(["Test rehearsal"]);
  });
});
