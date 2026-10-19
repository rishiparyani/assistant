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
  WorkflowDetail,
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
  | { kind: "plain"; title: string; subtitle: string | null }
  /** A workflow in words; it opens on its own screen (to rehearse it, turn it on, see runs). */
  | { kind: "workflow"; id: string; name: string; enabled: boolean; words: string[]; space: string | null };

export async function loadLive(
  ref: LiveRef,
  collections: (fresh?: boolean) => Promise<CollectionView[]>,
  /** The space of the chat it's in (null: the person's own): its lists live there. */
  space: string | null = null,
): Promise<LiveData> {
  const inSpace = space ? `?space=${enc(space)}` : "";
  const spaceBody = space ? { space } : {};
  // A list made in this chat after the copy of the lists was taken (a setup just confirmed)
  // said "That list is gone": look once more before saying so.
  const listOf = async (id: string) =>
    (await collections()).find((c) => c.id === id) ?? (await collections(true)).find((c) => c.id === id);
  switch (ref.kind) {
    case "record": {
      const record = await request<RecordView>("GET", `/api/records/${enc(ref.record_id)}${inSpace}`);
      const collection = await listOf(record.collection_id);
      if (!collection) throw new Error("That list is gone");
      return { kind: "record", record, collection };
    }
    case "list": {
      const [result, collection] = await Promise.all([
        request<FindResult>("POST", `/api/collections/${enc(ref.collection_id)}/find`, {
          ...spaceBody,
          ...ref.query,
          limit: ROWS,
        }),
        listOf(ref.collection_id),
      ]);
      if (!collection) throw new Error("That list is gone");
      return withWholeTotal(
        inThe(cardFor(collection, result.items, null, ref.title), space),
        { ...spaceBody, ...ref.query },
        !!result.next_cursor,
      );
    }
    case "view": {
      const opened = await request<OpenedView>("GET", `/api/views/${enc(ref.view_id)}${inSpace}`);
      const v = opened.view;
      // A card that answers a question: the space works it out.
      if (v.card?.question) {
        const answer = await request<QueryResult>("POST", "/api/query", {
          ...spaceBody,
          from: v.collection_id,
          where: v.filters,
          ...v.card.question,
          title: v.name,
        });
        return { kind: "card", card: inThe(answerCard(opened.collection, answer, v), space), more: false };
      }
      return withWholeTotal(
        inThe(cardFor(opened.collection, opened.result.items, v), space),
        { ...spaceBody, filters: v.filters, sort: v.sort ?? undefined, search: v.search ?? undefined },
        !!opened.result.next_cursor,
      );
    }
    case "query": {
      const answer = await request<QueryResult>("POST", "/api/query", {
        ...(ref.space_id ? { space: ref.space_id } : spaceBody),
        ...ref.query,
        title: ref.title,
      });
      const collection = await listOf(answer.collection_id);
      if (!collection) throw new Error("That list is gone");
      return { kind: "answer", card: answerCard(collection, answer, null, ref.title), ref };
    }
    case "question":
      return {
        kind: "plain",
        title: "A question to people",
        subtitle: "Answers show on the website for now.",
      };
    case "workflow": {
      const d = await request<WorkflowDetail>("GET", `/api/workflows/${enc(ref.workflow_id)}${inSpace}`);
      const w = d.workflow;
      return { kind: "workflow", id: w.id, name: w.name, enabled: w.enabled, words: w.words, space };
    }
    case "app":
      return { kind: "plain", title: ref.title, subtitle: ref.subtitle ?? null };
    // Drawn by its own player (UiCard), never loaded here.
    case "ui":
      return { kind: "plain", title: ref.title, subtitle: null };
  }
}

/** A card from a space's list: its ticks and changes go back to that space. */
const inThe = (card: HomeCard, space: string | null): HomeCard => (space ? { ...card, space } : card);

/** A number card adds up every matching record, not just the first page. */
async function withWholeTotal(card: HomeCard, query: object, more: boolean): Promise<LiveData> {
  if (card.spec.arrangement !== "number" || !more || !card.collection) return { kind: "card", card, more };
  const all = await findAll(card.collection.id, query, null);
  return {
    kind: "card",
    card: inThe(cardFor(card.collection, all, card.view, card.spec.title), card.space ?? null),
    more: false,
  };
}
