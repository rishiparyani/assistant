// Faster answers from Cerebras (decision 2026-10-15): offered first at the everyday level only
// to people who have it, only while its key is set, and within its own daily and per-minute
// caps; the Cloudflare cap and the free allowance never see it. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { modelsFor, type AiSettings } from "../src/core/assistant/models.ts";

const base: AiSettings = {
  paidGateway: null,
  capPaise: 200_000,
  personCapPaise: 200_000,
  usdInr: 90,
  fake: true,
  everydayModel: null,
  fast: false,
  fastCallsPerDay: 60,
  fastCallsPerMinute: 4,
};
const ids = (ms: { id: string }[]) => ms.map((m) => m.id);

describe("faster answers", () => {
  it("is offered first, only to people who have it, only once the key is in", async () => {
    expect(ids(modelsFor(1, base))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    expect(ids(modelsFor(1, base, true))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    const on = { ...base, fast: true };
    expect(ids(modelsFor(1, on))).toEqual(["@cf/zai-org/glm-4.7-flash"]);
    // Cerebras first, GLM still there to fall back on.
    expect(ids(modelsFor(1, on, true))).toEqual(["gpt-oss-120b", "@cf/zai-org/glm-4.7-flash"]);
    // Never at the smart level.
    expect(ids(modelsFor(2, { ...on, paidGateway: "paid" }, true))).not.toContain("gpt-oss-120b");
  });

  it("keeps its own credit out of the Cloudflare cap when the scorecard tries it", async () => {
    const tried = modelsFor(1, { ...base, paidGateway: "paid", everydayModel: "gpt-oss-120b" });
    expect(tried.map((m) => [m.id, m.route])).toEqual([["gpt-oss-120b", "free"]]);
    // A Workers AI candidate is billed to the credit, as before.
    const cf = modelsFor(1, { ...base, paidGateway: "paid", everydayModel: "@cf/zai-org/glm-5.3-flash" });
    expect(cf.map((m) => m.route)).toEqual(["paid"]);
  });

  it("hands out slots up to the day's cap and the minute's, taken before the call", async () => {
    const stub = env.BUDGET.get(env.BUDGET.idFromName(`budget:test-${crypto.randomUUID()}`));
    const take = (perDay: number, perMinute = 4) => stub.takeFastSlot("gpt-oss-120b", perDay, perMinute);
    // Four in a minute, then the fifth waits; the count is taken as the slot is, so two requests
    // at once can't both be the fourth.
    for (let n = 0; n < 4; n++) expect(await take(60)).toBe(true);
    expect(await take(60)).toBe(false);
    expect(await Promise.all([take(60), take(60)])).toEqual([false, false]);
    // Slots from earlier today don't count for the minute, but do for the day.
    await runInDurableObject(stub, async (_i, state) => {
      state.storage.sql.exec(`update fast_slots set at = ?`, new Date(Date.now() - 5 * 60_000).toISOString());
    });
    expect(await take(5)).toBe(true);
    expect(await take(5)).toBe(false);
    expect(await take(60)).toBe(true);
    // Other models' slots don't count.
    expect(await stub.takeFastSlot("@cf/zai-org/glm-4.7-flash", 5, 4)).toBe(true);
  });
});
