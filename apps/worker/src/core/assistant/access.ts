// Who may use the in-app assistant (chat-first step 4; decision "Collaborators have no
// assistant by default"). Owners (ADMIN_EMAILS) and admins always; anyone else only when an
// owner or admin switches it on for them, since it costs the owner. Until any owner is set
// up, everyone keeps it, so nobody is locked out before ADMIN_EMAILS exists.
import { ulid, type Person } from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import { AppError } from "../errors.ts";
import { knownPeople } from "../spaces/shares.ts";

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

export type AssistantPerson = Person & { on: boolean };

/** People I know, with whether the assistant is on for them (owners and admins only). */
export async function assistantPeople(ctx: OpUserCtx): Promise<AssistantPerson[]> {
  await requireAdminCtx(ctx);
  const people = await knownPeople(ctx);
  if (!people.length) return [];
  const on = await ctx.d1
    .prepare(`select user_id from assistant_access where user_id in (${people.map(() => "?").join(",")})`)
    .bind(...people.map((p) => p.user_id))
    .all<{ user_id: string }>();
  const ids = new Set(on.results.map((r) => r.user_id));
  return people.map((p) => ({ ...p, on: ids.has(p.user_id) }));
}

/** Switches the assistant on or off for someone I know (owners and admins only). */
export async function setAssistantAccess(
  ctx: OpUserCtx,
  userId: string,
  on: boolean,
): Promise<AssistantPerson> {
  await requireAdminCtx(ctx);
  const person = (await knownPeople(ctx)).find((p) => p.user_id === userId);
  if (!person) throw new AppError("not_found", "You can switch it on only for people you know");
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
  return { ...person, on };
}
