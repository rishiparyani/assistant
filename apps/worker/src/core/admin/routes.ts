// Admin panel routes (owner-only). Not operations: they're never MCP tools or Siri
// actions. Everyone who isn't an admin gets 404, so the panel's existence isn't revealed.
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { ModuleDefinition } from "../module.ts";
import { objectBindings, requireUser, type AppEnv } from "../context.ts";
import { AppError } from "../errors.ts";
import * as admin from "./service.ts";
import { operationStats } from "../metrics.ts";
import { alertsEnabled, collectChecks, setAlertsEnabled } from "../alerts/service.ts";
import { sendTelegram, telegramChat } from "../alerts/telegram.ts";

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await admin.isAdmin(c.env, c.get("userCtx").user.email)))
    throw new AppError("not_found", "Not found");
  await next();
});

export function adminRoutes(modules: readonly ModuleDefinition[]) {
  const r = new Hono<AppEnv>();
  const ctxOf = (env: Env) => ({ d1: env.DB, objects: objectBindings(env) });

  // Anyone signed in may ask whether they're an admin (the app shows the link only then).
  r.get("/api/admin/me", requireUser, async (c) =>
    c.json({ is_admin: await admin.isAdmin(c.env, c.get("userCtx").user.email) }),
  );

  r.use("/api/admin/*", requireUser, requireAdmin);
  r.get("/api/admin/overview", async (c) => c.json(await admin.overview(ctxOf(c.env), modules)));
  r.get("/api/admin/admins", async (c) => c.json(await admin.listAdmins(c.env)));
  r.post("/api/admin/admins", async (c) => {
    const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    return c.json(await admin.addAdmin(c.env, c.get("userCtx").user.id, body.email ?? ""));
  });
  r.delete("/api/admin/admins/:email", async (c) =>
    c.json(await admin.removeAdmin(c.env, c.get("userCtx").user.id, c.req.param("email"))),
  );
  r.post("/api/admin/tools/:tool", async (c) => {
    const body = await c.req.json<Record<string, string>>().catch(() => ({}));
    return c.json(
      await admin.runTool(ctxOf(c.env), modules, c.get("userCtx").user.id, c.req.param("tool"), body),
    );
  });
  r.get("/api/admin/log", async (c) => c.json(await admin.adminLog(c.env)));
  // Alerts (design §10a): Telegram status, on/off, the checks right now, a test message.
  r.get("/api/admin/alerts", async (c) => {
    const [checks, enabled, chat, state] = await Promise.all([
      collectChecks(c.env, modules),
      alertsEnabled(c.env),
      telegramChat(c.env),
      c.env.DB.prepare(`select id, firing, since from alert_state`).all<{
        id: string;
        firing: string;
        since: string | null;
      }>(),
    ]);
    const since = new Map(state.results.filter((r) => r.firing === "yes").map((r) => [r.id, r.since]));
    return c.json({
      enabled,
      telegram: { token: !!c.env.TELEGRAM_BOT_TOKEN, chat: !!chat },
      checks: checks.map((ch) => ({ ...ch, since: since.get(ch.id) ?? null })),
    });
  });
  r.post("/api/admin/alerts", async (c) => {
    const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({}) as { enabled?: boolean });
    if (typeof body.enabled !== "boolean")
      throw new AppError("validation_failed", "Send enabled: true or false");
    await setAlertsEnabled(c.env, body.enabled);
    await admin.logAdmin(c.env.DB, c.get("userCtx").user.id, body.enabled ? "alerts_on" : "alerts_off", {});
    return c.json({ enabled: body.enabled });
  });
  r.post("/api/admin/alerts/test", async (c) => {
    const sent = await sendTelegram(c.env, "✅ Assistant: test alert. Alerts reach you here.");
    if (!sent)
      throw new AppError(
        "validation_failed",
        c.env.TELEGRAM_BOT_TOKEN
          ? "Couldn't find your chat: open your bot in Telegram, press Start and send it any message, then try again."
          : "The TELEGRAM_BOT_TOKEN secret isn't set yet.",
      );
    return c.json({ sent: true });
  });

  // Per-action counts, errors and speed over the last day (Analytics Engine). Needs the
  // read-only ANALYTICS_TOKEN secret; says so instead of failing when it's missing.
  r.get("/api/admin/operations", async (c) => {
    try {
      const operations = await operationStats(c.env);
      return c.json({ available: operations !== null, operations: operations ?? [] });
    } catch (err) {
      console.error("admin: operation stats failed", err);
      return c.json({ available: false, operations: [], error: "Couldn't read the numbers right now" });
    }
  });
  return r;
}
