// The test-phase reset (decision 2026-10-16 "Start over from a GitHub job, never from the app").
// Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { FindResult } from "@assistant/shared";
import { RESET_WORDS, resetRoutes } from "../src/core/reset/service.ts";
import { spaceName } from "../src/core/spaces/service.ts";
import { modules } from "../src/modules/index.ts";
import { call, json, signUp } from "./http.ts";

const DB = (env as unknown as { DB: D1Database }).DB;
const TOKEN = "t".repeat(48);
const step = (body: Record<string, unknown>, token = TOKEN, words = RESET_WORDS) =>
  resetRoutes(modules).request(
    "/",
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ words, ...body }),
    },
    { ...env, RESET_TOKEN: TOKEN },
  );
const count = async (table: string) =>
  (await DB.prepare(`select count(*) as n from "${table}"`).first<{ n: number }>())!.n;

describe("start over", () => {
  it("doesn't exist without the job's secret, or with a wrong one", async () => {
    // Through the Worker as deployed: no RESET_TOKEN, so a 404 whatever is sent.
    const res = await call("/api/internal/reset", {
      body: { words: RESET_WORDS, step: "database" },
      bearer: TOKEN,
    });
    expect(res.status).toBe(404);
    expect((await step({ step: "database" }, "x".repeat(48))).status).toBe(404);
    // The right secret with the wrong words does nothing.
    expect((await step({ step: "database" }, TOKEN, "erase")).status).toBe(400);
    expect(await count("user")).toBeGreaterThanOrEqual(0);
  });

  it("erases every account and everything people made, and keeps the settings", async () => {
    const me = await signUp("Test Owner");
    await call("/api/collections/Notes/records", {
      cookie: me.cookie,
      body: { values: { Title: "Test PA" } },
    });
    await DB.prepare(
      `insert or replace into app_settings (key, value) values ('alerts_enabled', 'yes')`,
    ).run();
    const space = (await DB.prepare(`select id from spaces`).first<{ id: string }>())!.id;
    expect(await count("user")).toBe(1);

    const spaces = env.SPACES.idFromName(spaceName(space)).toString();
    const chats = env.CHATS.idFromName(`chat:${me.id}`).toString();
    await call("/api/chats/current", { cookie: me.cookie }); // the person's chat object holds data
    const a = await json(await step({ step: "objects", binding: "SPACES", ids: [spaces] }));
    expect(a).toMatchObject({ ok: true, wiped: 1, failed: 0 });
    expect(await json(await step({ step: "objects", binding: "CHATS", ids: [chats] }))).toMatchObject({
      wiped: 1,
    });
    // The AI budget is never erased (this month's spend still counts against the cap).
    expect((await step({ step: "objects", binding: "BUDGET", ids: [chats] })).status).toBe(400);
    const db = await json<{ tables: number; rows: number }>(await step({ step: "database" }));
    expect(db.rows).toBeGreaterThan(0);

    for (const t of ["user", "session", "account", "spaces", "space_members", "assistant_access"])
      expect(await count(t)).toBe(0);
    expect(await count("app_settings")).toBe(1);
    expect(await count("d1_migrations")).toBeGreaterThan(0);

    // The same person signs up again and starts empty: a new space with only what sign-up makes.
    const again = await signUp("Test Owner", me.email);
    expect(again.id).not.toBe(me.id);
    const notes = await json<FindResult>(
      await call("/api/collections/Notes/find", { cookie: again.cookie, body: {} }),
    );
    expect(notes.items).toEqual([]);
    // The erased space's object is empty: opening it again starts from nothing.
    const old = await env.SPACES.getByName(spaceName(space)).exportData();
    expect(old).toBeNull();
  });
});
