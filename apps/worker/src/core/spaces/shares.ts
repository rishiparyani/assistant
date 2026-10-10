// Sharing (docs/design/universal.md §11): the owner shares one record (a card) with the
// linked parts they choose; others join with a link and see only that card. The join link
// carries its space's id, so a join goes straight to that space's object, which keeps only
// the link's hash and checks every open and edit. D1 lists which spaces hold a person's shares.
import type { z } from "zod";
import { nameKey } from "@assistant/shared";
import type {
  AddSharedRecordInput,
  AskPeopleInput,
  QuestionView,
  CreateShareInput,
  CreatedShare,
  Person,
  ShareView,
  ShareWithInput,
  SharedWithMe,
  UpdateSharedRecordInput,
} from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import type { Actor } from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";
import { hashToken, newToken } from "../tokens.ts";
import { mySpaces, spaceName, spaceOf } from "./service.ts";

const PREFIX = "shr";
const TOKEN_RE = /^shr_([0-9A-HJKMNP-TV-Z]{26})_[A-Za-z0-9_-]{43}$/;
const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });

/**
 * A share's link token. With an idempotency key it's derived from the key (and who asked), so
 * a retried request gives the same link and the space keeps the same hash; without one it's
 * random. Either way only the hash is stored.
 */
async function shareToken(ctx: OpUserCtx, spaceId: string, purpose: string) {
  const secret = ctx.idempotencyKey
    ? await ctx.sealer.derive(`share:${ctx.user.id}:${spaceId}:${purpose}:${ctx.idempotencyKey}`)
    : newToken("x").slice(2);
  return `${PREFIX}_${spaceId}_${secret}`;
}

/**
 * The link people open; the token is in the part after #, so it never reaches server logs.
 * Link-only views and forms open at /s (no sign-in); everything else joins at /join.
 */
const linkFor = (ctx: OpUserCtx, token: string, share: { public: boolean }) =>
  `${ctx.baseUrl}/${share.public ? "s" : "join"}#${token}`;

/** A new share and its link (shown now; only its hash is kept). */
export async function createShare(
  ctx: OpUserCtx,
  i: z.output<typeof CreateShareInput>,
): Promise<CreatedShare> {
  const { space, stub, actor } = await spaceOf(ctx, i.space);
  const token = await shareToken(ctx, space.id, "create");
  const [kind, target] = i.record_id
    ? (["card", i.record_id] as const)
    : i.view
      ? (["view", i.view] as const)
      : (["form", i.form!] as const);
  const made = await stub.createShare(actor, ctx.idempotencyKey, {
    kind,
    target,
    public: i.public,
    include: i.include ?? [],
    access: i.access,
    hide: i.hide_fields ?? [],
    expiresInDays: i.expires_in_days ?? null,
    tokenHash: await hashToken(token),
  });
  return { share: made.share, link: linkFor(ctx, token, made.share) };
}

/** A new link for a share; the old one stops working. */
export async function resetShareLink(ctx: OpUserCtx, spaceRef: string | undefined, shareId: string) {
  const { space, stub, actor } = await spaceOf(ctx, spaceRef);
  const token = await shareToken(ctx, space.id, `reset:${shareId}`);
  const made = await stub.resetShareLink(actor, ctx.idempotencyKey, shareId, await hashToken(token));
  return { share: made.share, link: linkFor(ctx, token, made.share) } satisfies CreatedShare;
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

// --- People I know (chat-first step 4) -----------------------------------------------------
// Everyone in one of my spaces or in something I shared, across my spaces. Sharing straight
// with them needs no link: it shows up under "Shared with you" (and pings their app).

export async function knownPeople(ctx: OpUserCtx): Promise<Person[]> {
  const spaces = await mySpaces(ctx);
  const lists = await Promise.all(
    spaces.map((s) => ctx.objects.SPACES.getByName(spaceName(s.id)).people(actorOf(ctx))),
  );
  const byId = new Map<string, Person>();
  for (const p of lists.flat()) if (!byId.has(p.user_id)) byId.set(p.user_id, p);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Names (or ids) to people I know: the exact name, or the first name when only one person
 * has it. More than one match gives candidates; none lists who I know. Never a guess.
 */
export async function resolvePeople(ctx: OpUserCtx, refs: string[]): Promise<Person[]> {
  const known = await knownPeople(ctx);
  const out = new Map<string, Person>();
  for (const ref of refs) {
    const key = nameKey(ref);
    const byId = known.find((p) => p.user_id === ref);
    const exact = known.filter((p) => nameKey(p.name) === key);
    const first = known.filter((p) => nameKey(p.name.split(/\s+/)[0] ?? "") === key);
    const hit = byId ? [byId] : exact.length ? exact : first;
    if (hit.length > 1)
      throw new ObjectError("ambiguous", `More than one person called "${ref}"`, {
        candidates: hit.map((p) => ({ id: p.user_id, name: p.name })),
      });
    if (!hit.length)
      throw new ObjectError(
        "not_found",
        known.length
          ? `You don't know anyone called "${ref}" here. People you know: ${known
              .slice(0, 20)
              .map((p) => p.name)
              .join(", ")}. Others join with a link from the app.`
          : `You haven't shared anything with "${ref}" yet. Share a link from the app first; after they join, you can share with them by name.`,
      );
    out.set(hit[0]!.user_id, hit[0]!);
  }
  return [...out.values()];
}

async function addPeople(ctx: OpUserCtx, spaceRef: string | undefined, shareId: string, people: Person[]) {
  const { space, stub, actor } = await spaceOf(ctx, spaceRef);
  const share = await stub.addSharePeople(actor, ctx.idempotencyKey, shareId, people);
  await ctx.d1.batch(
    people
      .filter((p) => p.user_id !== ctx.user.id)
      .map((p) =>
        ctx.d1
          .prepare(`insert or ignore into shared_with (user_id, share_id, space_id) values (?, ?, ?)`)
          .bind(p.user_id, share.id, space.id),
      ),
  );
  return share;
}

/** Adds people I know to a share I made. */
export async function addSharePeople(
  ctx: OpUserCtx,
  spaceRef: string | undefined,
  shareId: string,
  refs: string[],
): Promise<ShareView> {
  return addPeople(ctx, spaceRef, shareId, await resolvePeople(ctx, refs));
}

/** Shares a card, view or form straight with people I know (money hidden unless asked). */
export async function shareWith(ctx: OpUserCtx, i: z.output<typeof ShareWithInput>): Promise<ShareView> {
  const people = await resolvePeople(ctx, i.people);
  const { space, stub, actor } = await spaceOf(ctx, i.space);
  // No link is handed out; the share still needs a key nobody holds.
  const token = await shareToken(ctx, space.id, `with:${people.map((p) => p.user_id).join(",")}`);
  const [kind, target] = i.record_id
    ? (["card", i.record_id] as const)
    : i.view
      ? (["view", i.view] as const)
      : (["form", i.form!] as const);
  const made = await stub.createShare(actor, ctx.idempotencyKey && `${ctx.idempotencyKey}:share`, {
    kind,
    target,
    public: false,
    include: i.include ?? [],
    access: i.access,
    hide: i.hide_fields ?? [],
    hideMoney: i.hide_fields === undefined,
    expiresInDays: null,
    tokenHash: await hashToken(token),
  });
  return addPeople(ctx, space.id, made.share.id, people);
}

// --- Questions (chat-first step 4) -----------------------------------------------------------

/** Asks people I know a question; it shows under their "Shared with you" and pings their app. */
export async function askPeople(ctx: OpUserCtx, i: z.output<typeof AskPeopleInput>): Promise<QuestionView> {
  const people = await resolvePeople(ctx, i.people);
  const { space, stub, actor } = await spaceOf(ctx, i.space);
  const token = await shareToken(ctx, space.id, `ask:${i.id ?? ""}`);
  const q = await stub.askPeople(actor, ctx.idempotencyKey, {
    id: i.id ?? null,
    text: i.text,
    choices: i.choices ?? null,
    people,
    tokenHash: await hashToken(token),
  });
  await ctx.d1.batch(
    q.people.map((p) =>
      ctx.d1
        .prepare(`insert or ignore into shared_with (user_id, share_id, space_id) values (?, ?, ?)`)
        .bind(p.user_id, q.share_id, space.id),
    ),
  );
  return q;
}

export async function answerQuestion(ctx: OpUserCtx, shareId: string, answer: string) {
  const { stub } = await shareStub(ctx, shareId);
  return stub.answerQuestion(actorOf(ctx), ctx.idempotencyKey, shareId, answer);
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

/** Whether a collaborator's write touches money (MCP confirms first); false when not shared. */
export async function sharedTouchesMoney(
  ctx: OpUserCtx,
  shareId: string,
  target: { recordId?: string; section?: string },
  keys: string[],
): Promise<boolean> {
  const row = await ctx.d1
    .prepare(`select space_id from shared_with where user_id = ? and share_id = ?`)
    .bind(ctx.user.id, shareId)
    .first<{ space_id: string }>();
  if (!row) return false;
  return ctx.objects.SPACES.getByName(spaceName(row.space_id)).sharedTouchesMoney(
    actorOf(ctx),
    shareId,
    target,
    keys,
  );
}

export async function openShare(ctx: OpUserCtx, shareId: string, cursor?: string) {
  const { stub } = await shareStub(ctx, shareId);
  return stub.openShare(actorOf(ctx), shareId, cursor);
}

// --- Link-only views and forms (no sign-in; the link is the key) -----------------------------

function publicStub(env: Env, token: string) {
  const m = TOKEN_RE.exec(token);
  return m ? env.SPACES.getByName(spaceName(m[1]!)) : null;
}

export async function openPublicShare(env: Env, token: string, cursor?: string) {
  const stub = publicStub(env, token);
  return stub ? stub.openPublicShare(await hashToken(token), cursor) : null;
}

export async function submitPublicForm(
  env: Env,
  token: string,
  key: string,
  input: { id?: string | null; values: Record<string, unknown> },
) {
  const stub = publicStub(env, token);
  return stub ? stub.submitPublicForm(await hashToken(token), key, input) : null;
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

export async function sharedComments(ctx: OpUserCtx, shareId: string, recordId: string) {
  const { stub } = await shareStub(ctx, shareId);
  return stub.sharedComments(actorOf(ctx), shareId, recordId);
}

export async function addSharedComment(
  ctx: OpUserCtx,
  i: { share_id: string; record_id: string; id?: string; body: string },
) {
  const { stub } = await shareStub(ctx, i.share_id);
  return stub.addSharedComment(actorOf(ctx), ctx.idempotencyKey, ctx.user.name, i.share_id, i.record_id, {
    id: i.id ?? null,
    body: i.body,
  });
}

export async function deleteSharedComment(ctx: OpUserCtx, shareId: string, commentId: string) {
  const { stub } = await shareStub(ctx, shareId);
  return stub.deleteSharedComment(actorOf(ctx), ctx.idempotencyKey, shareId, commentId);
}
