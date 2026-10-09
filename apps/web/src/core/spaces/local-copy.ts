// The offline copy of my space (docs/design/universal.md §12 "Offline and sync"): every
// collection, record and saved view, kept on this device in IndexedDB and brought up to
// date from the space's numbered change log. When there's no connection, screens read it
// and run the same find language on it (`findInRecords`, shared with the server's rules).
import {
  findInRecords,
  type ChangesView,
  type CollectionView,
  type FindResult,
  type RecordView,
  type SavedView,
} from "@assistant/shared";
import { request } from "../api.ts";
import { deleteMany, getAll, getOne, putMany } from "../device-db.ts";
import { isOfflineError } from "../offline.svelte.ts";
import { session } from "../session.svelte.ts";
import type { FindQuery } from "./spaces-api.ts";

// Stores belong to one person; a pull keeps the scope it started with, even if the person
// signs out or switches while it waits on the network.
const stores = (uid: string) => {
  const base = `space:${uid}`;
  return {
    records: `${base}:records`,
    collections: `${base}:collections`,
    views: `${base}:views`,
    meta: `${base}:meta`,
  };
};
const mine = () => stores(session.me?.user.id ?? "");

let syncing: Promise<void> | null = null;

/** Pulls everything that changed since the last pull (all of it the first time). */
export function syncSpace(): Promise<void> {
  syncing ??= pull().finally(() => (syncing = null));
  return syncing;
}

async function pull() {
  const uid = session.me?.user.id;
  if (!uid) return;
  const s = stores(uid);
  let since = (await getOne<{ id: string; seq: number }>(s.meta, "seq"))?.seq ?? 0;
  for (let page = 0; page < 200; page++) {
    const c = await request<ChangesView>(
      "GET",
      `/api/space-changes?since=${since}&limit=500&data=1`,
      undefined,
      { quiet: true },
    );
    if (session.me?.user.id !== uid) return; // signed out or switched: don't mix copies
    const gone = (kind: string) =>
      c.changes.filter((x) => x.kind === kind && x.op === "delete").map((x) => x.id);
    await deleteMany(s.records, gone("record"));
    await deleteMany(s.views, gone("view"));
    await deleteMany(s.collections, gone("collection"));
    await putMany(s.records, c.records ?? []);
    await putMany(s.collections, c.collections ?? []);
    await putMany(s.views, c.views ?? []);
    since = c.seq;
    await putMany(s.meta, [{ id: "seq", seq: since }]);
    if (!c.more) break;
  }
}

export const localCollections = () => getAll<CollectionView>(mine().collections);
export const localViews = () => getAll<SavedView>(mine().views);
export const localRecord = (id: string) => getOne<RecordView>(mine().records, id);

// Pages of an offline find: "local:<offset>". A server cursor can't be followed offline.
const LOCAL_CURSOR = /^local:(\d+)$/;

/** A find on the offline copy (undefined when this collection isn't on the device yet). */
export async function findLocal(collectionId: string, q: FindQuery = {}): Promise<FindResult | undefined> {
  const at = q.cursor ? LOCAL_CURSOR.exec(q.cursor) : null;
  if (q.cursor && !at) return undefined;
  const offset = at ? Number(at[1]) : 0;
  const c = (await localCollections()).find((x) => x.id === collectionId || x.name === collectionId);
  if (!c) return undefined;
  const records = (await getAll<RecordView>(mine().records)).filter((r) => r.collection_id === c.id);
  const all = findInRecords(
    c,
    records,
    { ...q, limit: records.length },
    { userId: session.me?.user.id ?? null },
  );
  const limit = q.limit ?? 100;
  const items = all.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, next_cursor: end < all.length ? `local:${end}` : null };
}

/** The server's answer, or the offline copy's when there's no connection. */
export async function orLocal<T>(online: () => Promise<T>, local: () => Promise<T | undefined>): Promise<T> {
  try {
    return await online();
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    const found = await local();
    if (found === undefined) throw e;
    return found;
  }
}
