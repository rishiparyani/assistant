// Spaces (docs/design/universal.md): thin services that find the caller's space and hand
// the call to its object, which checks the caller's role itself.
import { ulid, nameKey, type SpaceSettings, type SpaceView } from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import type { Actor } from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";

export const spaceName = (id: string) => `space:${id}`;
/** Who acts: the caller, or, while rehearsing, the person played (checked as them). */
export const actorOf = (ctx: OpUserCtx): Actor => ({
  userId: ctx.practice ? ctx.practice.as : ctx.user.id,
  source: ctx.source,
});
/** The caller themself, even while rehearsing (the copy's owner, for what only they may do). */
export const ownerActorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
/** The practice copy's object, while rehearsing. */
export const practiceStub = (ctx: OpUserCtx) =>
  ctx.practice ? ctx.objects.SPACES.getByName(spaceName(ctx.practice.space)) : null;

type SpaceRow = {
  id: string;
  name: string;
  kind: "personal" | "shared";
  role: SpaceView["role"];
  practice_of: string | null;
};

async function rows(ctx: OpUserCtx): Promise<SpaceRow[]> {
  const res = await ctx.d1
    .prepare(
      `select s.id, s.name, s.kind, m.role, s.practice_of from space_members m join spaces s on s.id = m.space_id
       where m.user_id = ? and s.deleted_at is null
       order by case when s.kind = 'personal' then 0 else 1 end, s.name`,
    )
    .bind(ctx.user.id)
    .all<SpaceRow>();
  return res.results;
}

/** The caller's personal space, made (empty) the first time. */
async function ensurePersonal(ctx: OpUserCtx): Promise<void> {
  const id = ulid();
  await ctx.d1.batch([
    ctx.d1
      .prepare(
        `insert or ignore into spaces (id, name, kind, owner_user_id) values (?, 'Personal', 'personal', ?)`,
      )
      .bind(id, ctx.user.id),
    ctx.d1
      .prepare(
        `insert or ignore into space_members (space_id, user_id, role)
         select id, owner_user_id, 'owner' from spaces where owner_user_id = ? and kind = 'personal'`,
      )
      .bind(ctx.user.id),
  ]);
  const row = await ctx.d1
    .prepare(`select id from spaces where owner_user_id = ? and kind = 'personal'`)
    .bind(ctx.user.id)
    .first<{ id: string }>();
  if (!row) throw new Error("personal space missing after insert");
  await ctx.objects.SPACES.getByName(spaceName(row.id)).init({
    id: row.id,
    name: "Personal",
    kind: "personal",
    owner: { user_id: ctx.user.id, name: ctx.user.name },
    // New people start empty; the assistant starts lists as they're needed.
    starter: false,
  });
}

export async function mySpaces(ctx: OpUserCtx): Promise<SpaceView[]> {
  // Rehearsing: the one space is the copy, as the person played sees it (a member of it, with
  // their role; someone only shared with has no space, only cards). Never a personal space.
  if (ctx.practice) {
    const copy = (await rows(ctx)).find((s) => s.id === ctx.practice!.space);
    if (!copy) return [];
    const role = await practiceStub(ctx)!.practiceRoleOf(ownerActorOf(ctx), ctx.practice.as);
    return role ? [{ ...copy, role }] : [];
  }
  let list = await rows(ctx);
  if (!list.some((s) => s.kind === "personal")) {
    await ensurePersonal(ctx);
    list = await rows(ctx);
  }
  return list;
}

/**
 * A new space of the person's own (decision 2026-10-16 "Spaces": the band, home, the society
 * gate), with its own lists, cards, chats, memory and instructions. Kind "shared" like a
 * chat's home (it can be shared later); the person is its owner and only member for now.
 */
export async function newSpace(ctx: OpUserCtx, name: string, id = ulid()): Promise<SpaceView> {
  const clean = name.trim();
  const mine = await mySpaces(ctx);
  if (mine.some((s) => nameKey(s.name) === nameKey(clean)))
    throw new ObjectError("conflict", `You already have a space called "${clean}"`);
  if (mine.length >= 20) throw new ObjectError("conflict", "Up to 20 spaces; remove one first");
  await ctx.d1.batch([
    ctx.d1
      .prepare(`insert or ignore into spaces (id, name, kind, owner_user_id) values (?, ?, 'shared', ?)`)
      .bind(id, clean, ctx.user.id),
    ctx.d1
      .prepare(`insert or ignore into space_members (space_id, user_id, role) values (?, ?, 'owner')`)
      .bind(id, ctx.user.id),
  ]);
  await ctx.objects.SPACES.getByName(spaceName(id)).init({
    id,
    name: clean,
    kind: "shared",
    owner: { user_id: ctx.user.id, name: ctx.user.name },
    starter: false,
  });
  return { id, name: clean, kind: "shared", role: "owner" };
}

/**
 * A practice copy of a space (decision 2026-10-16 "Rehearse a workflow", second part): its
 * lists, records, rules and workflows (all on), with nothing in it reaching anyone. It's a
 * space of the person's own ("Practice: Home"), so it counts toward their 20.
 */
export async function startPractice(ctx: OpUserCtx, ref?: string): Promise<SpaceView> {
  const { space, stub, actor } = await spaceOf(ctx, ref);
  if (space.practice_of) throw new ObjectError("validation_failed", "This is already a practice copy");
  const source = await stub.practiceSource(actor);
  const mine = await mySpaces(ctx);
  if (mine.length >= 20)
    throw new ObjectError("conflict", "Up to 20 spaces; end a practice or remove a space first");
  let name = `Practice: ${source.name}`;
  for (let n = 2; mine.some((s) => nameKey(s.name) === nameKey(name)); n++)
    name = `Practice ${n}: ${source.name}`;
  const id = ulid();
  await ctx.d1.batch([
    ctx.d1
      .prepare(
        `insert into spaces (id, name, kind, owner_user_id, practice_of) values (?, ?, 'shared', ?, ?)`,
      )
      .bind(id, name, ctx.user.id, space.id),
    ctx.d1
      .prepare(`insert into space_members (space_id, user_id, role) values (?, ?, 'owner')`)
      .bind(id, ctx.user.id),
  ]);
  await ctx.objects.SPACES.getByName(spaceName(id)).startPractice(
    { id, name, owner: { user_id: ctx.user.id, name: ctx.user.name }, sourceId: space.id },
    source.dump,
  );
  return { id, name, kind: "shared", role: "owner", practice_of: space.id };
}

/** A practice copy only: the space's object refuses any other. */
export async function practiceOf(ctx: OpUserCtx, ref: string) {
  if (ctx.practice) throw new ObjectError("forbidden", "Not while rehearsing as someone. Tap Done first.");
  const found = await spaceOf(ctx, ref);
  if (!found.space.practice_of) throw new ObjectError("not_found", "Not a practice copy");
  return found;
}

export async function practiceView(ctx: OpUserCtx, ref: string) {
  const { stub, actor } = await practiceOf(ctx, ref);
  return stub.practiceView(actor);
}

export async function practiceAnswer(
  ctx: OpUserCtx,
  ref: string,
  i: { wait_id: string; as_user_id: string; answer: string },
) {
  const { stub, actor } = await practiceOf(ctx, ref);
  return stub.practiceAnswer(actor, i.wait_id, i.as_user_id, i.answer);
}

/** Ends a practice copy: it's erased and leaves the person's spaces. */
export async function endPractice(ctx: OpUserCtx, ref: string): Promise<{ ended: string }> {
  const { space, stub, actor } = await practiceOf(ctx, ref);
  await stub.endPractice(actor);
  await ctx.d1.batch([
    ctx.d1.prepare(`update spaces set deleted_at = ? where id = ?`).bind(new Date().toISOString(), space.id),
    ctx.d1.prepare(`delete from space_members where space_id = ?`).bind(space.id),
  ]);
  return { ended: space.id };
}

/** One space with its instructions. */
export async function spaceSettings(ctx: OpUserCtx, ref?: string): Promise<SpaceSettings> {
  const { space, stub, actor } = await spaceOf(ctx, ref);
  return { ...space, instructions: await stub.instructions(actor) };
}

export async function setSpaceInstructions(ctx: OpUserCtx, ref: string | undefined, text: string) {
  const { space, stub, actor } = await spaceOf(ctx, ref);
  const r = await stub.setInstructions(actor, ctx.idempotencyKey, text);
  return { ...space, instructions: r.instructions };
}

/** Rehearsing as someone with no space of their own (only cards): their lists are none. */
export async function practiceHasNoSpace(ctx: OpUserCtx): Promise<boolean> {
  return !!ctx.practice && !(await mySpaces(ctx)).length;
}

/** A space of mine by id or name; my personal space when left out. Others' spaces are 404. */
export async function spaceOf(ctx: OpUserCtx, ref?: string) {
  const list = await mySpaces(ctx);
  const hit = ref
    ? (list.find((s) => s.id === ref) ?? list.filter((s) => nameKey(s.name) === nameKey(ref)))
    : // Rehearsing, the copy stands in for "my space"; otherwise the personal one.
      ctx.practice
      ? list.find((s) => s.id === ctx.practice!.space)
      : list.find((s) => s.kind === "personal");
  const one = Array.isArray(hit)
    ? hit.length === 1
      ? hit[0]
      : hit.length > 1
        ? (() => {
            throw new ObjectError("ambiguous", `More than one space called "${ref}"`, {
              candidates: hit.map((s) => ({ id: s.id, name: s.name })),
            });
          })()
        : undefined
    : hit;
  if (!one)
    throw new ObjectError("not_found", `No space "${ref}". Spaces: ${list.map((s) => s.name).join(", ")}`);
  return { space: one, stub: ctx.objects.SPACES.getByName(spaceName(one.id)), actor: actorOf(ctx) };
}
