// Spaces (docs/design/universal.md): thin services that find the caller's space and hand
// the call to its object, which checks the caller's role itself.
import { ulid, nameKey, type SpaceView } from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import type { Actor } from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";

export const spaceName = (id: string) => `space:${id}`;
const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });

type SpaceRow = { id: string; name: string; kind: "personal" | "shared"; role: SpaceView["role"] };

async function rows(ctx: OpUserCtx): Promise<SpaceRow[]> {
  const res = await ctx.d1
    .prepare(
      `select s.id, s.name, s.kind, m.role from space_members m join spaces s on s.id = m.space_id
       where m.user_id = ? and s.deleted_at is null order by s.kind desc, s.name`,
    )
    .bind(ctx.user.id)
    .all<SpaceRow>();
  return res.results;
}

/** The caller's personal space, made (with the starter setup) the first time. */
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
    starter: true,
  });
}

export async function mySpaces(ctx: OpUserCtx): Promise<SpaceView[]> {
  let list = await rows(ctx);
  if (!list.some((s) => s.kind === "personal")) {
    await ensurePersonal(ctx);
    list = await rows(ctx);
  }
  return list;
}

/** A space of mine by id or name; my personal space when left out. Others' spaces are 404. */
export async function spaceOf(ctx: OpUserCtx, ref?: string) {
  const list = await mySpaces(ctx);
  const hit = ref
    ? (list.find((s) => s.id === ref) ?? list.filter((s) => nameKey(s.name) === nameKey(ref)))
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
