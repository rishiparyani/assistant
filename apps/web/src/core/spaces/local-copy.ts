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

const base = () => `space:${session.me?.user.id ?? ""}`;
const RECORDS = () => `${base()}:records`;
const COLLECTIONS = () => `${base()}:collections`;
const VIEWS = () => `${base()}:views`;
const META = () => `${base()}:meta`;

let syncing: Promise<void> | null = null;

/** Pulls everything that changed since the last pull (all of it the first time). */
export function syncSpace(): Promise<void> {
  syncing ??= pull().finally(() => (syncing = null));
  return syncing;
}

async function pull() {
  if (!session.me) return;
  let since = (await getOne<{ id: string; seq: number }>(META(), "seq"))?.seq ?? 0;
  for (let page = 0; page < 200; page++) {
    const c = await request<ChangesView>(
      "GET",
      `/api/space-changes?since=${since}&limit=500&data=1`,
      undefined,
      {
        quiet: true,
      },
    );
    const gone = (kind: string) =>
      c.changes.filter((x) => x.kind === kind && x.op === "delete").map((x) => x.id);
    await deleteMany(RECORDS(), gone("record"));
    await deleteMany(VIEWS(), gone("view"));
    await deleteMany(COLLECTIONS(), gone("collection"));
    await putMany(RECORDS(), c.records ?? []);
    await putMany(COLLECTIONS(), c.collections ?? []);
    await putMany(VIEWS(), c.views ?? []);
    since = c.seq;
    await putMany(META(), [{ id: "seq", seq: since }]);
    if (!c.more) break;
  }
}

export const localCollections = () => getAll<CollectionView>(COLLECTIONS());
export const localViews = () => getAll<SavedView>(VIEWS());
export const localRecord = (id: string) => getOne<RecordView>(RECORDS(), id);

/** A find on the offline copy (undefined when this collection isn't on the device yet). */
export async function findLocal(collectionId: string, q: FindQuery = {}): Promise<FindResult | undefined> {
  const c = (await localCollections()).find((x) => x.id === collectionId || x.name === collectionId);
  if (!c) return undefined;
  const records = (await getAll<RecordView>(RECORDS())).filter((r) => r.collection_id === c.id);
  const items = findInRecords(
    c,
    records,
    { ...q, limit: q.limit ?? 100 },
    { userId: session.me?.user.id ?? null },
  );
  return { items, next_cursor: null };
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
