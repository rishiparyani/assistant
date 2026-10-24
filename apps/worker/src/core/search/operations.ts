// Search (home-first.md §4): what the person can see, by words (and by meaning later), from
// their own index; every hit re-checked by the space that owns it before it's shown.
import { z } from "zod";
import { defineOperation } from "../operations.ts";
import { AppError } from "../errors.ts";
import type { Actor } from "../objects/storage.ts";
import type { OpUserCtx } from "../operations.ts";
import { mySpaces, spaceName } from "../spaces/service.ts";
import { sharedWithMe } from "../spaces/shares.ts";
import type { SearchHit } from "./search-object.ts";
import { embed } from "./embed.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const indexOf = (ctx: OpUserCtx) => ctx.objects.SEARCH.getByName(`search:${ctx.user.id}`);

export type SearchResult = RecordResult | MessageResult | ConversationResult | ItemResult;

/**
 * Something I'm in, found by its name rather than in the index (owner, 2026-10-17: "everything
 * that I'm involved in"): a space, a list, a saved view, a workflow, something shared with me,
 * or something the assistant remembers for me.
 */
export interface ItemResult {
  kind: "item";
  what: "space" | "list" | "view" | "workflow" | "shared" | "memory";
  id: string;
  title: string;
  /** Where it is, in a few words ("in Society gate", "from Asha"). */
  detail: string;
  space_id?: string;
  collection_id?: string;
}

/** Something said in one of my conversations with the assistant (only ever in my own index). */
export interface ConversationResult {
  kind: "conversation";
  chat_id: string;
  /** The conversation's title as my chat list shows it. */
  chat: string;
  message_id: string;
  snippet: string;
  updated_at: string;
}

/** A piece of a chat I'm in (decision 2026-10-13 "Saving chat messages, and searching chats"). */
export interface MessageResult {
  kind: "message";
  group_id: string;
  /** The chat's name as I see it (a group's name, or the other person). */
  chat: string;
  /** The first message of the matching piece of conversation. */
  message_id: string;
  snippet: string;
  updated_at: string;
}

export interface RecordResult {
  kind: "record";
  space_id: string;
  space: string;
  collection_id: string;
  collection: string;
  record_id: string;
  title: string;
  snippet: string;
  updated_at: string;
}

/** Spaces, lists, views, workflows, shares and memories whose names (or words) contain q. */
async function namedItems(
  ctx: OpUserCtx,
  q: string,
  spaces: Awaited<ReturnType<typeof mySpaces>>,
): Promise<ItemResult[]> {
  const needle = q.trim().toLowerCase();
  // One letter would match nearly everything (the index asks for two as well).
  if (needle.length < 2) return [];
  const has = (text: string) => text.toLowerCase().includes(needle);
  const out: ItemResult[] = [];
  // A practice copy is a copy: its things would show twice.
  const real = spaces.filter((sp) => !sp.practice_of);
  for (const sp of real)
    if (sp.kind !== "personal" && has(sp.name))
      out.push({ kind: "item", what: "space", id: sp.id, title: sp.name, detail: "space", space_id: sp.id });
  const named = await Promise.all(
    real.map((sp) =>
      ctx.objects.SPACES.getByName(spaceName(sp.id))
        .searchNames(actorOf(ctx), q)
        .then((list) => list.map((n) => ({ ...n, sp })))
        .catch(() => []),
    ),
  );
  const word = { list: "list", view: "saved view", workflow: "workflow" } as const;
  for (const n of named.flat())
    out.push({
      kind: "item",
      what: n.what,
      id: n.id,
      title: n.name,
      detail: n.sp.kind === "personal" ? word[n.what] : `${word[n.what]} in ${n.sp.name}`,
      space_id: n.sp.id,
      collection_id: n.collection_id,
    });
  for (const sh of await sharedWithMe(ctx).catch(() => []))
    if (has(sh.title))
      out.push({
        kind: "item",
        what: "shared",
        id: sh.share_id,
        title: sh.title,
        detail: `shared by ${sh.owner}`,
      });
  // What the assistant remembers for me (only people with the assistant have any).
  const memories = await ctx.objects.CHATS.getByName(`chat:${ctx.user.id}`)
    .memories(ctx.user.id, null, true)
    .catch(() => []);
  for (const m of memories)
    if (has(m.text))
      out.push({ kind: "item", what: "memory", id: m.id, title: m.text, detail: "remembered for you" });
  return out;
}

export const SearchInput = z.object({
  q: z.string().trim().min(1).max(200).describe("Words to look for (part of a word is fine)"),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export const searchOperations = [
  defineOperation({
    id: "core.search",
    tool: "search",
    description:
      "Search everything I'm in (records and their comments in my spaces, the names of my spaces, lists, saved views and workflows, things shared with me, what you remember for me, messages in my chats, and my conversations with you) by words and meaning; part of a word matches. Returns the best hits with a snippet.",
    kind: "read",
    http: { method: "GET", path: "/search" },
    input: SearchInput,
    handler: async (ctx, i): Promise<SearchResult[]> => {
      if (ctx.practice) return [];
      // Words always; meaning when the model answers (a few hundred ms, online only).
      const [vector] = (await embed({ ai: ctx.ai.binding, fake: ctx.ai.settings.fake }, [i.q])) ?? [];
      const [hits, spaces] = await Promise.all([indexOf(ctx).query(i.q, i.limit * 2, vector), mySpaces(ctx)]);
      const items = await namedItems(ctx, i.q, spaces);
      if (!hits.length) return items.slice(0, i.limit);
      // Re-check every hit with its space (deleted, or no longer mine, drops out), by space.
      const bySpace = new Map<string, SearchHit[]>();
      const byGroup = new Map<string, SearchHit[]>();
      const said: SearchHit[] = [];
      for (const h of hits) {
        if (h.space_id.startsWith("assistant:")) {
          said.push(h);
          continue;
        }
        const into = h.space_id.startsWith("group:") ? byGroup : bySpace;
        const key = h.space_id.startsWith("group:") ? h.space_id.slice("group:".length) : h.space_id;
        into.set(key, [...(into.get(key) ?? []), h]);
      }
      const out: SearchResult[] = [];
      // My conversations with the assistant: only ones still in my list, by their titles now.
      if (said.length) {
        const main = ctx.objects.CHATS.getByName(`chat:${ctx.user.id}`);
        const titles = new Map((await main.chats(ctx.user.id)).map((c) => [c.id, c.title]));
        // One hit per conversation: its best-matching message (hits come best first).
        const seen = new Set<string>();
        for (const h of said) {
          const chatId = h.space_id.slice("assistant:".length);
          if (seen.has(chatId)) continue;
          seen.add(chatId);
          const title = chatId === "main" ? "Your main chat" : titles.get(chatId);
          if (!title) continue;
          out.push({
            kind: "conversation",
            chat_id: chatId,
            chat: title,
            message_id: h.record_id,
            snippet: h.snippet || h.title,
            updated_at: h.updated_at,
          });
        }
      }
      // Chat hits: only from chats I'm still in (the chat itself says), named as I see them.
      await Promise.all(
        [...byGroup].map(async ([groupId, list]) => {
          const chat = await ctx.objects.GROUPS.getByName(`group:${groupId}`)
            .summary(ctx.user.id)
            .catch(() => null);
          if (!chat) return;
          for (const h of list)
            out.push({
              kind: "message",
              group_id: groupId,
              chat: chat.name,
              message_id: h.record_id,
              snippet: h.snippet || h.title,
              updated_at: h.updated_at,
            });
        }),
      );
      await Promise.all(
        [...bySpace].map(async ([spaceId, list]) => {
          const space = spaces.find((s) => s.id === spaceId);
          if (!space) return;
          const live = await ctx.objects.SPACES.getByName(spaceName(spaceId)).peekRecords(
            actorOf(ctx),
            list.map((h) => h.record_id),
          );
          for (const h of list) {
            const r = live.find((x) => x.id === h.record_id);
            if (!r) continue;
            out.push({
              kind: "record",
              space_id: spaceId,
              space: space.name,
              collection_id: h.collection_id,
              collection: r.collection,
              record_id: h.record_id,
              title: r.title,
              snippet: h.snippet,
              updated_at: h.updated_at,
            });
          }
        }),
      );
      const order = new Map(hits.map((h, i) => [h.record_id, i]));
      const idOf = (r: SearchResult) =>
        r.kind === "record" ? r.record_id : r.kind === "item" ? r.id : r.message_id;
      // Things found by name first (asked for by name, they're what's meant), then the index's.
      return [...items, ...out.sort((a, b) => (order.get(idOf(a)) ?? 0) - (order.get(idOf(b)) ?? 0))].slice(
        0,
        i.limit,
      );
    },
  }),
  defineOperation({
    id: "core.search_rebuild",
    tool: "rebuild_search",
    description: "Fill my search index again from my spaces (when something seems missing).",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/search/rebuild" },
    input: z.object({}),
    handler: async (ctx): Promise<{ indexed: number }> => {
      // The person's index keeps the result under the request's key: a retry replays it.
      const index = ctx.objects.SEARCH.getByName(`search:${ctx.user.id}`);
      const key = ctx.idempotencyKey;
      if (key) {
        const seen = await index.rebuildClaim(key);
        if (seen === "running") throw new AppError("conflict", "That rebuild is still running");
        if (seen) return seen;
      }
      try {
        let indexed = 0;
        for (const s of await mySpaces(ctx))
          indexed += await ctx.objects.SPACES.getByName(spaceName(s.id)).rebuildSearch(actorOf(ctx));
        // My chats too.
        const groups = await ctx.d1
          .prepare(`select group_id from group_members where user_id = ? limit 100`)
          .bind(ctx.user.id)
          .all<{ group_id: string }>();
        for (const g of groups.results)
          indexed += await ctx.objects.GROUPS.getByName(`group:${g.group_id}`)
            .rebuildSearch(ctx.user.id)
            .catch(() => 0);
        // My conversations with the assistant: they send their words again in the background.
        const main = ctx.objects.CHATS.getByName(`chat:${ctx.user.id}`);
        await main.reindex();
        for (const c of await main.chats(ctx.user.id))
          await ctx.objects.CHATS.getByName(`chat:${ctx.user.id}:${c.id}`)
            .reindex()
            .catch(() => {});
        if (key) await index.rebuildDone(key, { indexed });
        return { indexed };
      } catch (e) {
        // A failed rebuild frees the key so the same request can try again.
        if (key) await index.rebuildDone(key, null);
        throw e;
      }
    },
  }),
];
