// Sharing (docs/design/universal.md §11): the owner shares one record (a card) with the
// linked parts they choose; others join with a link and see only that card. The join link
// carries its space's id, so a join goes straight to that space's object, which keeps only
// the link's hash and checks every open and edit. D1 lists which spaces hold a person's shares.
import type { z } from "zod";
import type {
  AddSharedRecordInput,
  CreateShareInput,
  CreatedShare,
  SharedWithMe,
  UpdateSharedRecordInput,
} from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import type { Actor } from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";
import { hashToken, newToken } from "../tokens.ts";
import { spaceName, spaceOf } from "./service.ts";

const PREFIX = "shr";
const TOKEN_RE = /^shr_([0-9A-HJKMNP-TV-Z]{26})_[A-Za-z0-9_-]{43}$/;
const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });

function newShareToken(spaceId: string) {
  return `${PREFIX}_${spaceId}_${newToken("x").slice(2)}`;
}
/** The link people open; the token is in the part after #, so it never reaches server logs. */
const linkFor = (ctx: OpUserCtx, token: string) => `${ctx.baseUrl}/join#${token}`;

/** A new share and its link (shown now; only its hash is kept). */
export async function createShare(
  ctx: OpUserCtx,
  i: z.output<typeof CreateShareInput>,
): Promise<CreatedShare> {
  const { space, stub, actor } = await spaceOf(ctx, i.space);
  const token = newShareToken(space.id);
  const tokenHash = await hashToken(token);
  const made = await stub.createShare(actor, ctx.idempotencyKey, {
    recordId: i.record_id,
    include: i.include ?? [],
    access: i.access,
    hide: i.hide_fields ?? [],
    expiresInDays: i.expires_in_days ?? null,
    tokenHash,
  });
  // A repeated request returns the share made the first time, whose link we no longer have:
  // give it a new one so the link shown always works.
  if (made.token_hash !== tokenHash) {
    const reset = await stub.resetShareLink(actor, null, made.share.id, tokenHash);
    return { share: reset.share, link: linkFor(ctx, token) };
  }
  return { share: made.share, link: linkFor(ctx, token) };
}

/** A new link for a share; the old one stops working. */
export async function resetShareLink(ctx: OpUserCtx, spaceRef: string | undefined, shareId: string) {
  const { space, stub, actor } = await spaceOf(ctx, spaceRef);
  const token = newShareToken(space.id);
  const tokenHash = await hashToken(token);
  let made = await stub.resetShareLink(actor, ctx.idempotencyKey, shareId, tokenHash);
  if (made.token_hash !== tokenHash) made = await stub.resetShareLink(actor, null, shareId, tokenHash);
  return { share: made.share, link: linkFor(ctx, token) } satisfies CreatedShare;
}

export async function removeSharePerson(
  ctx: OpUserCtx,
  spaceRef: string | undefined,
  shareId: string,
  userId: string,
) {
  const { space, stub, actor } = await spaceOf(ctx, spaceRef);
  const share = await stub.removeSharePerson(actor, ctx.idempotencyKey, shareId, userId);
  await ctx.d1
    .prepare(`delete from shared_with where user_id = ? and share_id = ? and space_id = ?`)
    .bind(userId, shareId, space.id)
    .run();
  return share;
}

// --- The collaborator's side ---------------------------------------------------------------

export async function joinShare(ctx: OpUserCtx, token: string) {
  const m = TOKEN_RE.exec(token);
  const gone = () => new ObjectError("not_found", "This link doesn't work any more. Ask for a new one.");
  if (!m) throw gone();
  const spaceId = m[1]!;
  const joined = await ctx.objects.SPACES.getByName(spaceName(spaceId)).joinShare(
    actorOf(ctx),
    ctx.user.name,
    await hashToken(token),
  );
  if (!joined) throw gone();
  await ctx.d1
    .prepare(`insert or ignore into shared_with (user_id, share_id, space_id) values (?, ?, ?)`)
    .bind(ctx.user.id, joined.share_id, spaceId)
    .run();
  return joined;
}

export async function sharedWithMe(ctx: OpUserCtx): Promise<SharedWithMe[]> {
  const rows = await ctx.d1
    .prepare(`select distinct space_id from shared_with where user_id = ?`)
    .bind(ctx.user.id)
    .all<{ space_id: string }>();
  const lists = await Promise.all(
    rows.results.map((r) => ctx.objects.SPACES.getByName(spaceName(r.space_id)).sharesFor(actorOf(ctx))),
  );
  return lists.flat().sort((a, b) => (a.joined_at < b.joined_at ? 1 : -1));
}

/** The space that holds a share the caller joined; 404 otherwise. */
async function shareStub(ctx: OpUserCtx, shareId: string) {
  const row = await ctx.d1
    .prepare(`select space_id from shared_with where user_id = ? and share_id = ?`)
    .bind(ctx.user.id, shareId)
    .first<{ space_id: string }>();
  if (!row) throw new ObjectError("not_found", "Share not found");
  return { stub: ctx.objects.SPACES.getByName(spaceName(row.space_id)), spaceId: row.space_id };
}

export async function openShare(ctx: OpUserCtx, shareId: string) {
  const { stub } = await shareStub(ctx, shareId);
  return stub.openShare(actorOf(ctx), shareId);
}

export async function updateSharedRecord(ctx: OpUserCtx, i: z.output<typeof UpdateSharedRecordInput>) {
  const { stub } = await shareStub(ctx, i.share_id);
  return stub.updateSharedRecord(actorOf(ctx), ctx.idempotencyKey, i.share_id, i.record_id, i.values);
}

export async function addSharedRecord(ctx: OpUserCtx, i: z.output<typeof AddSharedRecordInput>) {
  const { stub } = await shareStub(ctx, i.share_id);
  return stub.addSharedRecord(actorOf(ctx), ctx.idempotencyKey, i.share_id, i.section, {
    id: i.id ?? null,
    values: i.values,
  });
}

export async function leaveShare(ctx: OpUserCtx, shareId: string) {
  const { stub, spaceId } = await shareStub(ctx, shareId);
  await stub.leaveShare(actorOf(ctx), ctx.idempotencyKey, shareId);
  await ctx.d1
    .prepare(`delete from shared_with where user_id = ? and share_id = ? and space_id = ?`)
    .bind(ctx.user.id, shareId, spaceId)
    .run();
  return { left: shareId };
}
