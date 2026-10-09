// The owner-only admin panel (docs/design/gig-centric.md §10b). Access: emails in the
// ADMIN_EMAILS secret (owners; can't be removed from the panel, so nobody locks themselves
// out) plus admins added from the panel (D1 `admins`). Shows counts only.
import { ulid } from "@assistant/shared";
import type { AdminCtx, AdminSection, ModuleDefinition } from "../module.ts";
import { AppError } from "../errors.ts";
import { formatINR } from "@assistant/shared";
import { FREE_NEURONS_PER_DAY, type AiSettings } from "../assistant/models.ts";

export const ownerEmails = (env: Env) =>
  (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export async function isAdmin(env: Env, email: string): Promise<boolean> {
  const e = email.toLowerCase();
  if (ownerEmails(env).includes(e)) return true;
  const row = await env.DB.prepare(`select 1 as ok from admins where email = ?`).bind(e).first();
  return row !== null;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

async function count(d1: D1Database, sql: string, ...args: unknown[]): Promise<number> {
  return (
    (
      await d1
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

/** People and sign-in counts from core tables (indexed columns only). */
async function peopleSection(d1: D1Database): Promise<AdminSection> {
  const [total, signups7, signups30, active1, active7] = await Promise.all([
    count(d1, `select count(*) as n from "user"`),
    count(d1, `select count(*) as n from "user" where createdAt >= ?`, daysAgo(7)),
    count(d1, `select count(*) as n from "user" where createdAt >= ?`, daysAgo(30)),
    count(d1, `select count(distinct userId) as n from session where updatedAt >= ?`, daysAgo(1)),
    count(d1, `select count(distinct userId) as n from session where updatedAt >= ?`, daysAgo(7)),
  ]);
  return {
    title: "People",
    stats: [
      { label: "Accounts", value: total },
      { label: "New this week", value: signups7 },
      { label: "New this month", value: signups30 },
      { label: "Active today", value: active1, hint: "signed in and used the app in the last 24 h" },
      { label: "Active this week", value: active7 },
    ],
  };
}

/** The assistant's spending this month and today's free allowance (design §10). */
async function aiSection(ctx: AdminCtx, settings: AiSettings): Promise<AdminSection> {
  const budget = ctx.objects.BUDGET.get(ctx.objects.BUDGET.idFromName("budget:global"));
  const v = await budget.view(settings.capPaise);
  const used = v.spent_paise + v.reserved_paise;
  const pct = v.cap_paise ? Math.round((used / v.cap_paise) * 100) : 0;
  return {
    title: "Assistant (AI)",
    stats: [
      {
        label: `Spent in ${v.month}`,
        value: formatINR(used),
        hint: `of ${formatINR(v.cap_paise)} (calls stop at 90%)`,
        tone: pct >= 80 ? "bad" : pct >= 50 ? "warn" : "ok",
      },
      {
        label: "Free allowance today",
        value: `${Math.round((v.neurons_today / FREE_NEURONS_PER_DAY) * 100)}%`,
        hint: `${v.neurons_today.toLocaleString("en-IN")} of ${FREE_NEURONS_PER_DAY.toLocaleString("en-IN")} neurons (resets 5:30 AM IST)`,
      },
      { label: "Model calls today", value: v.calls_today },
      {
        label: "Smart model",
        value: settings.paidGateway ? "On" : "Off",
        hint: settings.paidGateway ? "prepaid credit route" : "needs prepaid AI credit (docs/setup.md)",
        tone: settings.paidGateway ? "ok" : "warn",
      },
    ],
  };
}

export async function overview(ctx: AdminCtx, modules: readonly ModuleDefinition[], settings?: AiSettings) {
  const sections = [await peopleSection(ctx.d1)];
  if (settings) {
    try {
      sections.push(await aiSection(ctx, settings));
    } catch (err) {
      console.error("admin: AI section failed", err);
    }
  }
  for (const m of modules) {
    if (!m.admin?.sections) continue;
    try {
      sections.push(...(await m.admin.sections(ctx)));
    } catch (err) {
      console.error(`admin: ${m.id} sections failed`, err);
      sections.push({ title: m.name, stats: [{ label: "Couldn't load", value: "—", tone: "bad" }] });
    }
  }
  const tools = modules.flatMap((m) =>
    (m.admin?.tools ?? []).map((t) => ({
      id: `${m.id}.${t.id}`,
      label: t.label,
      description: t.description,
      fields: t.fields ?? [],
    })),
  );
  return { sections, tools, generated_at: new Date().toISOString() };
}

export async function runTool(
  ctx: AdminCtx,
  modules: readonly ModuleDefinition[],
  actorUserId: string,
  toolId: string,
  input: Record<string, string>,
) {
  const [moduleId, id] = toolId.split(".", 2);
  const tool = modules.find((m) => m.id === moduleId)?.admin?.tools?.find((t) => t.id === id);
  if (!tool) throw new AppError("not_found", "No such tool");
  const result = await tool.run(ctx, input);
  await logAdmin(ctx.d1, actorUserId, `tool:${toolId}`, { input, result });
  return { result };
}

export async function listAdmins(env: Env) {
  const { results } = await env.DB.prepare(
    `select a.email, a.created_at, u.name as added_by_name
     from admins a left join "user" u on u.id = a.added_by order by a.created_at`,
  ).all<{ email: string; created_at: string; added_by_name: string | null }>();
  return {
    owners: ownerEmails(env),
    admins: results.map((r) => ({ email: r.email, added_at: r.created_at, added_by: r.added_by_name })),
  };
}

export async function addAdmin(env: Env, actorUserId: string, email: string) {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new AppError("validation_failed", "Enter a valid email");
  await env.DB.prepare(`insert or ignore into admins (email, added_by) values (?, ?)`)
    .bind(e, actorUserId)
    .run();
  await logAdmin(env.DB, actorUserId, "add_admin", { email: e });
  return listAdmins(env);
}

export async function removeAdmin(env: Env, actorUserId: string, email: string) {
  const e = email.trim().toLowerCase();
  if (ownerEmails(env).includes(e))
    throw new AppError("conflict", "Owners come from the ADMIN_EMAILS secret and can't be removed here");
  await env.DB.prepare(`delete from admins where email = ?`).bind(e).run();
  await logAdmin(env.DB, actorUserId, "remove_admin", { email: e });
  return listAdmins(env);
}

export async function adminLog(env: Env) {
  const { results } = await env.DB.prepare(
    `select l.action, l.detail_json, l.created_at, u.name as actor
     from admin_audit l left join "user" u on u.id = l.actor_user_id
     order by l.created_at desc limit 50`,
  ).all<{ action: string; detail_json: string | null; created_at: string; actor: string | null }>();
  return results.map((r) => ({
    action: r.action,
    detail: r.detail_json ? (JSON.parse(r.detail_json) as unknown) : null,
    at: r.created_at,
    actor: r.actor,
  }));
}

export async function logAdmin(d1: D1Database, actorUserId: string, action: string, detail: unknown) {
  await d1
    .prepare(`insert into admin_audit (id, actor_user_id, action, detail_json) values (?, ?, ?, ?)`)
    .bind(ulid(), actorUserId, action, JSON.stringify(detail))
    .run();
}
