// Health checks and alerts (design §10a) and the dead letter path. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runAlerts } from "../src/core/alerts/service.ts";
import { recordDeadLetters } from "../src/modules/gigs/objects/delivery.ts";
import { modules } from "../src/modules/index.ts";
import { call, json, signUp } from "./http.ts";

const OWNER = "owner.admin@example.com";
async function owner() {
  const body = { name: "Test Owner", email: OWNER, password: "test-password-123" };
  const up = await call("/auth/sign-up/email", { body });
  const res =
    up.status === 200
      ? up
      : await call("/auth/sign-in/email", { body: { email: OWNER, password: body.password } });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function fakeBatch(bodies: { gig_id: string; seq: number }[]) {
  let acked = false;
  return {
    batch: {
      queue: "summaries-dev-dlq",
      messages: bodies.map((body) => ({
        body,
        ack() {},
        retry() {},
        attempts: 1,
        id: body.gig_id,
        timestamp: new Date(),
      })),
      ackAll: () => (acked = true),
      retryAll() {},
    } as unknown as MessageBatch<{ gig_id: string; seq: number }>,
    acked: () => acked,
  };
}

const state = async (id: string) =>
  (await env.DB.prepare(`select firing from alert_state where id = ?`).bind(id).first<{ firing: string }>())
    ?.firing;

describe("alerts", () => {
  it("fire when deliveries fail every retry, and clear after the retry tool", async () => {
    const cookie = await owner();
    const u = await signUp();
    const gig = await json<{ id: string }>(
      await call("/api/gigs", {
        cookie: u.cookie,
        body: { title: "Test Dead", events: [{ start_at: "2027-04-01T19:00" }] },
      }),
    );

    const { batch, acked } = fakeBatch([{ gig_id: gig.id, seq: 1 }]);
    await recordDeadLetters(batch, env.DB);
    expect(acked()).toBe(true);

    let checks = await runAlerts(env, modules);
    expect(checks.find((c) => c.id === "gigs.dead_letters")).toMatchObject({ ok: false });
    expect(await state("gigs.dead_letters")).toBe("yes");
    expect(checks.find((c) => c.id === "gigs.delivery_stuck")).toMatchObject({ ok: true });

    // The admin panel shows it; the retry tool clears it.
    const shown = await json<{
      enabled: boolean;
      checks: { id: string; ok: boolean; since: string | null }[];
    }>(await call("/api/admin/alerts", { cookie }));
    expect(shown.enabled).toBe(false); // not production
    expect(shown.checks.find((c) => c.id === "gigs.dead_letters")).toMatchObject({
      ok: false,
      since: expect.any(String),
    });
    const tool = await call("/api/admin/tools/gigs.retry_dead", { cookie, body: {} });
    expect(await json(tool)).toEqual({ result: "Re-sent 1 gig." });

    checks = await runAlerts(env, modules);
    expect(checks.find((c) => c.id === "gigs.dead_letters")).toMatchObject({ ok: true });
    expect(await state("gigs.dead_letters")).toBe("no");
  });

  it("can be switched on and off by admins only, and says when Telegram isn't set up", async () => {
    const cookie = await owner();
    const someone = await signUp();
    expect((await call("/api/admin/alerts", { cookie: someone.cookie })).status).toBe(404);
    expect(await json(await call("/api/admin/alerts", { cookie, body: { enabled: true } }))).toEqual({
      enabled: true,
    });
    expect((await json(await call("/api/admin/alerts", { cookie }))).enabled).toBe(true);
    await call("/api/admin/alerts", { cookie, body: { enabled: false } });
    const test = await call("/api/admin/alerts/test", { cookie, body: {} });
    expect(test.status).toBe(400);
    expect((await json(test)).error.message).toContain("TELEGRAM_BOT_TOKEN");
  });
});
