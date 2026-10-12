// Search (home-first.md §4): what the person can see, by words (and by meaning later), from
// their own index; every hit re-checked by the space that owns it before it's shown.
import { z } from "zod";
import { defineOperation } from "../operations.ts";
import type { Actor } from "../objects/storage.ts";
import type { OpUserCtx } from "../operations.ts";
import { mySpaces, spaceName } from "../spaces/service.ts";
import type { SearchHit } from "./search-object.ts";
import { embed } from "./embed.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const indexOf = (ctx: OpUserCtx) => ctx.objects.SEARCH.getByName(`search:${ctx.user.id}`);

export interface SearchResult {
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

export const SearchInput = z.object({
  q: z.string().trim().min(1).max(200).describe("Words to look for (part of a word is fine)"),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export const searchOperations = [
  defineOperation({
    id: "core.search",
    tool: "search",
    description:
      "Search everything I can see (records in my spaces) by words; part of a word matches. Returns the best hits with a snippet.",
    kind: "read",
    http: { method: "GET", path: "/search" },
    input: SearchInput,
    handler: async (ctx, i): Promise<SearchResult[]> => {
      // Words always; meaning when the model answers (a few hundred ms, online only).
      const [vector] = (await embed({ ai: ctx.ai.binding, fake: ctx.ai.settings.fake }, [i.q])) ?? [];
      const hits = await indexOf(ctx).query(i.q, i.limit * 2, vector);
      if (!hits.length) return [];
      // Re-check every hit with its space (deleted, or no longer mine, drops out), by space.
      const spaces = await mySpaces(ctx);
      const bySpace = new Map<string, SearchHit[]>();
      for (const h of hits) bySpace.set(h.space_id, [...(bySpace.get(h.space_id) ?? []), h]);
      const out: SearchResult[] = [];
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
      return out
        .sort((a, b) => (order.get(a.record_id) ?? 0) - (order.get(b.record_id) ?? 0))
        .slice(0, i.limit);
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
      let indexed = 0;
      for (const s of await mySpaces(ctx))
        indexed += await ctx.objects.SPACES.getByName(spaceName(s.id)).rebuildSearch(actorOf(ctx));
      return { indexed };
    },
  }),
];
