// When the assistant can't answer, the app's owner sees why (fixed words: the model and what
// stopped it), everyone else the plain sentence, and nobody the provider's own message.
// Owners come from ADMIN_EMAILS in vitest.config.ts. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { ChatView } from "@assistant/shared";
import { describe as cardWords, modelFailure } from "../src/core/assistant/service.ts";
import { fakeSystems } from "../src/core/assistant/fake-model.ts";
import { call, json, signUp } from "./http.ts";

const lastReply = async (cookie: string) => {
  const chat = await json<ChatView>(await call("/api/chat", { cookie, body: { text: "Test: fail" } }));
  return chat.items.filter((i) => i.role === "assistant").at(-1)!.text ?? "";
};

describe("why the assistant couldn't answer", () => {
  it("is shown to the app's owner only, in fixed words", async () => {
    const owner = await signUp("Test Owner", "owner.admin@example.com");
    const mine = await lastReply(owner.cookie);
    expect(mine).toMatch(/^I can't answer right now/);
    expect(mine).toMatch(
      /Why \(only the app's owners and admins see this\): .+: rate limited by the provider/,
    );
    expect(mine).not.toContain("Test private words");

    const someone = await signUp("Test Friend");
    const theirs = await lastReply(someone.cookie);
    expect(theirs).toMatch(/^I can't answer right now/);
    expect(theirs).not.toContain("Why");
  });

  it("names the kind of failure, never the message", () => {
    const kind = (m: string) => modelFailure(new Error(m));
    expect(kind("Claude: 401 invalid x-api-key")).toBe("its key was refused");
    expect(kind("Claude: 402 credit balance is too low")).toBe("out of credit with the provider");
    expect(kind("GLM needs AI credit")).toBe("needs AI credit (none on the account)");
    expect(kind("Claude: 529 overloaded")).toBe("the provider had an error");
    expect(kind("The operation was aborted due to timeout")).toBe("timed out");
    expect(kind('Something about "Asha\'s plans"')).toBe("the call failed");
  });

  it("is shown to an admin from the admin panel's list too", async () => {
    const admin = await signUp("Test Admin", "panel.admin@example.com");
    await env.DB.prepare(`insert into admins (email) values (?)`).bind("panel.admin@example.com").run();
    expect(await lastReply(admin.cookie)).toMatch(/Why \(only the app's owners and admins see this\)/);
  });

  it("words a saved view's card in plain words, never as data", () => {
    const card = cardWords("save_view", {
      name: "To do",
      collection: "Reminders",
      filters: [{ field: "Done", op: "ne", value: true }],
      sort: { field: "Due", dir: "asc" },
      pinned: true,
      add_fields: ["Title", "Due"],
      card: {
        arrangement: "list-ticks",
        controls: [{ field: "Done", as: "tick" }],
        row: {
          date: "Due",
          highlights: [
            { when: [{ field: "Due", op: "period", value: "past" }], colour: "red", label: "Overdue" },
          ],
        },
      },
    });
    expect(card.title).toBe("Save a view “To do” of Reminders");
    expect(card.details).toEqual([
      "Shows: Done isn't yes",
      "In order of Due, first to last",
      "On your home",
      "Adding one asks for Title, Due",
      "Card: list ticks",
      "Tick off by Done",
      "Each row shows its Due",
      "Marked “Overdue” in red when it applies",
    ]);
    // Search words, and clearing settings, are said too.
    expect(cardWords("save_view", { name: "Tax", collection: "Notes", search: "tax" }).details).toContain(
      "Only ones with “tax”",
    );
    expect(
      cardWords("update_view", { view_id: "Tax", search: null, sort: null, card_size: null }).details,
    ).toEqual(["No word search", "In the list's usual order", "Card size: picked by the app"]);
    // Any other tool: settings with parts are named, never printed as data.
    const other = cardWords("some_tool", {
      name: "X",
      layout: { a: 1 },
      parts: [{ b: 2 }],
      tags: ["a", "b"],
    });
    expect(other.details).toEqual(["name: X", "layout: set", "parts: set", "tags: a, b"]);
  });

  it("keeps the same instructions for every step of a request (signed thinking stays valid)", async () => {
    const me = await signUp("Test Owner");
    fakeSystems.length = 0;
    // Two model calls: "remember" (which changes what's remembered), then the reply.
    await call("/api/chat", { cookie: me.cookie, body: { text: "Test: remember weddings are 25000" } });
    expect(fakeSystems.length).toBeGreaterThanOrEqual(2);
    expect(new Set(fakeSystems).size).toBe(1);
    // The next request sees what was remembered.
    await call("/api/chat", { cookie: me.cookie, body: { text: "hi" } });
    expect(fakeSystems.at(-1)).toMatch(/Test weddings are/);
  });

  it("takes the person's pick of model: auto, quick or careful, nothing else", async () => {
    const me = await signUp("Test Picker");
    for (const model of ["auto", "quick", "careful"]) {
      const res = await call("/api/chat", { cookie: me.cookie, body: { text: "hi", model } });
      expect(res.status).toBe(200);
    }
    const bad = await call("/api/chat", { cookie: me.cookie, body: { text: "hi", model: "fast" } });
    expect(bad.status).toBe(400);
  });
});
