// The morning line: one or two sentences in the chat at the person's hour, from their own
// lists; nothing on a quiet day; off or moved from the chat. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { ChatView, MeResponse, SpaceView } from "@assistant/shared";
import { inSlot, morningFor } from "../src/core/assistant/morning.ts";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
/** A moment on a given India date at HH:MM India time. */
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

describe("the morning line", () => {
  it("says what's due today, once a day, at 8 unless moved, and nothing on a quiet day", async () => {
    const me = await signUp("Test Owner");
    const { user } = await json<MeResponse>(await api(me)("/me"));
    const [space] = await json<SpaceView[]>(await api(me)("/spaces"));
    const today = todayIst();
    const dayAfter = (d: string) =>
      new Date(ist(d, "12:00").getTime() + 86_400_000).toISOString().slice(0, 10);
    await api(me)("/collections/Reminders/records", {
      body: { values: { Title: "Test call the plumber", Due: `${today}T18:00` } },
    });
    // Before its hour: not yet. At it: the line, and the first time a note on how to change it.
    expect(await morningFor(env, user.id, space!.id, ist(today, "07:40"))).toBe("not_now");
    expect(await morningFor(env, user.id, space!.id, ist(today, "08:10"))).toBe("sent");
    const chat = await json<ChatView>(await api(me)("/chats/main"));
    const line = chat.items.find((i) => i.role === "assistant")!;
    expect(line.text).toBe("Test: Test call the plumber is due today.");
    expect(chat.items.at(-1)!.role).toBe("note");
    expect(chat.items.at(-1)!.text).toContain("each morning at 8");
    // The same day again: once is once.
    expect(await morningFor(env, user.id, space!.id, ist(today, "08:14"))).toBe("sent_already");

    // Moved to seven from the chat; then off.
    await api(me)("/chat", { body: { text: "Test: morning line at seven" } });
    const next = dayAfter(today);
    expect(await morningFor(env, user.id, space!.id, ist(next, "08:05"))).toBe("not_now");
    expect(await morningFor(env, user.id, space!.id, ist(next, "07:05"))).toBe("sent");
    await api(me)("/chat", { body: { text: "Test: stop the morning line" } });
    expect(await morningFor(env, user.id, space!.id, ist(dayAfter(next), "07:05"))).toBe("off");
    // A late retry of an older change (same key) can't undo the newer one (Codex on PR 185).
    expect(
      (
        await api(me)("/me/morning", {
          method: "PUT",
          body: { on: true, at: "06:30" },
          idempotencyKey: "m-1",
        })
      ).status,
    ).toBe(200);
    await api(me)("/me/morning", { method: "PUT", body: { on: false }, idempotencyKey: "m-2" });
    await api(me)("/me/morning", { method: "PUT", body: { on: true, at: "06:30" }, idempotencyKey: "m-1" });
    expect(await morningFor(env, user.id, space!.id, ist(dayAfter(dayAfter(next)), "06:35"))).toBe("off");

    // A quiet day (nothing dated): no model call, no message.
    const quiet = await signUp("Test Quiet");
    const q = await json<MeResponse>(await api(quiet)("/me"));
    const [qs] = await json<SpaceView[]>(await api(quiet)("/spaces"));
    expect(await morningFor(env, q.user.id, qs!.id, ist(today, "08:05"))).toBe("nothing");
    expect((await json<ChatView>(await api(quiet)("/chats/main"))).items).toEqual([]);
  });

  it("matches a setting to the quarter hour it falls in", () => {
    expect(inSlot("08:00", ist("2026-10-23", "08:05"))).toBe(true);
    expect(inSlot("08:14", ist("2026-10-23", "08:00"))).toBe(true);
    expect(inSlot("08:15", ist("2026-10-23", "08:00"))).toBe(false);
    expect(inSlot("07:59", ist("2026-10-23", "08:00"))).toBe(false);
  });
});
