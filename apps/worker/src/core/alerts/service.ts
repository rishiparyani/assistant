// Health checks and alerts (design §10a). Every 15 minutes (cron) the checks run; a check
// that starts failing sends one Telegram message, a fixed one sends "Fixed", and one
// that keeps failing is repeated at most once a day. Only production sends messages
// (unless turned on for dev); state is kept either way so the admin panel can show it.
import type { AdminCtx, HealthCheck, ModuleDefinition } from "../module.ts";
import { objectBindings } from "../context.ts";
import { operationStats } from "../metrics.ts";
import { getSetting, setSetting } from "../settings.ts";
import { sendTelegram } from "./telegram.ts";
import { backupStatus, driveConnected } from "../backup/service.ts";

const REMIND_MS = 24 * 3600_000;

type AlertEnv = Env & {
  TELEGRAM_BOT_TOKEN?: string;
  ANALYTICS_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
};

/** Checks that belong to core: errors and slowness, from the per-action metrics. */
async function coreChecks(env: AlertEnv): Promise<HealthCheck[]> {
  const stats = await operationStats(env, 15).catch(() => null);
  if (!stats) return []; // no analytics token: these checks aren't available
  const calls = stats.reduce((n, s) => n + s.calls, 0);
  const errors = stats.reduce((n, s) => n + s.server_errors, 0);
  const slow = stats.filter((s) => s.calls >= 10 && s.p95_ms > 1500);
  return [
    {
      id: "core.errors",
      label: "Errors",
      ok: calls < 20 || errors / calls <= 0.02,
      detail: `${errors} of ${calls} requests failed in the last 15 minutes`,
      fix: "Open the admin panel (Actions) to see which action fails; Cloudflare's logs have the details.",
    },
    {
      id: "core.slow",
      label: "Slow",
      ok: slow.length === 0,
      detail: slow.map((s) => `${s.operation} ${s.p95_ms} ms`).join(", ") || undefined,
      fix: "Usually passes by itself; if it lasts, check Cloudflare's status page.",
    },
  ];
}

/** Backups: fails when the last one failed or none succeeded for 26 hours (once connected). */
async function backupCheck(env: AlertEnv, now = new Date()): Promise<HealthCheck[]> {
  if (!(await driveConnected(env))) return [];
  const last = await backupStatus(env);
  const since = await getSetting(env.DB, "drive_connected_at");
  const lastOkAge = last?.ok ? now.getTime() - Date.parse(last.at) : null;
  const connectedAge = since ? now.getTime() - Date.parse(since) : 0;
  const overdue = lastOkAge === null ? connectedAge > 26 * 3600_000 : lastOkAge > 26 * 3600_000;
  return [
    {
      id: "core.backup",
      label: "Backup",
      ok: !(last && !last.ok) && !overdue,
      detail:
        last && !last.ok
          ? `Last backup failed: ${last.error}`
          : overdue
            ? "No backup in over a day"
            : undefined,
      fix: "Admin panel → Backups → Back up now; if Google Drive was disconnected, connect it again.",
    },
  ];
}

export async function collectChecks(
  env: AlertEnv,
  modules: readonly ModuleDefinition[],
): Promise<HealthCheck[]> {
  const ctx: AdminCtx = { d1: env.DB, objects: objectBindings(env) };
  const lists = await Promise.all([
    coreChecks(env),
    backupCheck(env),
    ...modules.map(async (m) => {
      if (!m.admin?.checks) return [];
      try {
        return await m.admin.checks(ctx);
      } catch (err) {
        console.error(`alerts: ${m.id} checks failed to run`, err);
        return [{ id: `${m.id}.checks`, label: `${m.name} checks`, ok: false, detail: "Couldn't run" }];
      }
    }),
  ]);
  return lists.flat();
}

/** Whether this environment sends messages (production by default; dev only if asked). */
export async function alertsEnabled(env: AlertEnv): Promise<boolean> {
  const setting = await getSetting(env.DB, "alerts_enabled");
  return setting ? setting === "yes" : env.ENVIRONMENT === "production";
}

type StateRow = { id: string; firing: string; since: string | null; last_sent_at: string | null };

const bad = (c: HealthCheck) =>
  `🔴 Gigspree: ${c.label}${c.detail ? `\n${c.detail}` : ""}${c.fix ? `\nWhat to do: ${c.fix}` : ""}`;

export async function runAlerts(
  env: AlertEnv,
  modules: readonly ModuleDefinition[],
  now = new Date(),
): Promise<HealthCheck[]> {
  const checks = await collectChecks(env, modules);
  const send = await alertsEnabled(env);
  const { results } = await env.DB.prepare(
    `select id, firing, since, last_sent_at from alert_state`,
  ).all<StateRow>();
  const state = new Map(results.map((r) => [r.id, r]));
  const iso = now.toISOString();

  for (const c of checks) {
    const s = state.get(c.id);
    const firing = s?.firing === "yes";
    if (!c.ok && !firing) {
      const sent = send && (await sendTelegram(env, bad(c)));
      await upsert(env.DB, c.id, "yes", c.detail ?? null, iso, sent ? iso : null);
    } else if (!c.ok && firing) {
      const last = s?.last_sent_at ? Date.parse(s.last_sent_at) : 0;
      if (send && now.getTime() - last > REMIND_MS) {
        const text = `🟠 Still happening since ${s?.since?.slice(0, 16).replace("T", " ")} UTC\n${bad(c)}`;
        if (await sendTelegram(env, text))
          await env.DB.prepare(`update alert_state set last_sent_at = ? where id = ?`).bind(iso, c.id).run();
      }
    } else if (c.ok && firing) {
      if (send && s?.last_sent_at) await sendTelegram(env, `✅ Gigspree: ${c.label} is fixed.`);
      await upsert(env.DB, c.id, "no", null, null, null);
    }
  }
  return checks;
}

async function upsert(
  d1: D1Database,
  id: string,
  firing: "yes" | "no",
  message: string | null,
  since: string | null,
  lastSent: string | null,
) {
  await d1
    .prepare(
      `insert into alert_state (id, firing, message, since, last_sent_at) values (?, ?, ?, ?, ?)
       on conflict (id) do update set firing = excluded.firing, message = excluded.message,
         since = excluded.since, last_sent_at = excluded.last_sent_at`,
    )
    .bind(id, firing, message, since, lastSent)
    .run();
}

export async function setAlertsEnabled(env: AlertEnv, on: boolean) {
  await setSetting(env.DB, "alerts_enabled", on ? "yes" : "no");
}
