// Who may use the in-app assistant (chat-first step 4; decision "Collaborators have no
// assistant by default"). Owners (ADMIN_EMAILS) and admins always; anyone else only when an
// owner or admin switches it on for them, since it costs the owner. Until any owner is set
// up, everyone keeps it, so nobody is locked out before ADMIN_EMAILS exists.
import { ulid, type Person } from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import { AppError } from "../errors.ts";
import { knownPeople } from "../spaces/shares.ts";
import { hashOf } from "../objects/storage.ts";

async function isAdminCtx(ctx: OpUserCtx): Promise<boolean> {
  const email = ctx.user.email.toLowerCase();
  if (ctx.owners.includes(email)) return true;
  return (await ctx.d1.prepare(`select 1 as ok from admins where email = ?`).bind(email).first()) !== null;
}

async function anyOwner(ctx: OpUserCtx): Promise<boolean> {
  if (ctx.owners.length) return true;
  return (await ctx.d1.prepare(`select 1 as ok from admins limit 1`).first()) !== null;
}

/** Whether this person may ask the assistant. */
export async function assistantAllowed(ctx: OpUserCtx): Promise<boolean> {
  if (!(await anyOwner(ctx)) || (await isAdminCtx(ctx))) return true;
  const row = await ctx.d1
    .prepare(`select 1 as ok from assistant_access where user_id = ?`)
    .bind(ctx.user.id)
    .first();
  return row !== null;
}

/** Whether the assistant is on for another person (by id): owners, admins, or switched on. */
export async function assistantOnFor(ctx: OpUserCtx, userId: string): Promise<boolean> {
  if (!(await anyOwner(ctx))) return true;
  const row = await ctx.d1
    .prepare(
      `select lower(u.email) as email,
              (select 1 from assistant_access a where a.user_id = u.id) as on_,
              (select 1 from admins d where d.email = lower(u.email)) as admin
       from "user" u where u.id = ?`,
    )
    .bind(userId)
    .first<{ email: string; on_: number | null; admin: number | null }>();
  if (!row) return false;
  return !!row.on_ || !!row.admin || ctx.owners.includes(row.email);
}

export async function requireAssistant(ctx: OpUserCtx): Promise<void> {
  if (!(await assistantAllowed(ctx)))
    throw new AppError(
      "forbidden",
      "The assistant isn't on for you. Everything shared with you still works; ask the person who shared it to switch the assistant on for you.",
    );
}

async function requireAdminCtx(ctx: OpUserCtx) {
  if (!(await isAdminCtx(ctx))) throw new AppError("not_found", "Not found");
}

/** `fixed`: an owner or admin, who always has it (the switch can't change that). */
export type AssistantPerson = Person & { on: boolean; fixed: boolean };

/** Which of these people are owners or admins (by their sign-in email). */
async function fixedIds(ctx: OpUserCtx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ctx.d1
    .prepare(
      `select u.id, lower(u.email) as email, a.email as admin from "user" u
       left join admins a on a.email = lower(u.email) where u.id in (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<{ id: string; email: string; admin: string | null }>();
  return new Set(rows.results.filter((r) => r.admin || ctx.owners.includes(r.email)).map((r) => r.id));
}

/** People I know, with whether the assistant is on for them (owners and admins only). */
export async function assistantPeople(ctx: OpUserCtx): Promise<AssistantPerson[]> {
  await requireAdminCtx(ctx);
  const people = await knownPeople(ctx);
  if (!people.length) return [];
  const ids = people.map((p) => p.user_id);
  const [on, fixed] = await Promise.all([
    ctx.d1
      .prepare(`select user_id from assistant_access where user_id in (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ user_id: string }>(),
    fixedIds(ctx, ids),
  ]);
  const granted = new Set(on.results.map((r) => r.user_id));
  return people.map((p) => ({
    ...p,
    on: fixed.has(p.user_id) || granted.has(p.user_id),
    fixed: fixed.has(p.user_id),
  }));
}

/**
 * Switches the assistant on or off for someone I know (owners and admins only). Idempotent
 * by key (kept in my own chat object), and their open app hears about it.
 */
export async function setAssistantAccess(
  ctx: OpUserCtx,
  userId: string,
  on: boolean,
): Promise<AssistantPerson> {
  await requireAdminCtx(ctx);
  const mine = ctx.objects.CHATS.get(ctx.objects.CHATS.idFromName(`chat:${ctx.user.id}`));
  const key = ctx.idempotencyKey && `assistant_access:${ctx.idempotencyKey}`;
  const hash = await hashOf(["assistant_access", userId, on]);
  if (key) {
    const prior = await mine.recallResult(ctx.user.id, key, hash);
    if (prior) return prior as AssistantPerson;
  }
  const person = (await knownPeople(ctx)).find((p) => p.user_id === userId);
  if (!person) throw new AppError("not_found", "You can switch it on only for people you know");
  if ((await fixedIds(ctx, [userId])).has(userId))
    throw new AppError(
      "validation_failed",
      `${person.name} is an owner or admin and always has the assistant`,
    );
  await ctx.d1.batch([
    on
      ? ctx.d1
          .prepare(`insert or ignore into assistant_access (user_id, granted_by) values (?, ?)`)
          .bind(userId, ctx.user.id)
      : ctx.d1.prepare(`delete from assistant_access where user_id = ?`).bind(userId),
    ctx.d1
      .prepare(`insert into admin_audit (id, actor_user_id, action, detail_json) values (?, ?, ?, ?)`)
      .bind(ulid(), ctx.user.id, on ? "assistant_on" : "assistant_off", JSON.stringify({ user_id: userId })),
  ]);
  const result: AssistantPerson = { ...person, on, fixed: false };
  if (key) await mine.keepResult(ctx.user.id, key, hash, result);
  // Their open app refreshes (the composer turns on or off). Best effort.
  try {
    await ctx.objects.LIVE.getByName(`live:${userId}`).ping({ type: "assistant_changed" });
  } catch (e) {
    console.warn("live ping failed", e);
  }
  return result;
}
