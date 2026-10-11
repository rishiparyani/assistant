// Group chats (chat-first step 7): made from people I know; the index of who is in which group
// lives in D1 (for "my groups"), the members and messages in each group's own object. The
// assistant answers in a group only when someone with assistant access writes @assistant: it
// runs as that person (their data, their allowance), in a chat of theirs for the group, and
// its reply is posted to the group.
import { mentionsAssistant, type GroupMember, type GroupSummary, type GroupView } from "@assistant/shared";
import { AppError } from "../errors.ts";
import type { AnyOperation, OpUserCtx } from "../operations.ts";
import { resolvePeople } from "../spaces/shares.ts";
import { assistantAllowed } from "../assistant/access.ts";
import { newChat, sendMessage } from "../assistant/service.ts";

const groupOf = (ctx: OpUserCtx, id: string) => ctx.objects.GROUPS.getByName(`group:${id}`);
const actorOf = (ctx: OpUserCtx) => ({ userId: ctx.user.id, source: ctx.source });
const me = (ctx: OpUserCtx): GroupMember => ({ user_id: ctx.user.id, name: ctx.user.name, role: "owner" });

async function index(ctx: OpUserCtx, groupId: string, userIds: string[]) {
  if (!userIds.length) return;
  await ctx.d1.batch(
    userIds.map((u) =>
      ctx.d1
        .prepare(`insert or ignore into group_members (group_id, user_id) values (?, ?)`)
        .bind(groupId, u),
    ),
  );
}

export async function createGroup(
  ctx: OpUserCtx,
  input: { id: string; name: string; people: string[] },
): Promise<GroupView> {
  const people = input.people.length ? await resolvePeople(ctx, input.people) : [];
  const id = input.id;
  const members = people.map((p): GroupMember => ({ user_id: p.user_id, name: p.name, role: "member" }));
  await groupOf(ctx, id).init(actorOf(ctx), { id, name: input.name, owner: me(ctx), members });
  await index(ctx, id, [ctx.user.id, ...members.map((m) => m.user_id)]);
  return groupView(ctx, id);
}

export async function myGroups(ctx: OpUserCtx): Promise<GroupSummary[]> {
  const rows = await ctx.d1
    .prepare(`select group_id from group_members where user_id = ? limit 100`)
    .bind(ctx.user.id)
    .all<{ group_id: string }>();
  const out = await Promise.all(
    rows.results.map(async (r) => {
      try {
        return (await groupOf(ctx, r.group_id).summary(ctx.user.id)) as GroupSummary;
      } catch {
        return null; // left the group since
      }
    }),
  );
  return out
    .filter((g): g is GroupSummary => g !== null)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function groupView(ctx: OpUserCtx, id: string): Promise<GroupView> {
  const v = await groupOf(ctx, id).view(ctx.user.id);
  return { ...v, can_ask: await assistantAllowed(ctx) };
}

export async function addGroupPeople(ctx: OpUserCtx, id: string, refs: string[]): Promise<GroupView> {
  const people = await resolvePeople(ctx, refs);
  await groupOf(ctx, id).addPeople(
    actorOf(ctx),
    ctx.idempotencyKey,
    people.map((p) => ({ user_id: p.user_id, name: p.name, role: "member" })),
  );
  await index(
    ctx,
    id,
    people.map((p) => p.user_id),
  );
  return groupView(ctx, id);
}

export async function leaveGroup(ctx: OpUserCtx, id: string): Promise<{ left: string }> {
  const out = await groupOf(ctx, id).leave(actorOf(ctx), ctx.idempotencyKey);
  await ctx.d1
    .prepare(`delete from group_members where group_id = ? and user_id = ?`)
    .bind(id, ctx.user.id)
    .run();
  return out;
}

export async function postGroupMessage(
  ctx: OpUserCtx,
  ops: readonly AnyOperation[],
  id: string,
  text: string,
): Promise<GroupView> {
  const g = groupOf(ctx, id);
  const asks = mentionsAssistant(text);
  if (asks && !(await assistantAllowed(ctx)))
    throw new AppError(
      "forbidden",
      "The assistant isn't on for you, so it can't answer you here. Your message wasn't sent; send it without @assistant.",
    );
  const key = ctx.idempotencyKey ?? `group-post:${crypto.randomUUID()}`;
  await g.post(actorOf(ctx), key, { kind: "person", text });
  if (asks) {
    // The asker's own chat for this group (made once), so cards and history stay theirs. The
    // assistant sees only the asker's own words: other members' messages and the group's name
    // never reach a model that can read and change the asker's data.
    await newChat({ ...ctx, idempotencyKey: null }, id);
    let reply = "I couldn't answer that just now.";
    try {
      const answer = await sendMessage({ ...ctx, idempotencyKey: `${key}:ask` }, ops, { text }, id);
      // Only what came after this request (it was answered, so its message is the last one).
      let from = answer.items.length;
      answer.items.forEach((item, n) => {
        if (item.role === "user") from = n + 1;
      });
      const mine = answer.items.slice(from);
      const said = mine.filter((i) => i.role === "assistant" && i.text).map((i) => i.text);
      const extra = mine.some((i) => i.role === "card" || i.role === "live")
        ? " (Details are in your chat with the assistant.)"
        : "";
      if (said.length || extra) reply = (said.join("\n\n") || "Done.") + extra;
    } catch (e) {
      console.warn("group assistant failed", e);
    }
    await g.post(actorOf(ctx), `${key}:answer`, { kind: "assistant", text: reply });
  }
  return groupView(ctx, id);
}
