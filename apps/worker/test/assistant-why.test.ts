// When the assistant can't answer, the app's owner sees why (fixed words: the model and what
// stopped it), everyone else the plain sentence, and nobody the provider's own message.
// Owners come from ADMIN_EMAILS in vitest.config.ts. Fake data only.
import { describe, expect, it } from "vitest";
import type { ChatView } from "@assistant/shared";
import { modelFailure } from "../src/core/assistant/service.ts";
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
    expect(mine).toMatch(/Why \(only the app's owner sees this\): .+: rate limited by the provider/);
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
});
