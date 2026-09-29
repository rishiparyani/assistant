// Stale-while-revalidate cache for reads (decision 2026-09-28, "smooth app").
// A screen shows its last known data at once (kept on the device, per signed-in user),
// then refreshes from the server in the background. Pull to refresh and, later, live
// updates call `refreshAll()`. Writes that return fresh data put it straight in.
import { untrack } from "svelte";

type Entry = { data: unknown; at: number };

// Enough for Home, lists and ~40 gigs saved ahead for offline use (docs/design/offline.md).
const MAX_ENTRIES = 200;
const prefix = "assistant:cache:";
let owner: string | null = null;
let entries: Record<string, Entry> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Starts the cache for a user (loads what's saved on this device). */
export function useCacheFor(userId: string | null) {
  if (userId === owner) return;
  owner = userId;
  entries = {};
  if (!userId) return;
  try {
    entries = JSON.parse(localStorage.getItem(prefix + userId) ?? "{}") as Record<string, Entry>;
  } catch {
    entries = {};
  }
}

/** Forgets everything saved on this device (sign-out). */
export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
  } catch {
    // Storage blocked: nothing saved anyway.
  }
  entries = {};
  owner = null;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!owner) return;
    // Keep the most recent entries only, so storage stays small.
    let keep = Object.entries(entries)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    // If the device says it's full, keep the newer half and try again (a few times).
    for (let tries = 0; tries < 4 && keep.length; tries++) {
      try {
        localStorage.setItem(prefix + owner, JSON.stringify(Object.fromEntries(keep)));
        break;
      } catch {
        keep = keep.slice(0, Math.floor(keep.length / 2));
      }
    }
    entries = Object.fromEntries(keep);
  }, 300);
}

export function readCache<T>(key: string): T | undefined {
  return entries[key]?.data as T | undefined;
}

export function writeCache(key: string, data: unknown) {
  entries[key] = { data, at: Date.now() };
  save();
}

/** Drops cached entries whose key starts with `start` (e.g. after a change elsewhere). */
export function dropCache(start: string) {
  for (const k of Object.keys(entries)) if (k.startsWith(start)) delete entries[k];
  save();
}

// --- Offline changes (core/outbox.svelte.ts) --------------------------------------------
// Screens show the saved data with waiting changes laid over it. The outbox registers how
// (it imports this file, so it hands its functions over instead of this file importing it).
type Overlay = <T>(key: string, data: T | undefined) => T | undefined;
let overlayFn: Overlay = (_k, d) => d;
let isOverlaidFn: (data: unknown) => boolean = () => false;
export function setOverlay(fn: Overlay, isOverlaid: (data: unknown) => boolean) {
  overlayFn = fn;
  isOverlaidFn = isOverlaid;
}

// Open screens by key, so fresh data (e.g. a synced change's answer) reaches them at once.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
const open = new Map<string, Set<(data: unknown) => void>>();

/** New server data for a key: saved, and shown on any open screen using it. */
export function publish(key: string, data: unknown) {
  writeCache(key, data);
  for (const fn of open.get(key) ?? []) fn(data);
}

// --- Refresh signals (pull to refresh, coming back to the app, live updates) -----------

// Not reactive on purpose: nothing renders from this set.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const listeners = new Set<() => void>();
export function refreshAll() {
  for (const fn of listeners) fn();
}

export interface Query<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  /** True while fetching (with or without data already on screen). */
  readonly loading: boolean;
  refresh: () => Promise<void>;
  /** Puts fresh data on screen and in the cache (e.g. the result of a write). */
  set: (data: T) => void;
}

/**
 * A cached read. Call during component setup. `key` must change whenever the request
 * changes (it's read reactively); `fetcher` does the request for the current key.
 */
export function createQuery<T>(key: () => string, fetcher: () => Promise<T>): Query<T> {
  const state = $state<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: null,
    loading: false,
  });
  let seq = 0;
  let currentKey = $state("");

  async function run() {
    const k = currentKey;
    const mine = ++seq;
    state.loading = true;
    try {
      const data = await fetcher();
      if (mine !== seq) return;
      state.data = data;
      state.error = null;
      writeCache(k, data);
    } catch (e) {
      if (mine === seq) state.error = e;
    } finally {
      if (mine === seq) state.loading = false;
    }
  }

  $effect(() => {
    currentKey = key();
    const cached = readCache<T>(currentKey);
    state.data = cached;
    state.error = null;
    untrack(() => void run());
  });

  $effect(() => {
    listeners.add(run);
    return () => listeners.delete(run);
  });

  $effect(() => {
    const k = currentKey;
    const show = (data: unknown) => (state.data = data as T);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
    if (!open.has(k)) open.set(k, new Set());
    open.get(k)!.add(show);
    return () => open.get(k)?.delete(show);
  });

  return {
    get data() {
      return overlayFn(currentKey, state.data);
    },
    get error() {
      return state.error;
    },
    get loading() {
      return state.loading;
    },
    refresh: run,
    set(data: T) {
      // Saved data with waiting changes laid over it is already on screen; keep the
      // server's copy as it is.
      if (isOverlaidFn(data)) return;
      state.data = data;
      writeCache(currentKey, data);
    },
  };
}
