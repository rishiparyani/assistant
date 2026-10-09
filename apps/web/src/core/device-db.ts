// Larger things kept on this device for offline use (docs/design/offline.md), such as the
// song library with its charts: IndexedDB, which holds far more than the localStorage
// cache (query.svelte.ts). Records are grouped by scope ("library:<user id>"); sign-out
// deletes the whole database. Every call fails soft: no storage means nothing saved.

const DB = "assistant-device";
const STORE = "records";

let opening: Promise<IDBDatabase> | null = null;
function open(version?: number): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // A database without our store (made by something else): upgrade it once.
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        opening = null;
        open(db.version + 1).then(resolve, reject);
        return;
      }
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((e: unknown) => {
    opening = null;
    throw e;
  });
  return opening;
}

const range = (scope: string) => IDBKeyRange.bound(`${scope}:`, `${scope}:￿`);
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Couldn't save on this device"));
  });

/** Replaces everything saved under `scope` with these records (all or nothing). */
export async function replaceAll(scope: string, records: { id: string }[]): Promise<void> {
  const tx = (await open()).transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.delete(range(scope));
  for (const r of records) store.put(r, `${scope}:${r.id}`);
  await done(tx);
}

/** Saves or replaces these records under `scope` (others stay). */
export async function putMany<T extends { id: string }>(scope: string, records: T[]): Promise<void> {
  if (!records.length) return;
  const tx = (await open()).transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const r of records) store.put(r, `${scope}:${r.id}`);
  await done(tx);
}

/** Removes these ids under `scope`. */
export async function deleteMany(scope: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const tx = (await open()).transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const id of ids) store.delete(`${scope}:${id}`);
  await done(tx);
}

/** Everything saved under `scope` ([] when nothing is, or the device can't store anything). */
export async function getAll<T>(scope: string): Promise<T[]> {
  try {
    const req = (await open()).transaction(STORE).objectStore(STORE).getAll(range(scope));
    return await new Promise<T[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** One saved record, or undefined (also when the device can't store anything). */
export async function getOne<T>(scope: string, id: string): Promise<T | undefined> {
  try {
    const req = (await open()).transaction(STORE).objectStore(STORE).get(`${scope}:${id}`);
    return await new Promise<T | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/** Sign-out: forget everything saved here. */
export async function clearDeviceDb(): Promise<void> {
  try {
    const db = await opening?.catch(() => null);
    db?.close();
    opening = null;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {
    // No IndexedDB: nothing was saved.
  }
}
