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
import { getSetting, setSetting } from "../settings.ts";
import { authUrl, exchangeCode } from "../backup/drive.ts";
import {
  backupStatus,
  disconnectDrive,
  driveConnected,
  gunzip,
  restoreBackup,
  runBackup,
  saveDriveToken,
  type BackupFile,
} from "../backup/service.ts";

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
  // Backups to Google Drive (decision 2026-09-28).
  r.get("/api/admin/backup", async (c) =>
    c.json({
      google_configured: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      connected: await driveConnected(c.env),
      last: await backupStatus(c.env),
    }),
  );
  // Starts the Google consent for Drive (files this app creates only).
  r.get("/api/admin/drive/connect", async (c) => {
    if (!c.env.GOOGLE_CLIENT_ID) throw new AppError("validation_failed", "Google sign-in isn't set up");
    const state = crypto.randomUUID();
    const expires = Date.now() + 10 * 60_000;
    await setSetting(c.env.DB, "drive_oauth_state", `${state}|${c.get("userCtx").user.id}|${expires}`);
    return c.redirect(authUrl(c.env.GOOGLE_CLIENT_ID, `${c.env.BASE_URL}/api/admin/drive/callback`, state));
  });
  r.get("/api/admin/drive/callback", async (c) => {
    const saved = (await getSetting(c.env.DB, "drive_oauth_state"))?.split("|");
    await setSetting(c.env.DB, "drive_oauth_state", null); // one use only
    const ok =
      saved &&
      saved[0] === c.req.query("state") &&
      saved[1] === c.get("userCtx").user.id &&
      Date.now() < Number(saved[2]);
    const code = c.req.query("code");
    if (!ok || !code) return c.redirect("/admin?drive=error");
    try {
      const refresh = await exchangeCode(
        {
          clientId: c.env.GOOGLE_CLIENT_ID,
          clientSecret: c.env.GOOGLE_CLIENT_SECRET,
          redirectUri: `${c.env.BASE_URL}/api/admin/drive/callback`,
        },
        code,
      );
      await saveDriveToken(c.env, refresh);
      await admin.logAdmin(c.env.DB, c.get("userCtx").user.id, "drive_connected", {});
      return c.redirect("/admin?drive=connected");
    } catch (err) {
      console.error("backup: couldn't connect Google Drive", err);
      return c.redirect("/admin?drive=error");
    }
  });
  r.post("/api/admin/drive/disconnect", async (c) => {
    await disconnectDrive(c.env);
    await admin.logAdmin(c.env.DB, c.get("userCtx").user.id, "drive_disconnected", {});
    return c.json({ connected: false });
  });
  r.post("/api/admin/backup/run", async (c) => {
    const status = await runBackup(c.env, modules);
    if (!status) throw new AppError("validation_failed", "Connect Google Drive first");
    await admin.logAdmin(c.env.DB, c.get("userCtx").user.id, "backup_run", { ok: status.ok });
    return c.json(status);
  });
  // Restore (owners only): puts back what's missing, never overwrites. Body: the backup
  // file (gzip or plain JSON), with ?confirm=RESTORE.
  r.post("/api/admin/restore", async (c) => {
    if (!admin.ownerEmails(c.env).includes(c.get("userCtx").user.email.toLowerCase()))
      throw new AppError("forbidden", "Only owners can restore");
    if (c.req.query("confirm") !== "RESTORE")
      throw new AppError("validation_failed", "Add ?confirm=RESTORE to restore");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const text =
      bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    let file: BackupFile;
    try {
      file = JSON.parse(text) as BackupFile;
    } catch {
      throw new AppError("validation_failed", "Not a backup file");
    }
    const result = await restoreBackup(c.env, modules, file).catch((err: Error) => {
      throw new AppError("validation_failed", err.message);
    });
    await admin.logAdmin(c.env.DB, c.get("userCtx").user.id, "restore", result);
    return c.json(result);
  });

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
