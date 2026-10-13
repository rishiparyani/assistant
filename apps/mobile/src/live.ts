// Live cards in the chat (home-first.md §7 step 3): a record, a list or a saved view the
// assistant worked with, loaded fresh so a change made anywhere shows here. The same card
// drawing as the home; ticks go through the outbox.
import type {
  CollectionView,
  FindResult,
  LiveRef,
  OpenedView,
  QueryResult,
  RecordView,
} from "@assistant/shared";
import { request } from "./api.ts";
import { answerCard, cardFor, findAll, type HomeCard } from "./home.ts";

const enc = encodeURIComponent;
const ROWS = 8;

export type LiveData =
  | { kind: "record"; record: RecordView; collection: CollectionView }
  | { kind: "card"; card: HomeCard; more: boolean }
  /** An answer worked out by the space; it can be pinned to the home. */
  | { kind: "answer"; card: HomeCard; ref: Extract<LiveRef, { kind: "query" }> }
  | { kind: "plain"; title: string; subtitle: string | null };

export async function loadLive(
  ref: LiveRef,
  collections: () => Promise<CollectionView[]>,
): Promise<LiveData> {
  switch (ref.kind) {
    case "record": {
      const [record, cols] = await Promise.all([
        request<RecordView>("GET", `/api/records/${enc(ref.record_id)}`),
        collections(),
      ]);
      const collection = cols.find((c) => c.id === record.collection_id);
      if (!collection) throw new Error("That list is gone");
      return { kind: "record", record, collection };
    }
    case "list": {
      const [result, cols] = await Promise.all([
        request<FindResult>("POST", `/api/collections/${enc(ref.collection_id)}/find`, {
          ...ref.query,
          limit: ROWS,
        }),
        collections(),
      ]);
      const collection = cols.find((c) => c.id === ref.collection_id);
      if (!collection) throw new Error("That list is gone");
      return withWholeTotal(
        cardFor(collection, result.items, null, ref.title),
        ref.query,
        !!result.next_cursor,
      );
    }
    case "view": {
      const opened = await request<OpenedView>("GET", `/api/views/${enc(ref.view_id)}`);
      const v = opened.view;
      // A card that answers a question: the space works it out.
      if (v.card?.question) {
        const answer = await request<QueryResult>("POST", "/api/query", {
          from: v.collection_id,
          where: v.filters,
          ...v.card.question,
          title: v.name,
        });
        return { kind: "card", card: answerCard(opened.collection, answer, v), more: false };
      }
      return withWholeTotal(
        cardFor(opened.collection, opened.result.items, v),
        { filters: v.filters, sort: v.sort ?? undefined, search: v.search ?? undefined },
        !!opened.result.next_cursor,
      );
    }
    case "query": {
      const [answer, cols] = await Promise.all([
        request<QueryResult>("POST", "/api/query", {
          ...(ref.space_id ? { space: ref.space_id } : {}),
          ...ref.query,
          title: ref.title,
        }),
        collections(),
      ]);
      const collection = cols.find((c) => c.id === answer.collection_id);
      if (!collection) throw new Error("That list is gone");
      return { kind: "answer", card: answerCard(collection, answer, null, ref.title), ref };
    }
    case "question":
      return {
        kind: "plain",
        title: "A question to people",
        subtitle: "Answers show on the website for now.",
      };
    case "workflow":
      return { kind: "plain", title: "A workflow", subtitle: "Its diagram shows on the website for now." };
    case "app":
      return { kind: "plain", title: ref.title, subtitle: ref.subtitle ?? null };
  }
}

/** A number card adds up every matching record, not just the first page. */
async function withWholeTotal(card: HomeCard, query: object, more: boolean): Promise<LiveData> {
  if (card.spec.arrangement !== "number" || !more || !card.collection) return { kind: "card", card, more };
  const all = await findAll(card.collection.id, query, null);
  return { kind: "card", card: cardFor(card.collection, all, card.view, card.spec.title), more: false };
}
