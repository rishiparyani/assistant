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

  it("stops at the day's cap and at four a minute", async () => {
    const stub = env.BUDGET.get(env.BUDGET.idFromName(`budget:test-${crypto.randomUUID()}`));
    const call = (at: string) =>
      runInDurableObject(stub, async (_i, state) => {
        state.storage.sql.exec(
          `insert into calls (at, user_id, level, model, input_tokens, output_tokens, cost_paise, neurons, ms, outcome)
           values (?, 'u1', 1, 'gpt-oss-120b', 100, 10, 1, 0, 500, 'ok')`,
          at,
        );
      });
    expect(await stub.fastAllowed("gpt-oss-120b", 5)).toBe(true);
    // Four in the last minute: the fifth waits.
    for (let n = 0; n < 4; n++) await call(new Date().toISOString());
    expect(await stub.fastAllowed("gpt-oss-120b", 60)).toBe(false);
    // Older calls don't count for the minute, but do for the day.
    const stale = env.BUDGET.get(env.BUDGET.idFromName(`budget:test-${crypto.randomUUID()}`));
    const earlier = new Date(Date.now() - 5 * 60_000).toISOString();
    for (let n = 0; n < 5; n++)
      await runInDurableObject(stale, async (_i, state) => {
        state.storage.sql.exec(
          `insert into calls (at, user_id, level, model, input_tokens, output_tokens, cost_paise, neurons, ms, outcome)
           values (?, 'u1', 1, 'gpt-oss-120b', 100, 10, 1, 0, 500, 'ok')`,
          earlier,
        );
      });
    expect(await stale.fastAllowed("gpt-oss-120b", 6)).toBe(true);
    expect(await stale.fastAllowed("gpt-oss-120b", 5)).toBe(false);
    // Other models' calls don't count.
    expect(await stale.fastAllowed("@cf/zai-org/glm-4.7-flash", 5)).toBe(true);
  });
});
