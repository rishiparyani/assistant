// Offline first, stage 2 (docs/design/offline.md): every change that can be made offline
// goes through this outbox. It's kept on the device (per user) and sent in order whenever
// there's a connection; each change keeps one Idempotency-Key, so sending it again is safe.
// While waiting, modules show the change on screen ("appliers" lay it over the saved data).
// If the server refuses a change later, it's listed under "Couldn't sync" with the reason.
// Core knows no module: kinds, scopes and appliers come from the modules.
import { ApiError, request } from "./api.ts";
import { connection, saveSoon } from "./offline.svelte.ts";
import { publish, readCache, refreshAll, setOverlay } from "./query.svelte.ts";
import { OUTBOX_PREFIX } from "./outbox-key.ts";

export interface Change {
  /** Also the Idempotency-Key. */
  id: string;
  /** What it is, e.g. "gigs.add_note" (the module's applier shows it on screen). */
  kind: string;
  /** The cached screen data it changes, e.g. "gig:<id>". */
  scope: string;
  method: string;
  path: string;
  body: unknown;
  /** Details the applier needs that aren't in the body (e.g. the item id from the path). */
  args?: Record<string, unknown>;
  /** For people: "Note on Test Gig". */
  label: string;
  at: number;
}
export interface FailedChange extends Change {
  reason: string;
}

export const outbox = $state<{
  waiting: Change[];
  failed: FailedChange[];
  sending: boolean;
  /** Show "waiting to sync" marks: offline, or sending is taking a while (no flicker online). */
  showWaiting: boolean;
}>({ waiting: [], failed: [], sending: false, showWaiting: false });

let slowTimer: ReturnType<typeof setTimeout> | undefined;
function updateShowWaiting() {
  clearTimeout(slowTimer);
  if (!outbox.waiting.length) outbox.showWaiting = false;
  else if (!connection.online) outbox.showWaiting = true;
  else if (!outbox.showWaiting)
    slowTimer = setTimeout(() => (outbox.showWaiting = outbox.waiting.length > 0), 1500);
}

// --- Kept on the device, per user ---------------------------------------------------------
const PREFIX = OUTBOX_PREFIX;
let owner: string | null = null;

function save() {
  updateShowWaiting();
  if (!owner) return;
  try {
    localStorage.setItem(PREFIX + owner, JSON.stringify({ waiting: outbox.waiting, failed: outbox.failed }));
  } catch {
    // Full or blocked: the changes still go out while the app stays open.
  }
}

/** Loads a user's waiting changes (at start and on sign-in). */
export function useOutboxFor(userId: string | null) {
  if (userId === owner) return;
  owner = userId;
  outbox.waiting = [];
  outbox.failed = [];
  if (!userId) return;
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + userId) ?? "{}") as {
      waiting?: Change[];
      failed?: FailedChange[];
    };
    outbox.waiting = saved.waiting ?? [];
    outbox.failed = saved.failed ?? [];
  } catch {
    // Nothing saved.
  }
}

/** Sign-out: forget this device's changes. */
export function clearOutbox() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // Blocked: nothing saved anyway.
  }
  outbox.waiting = [];
  outbox.failed = [];
  owner = null;
}

// --- Showing waiting changes on screen ----------------------------------------------------
/** Shows a change on one screen's data; `key` is that screen's cache key. */
type Applier = (data: unknown, change: Change, key: string) => unknown;
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
const appliers = new Map<string, Applier>();
const OVERLAID = Symbol("overlaid");

/** A module shows its kind of change on the saved data (must not change `data` in place). */
export function applyWith(kind: string, fn: Applier) {
  appliers.set(kind, fn);
}

/**
 * The saved data with this scope's waiting changes laid over it. A change's scope also
 * covers keys under it ("space:<collection>" covers "space:<collection>|list|…"), so one
 * change shows on every screen of its collection; the applier tells the shapes apart.
 */
export function overlay<T>(scope: string, base: T | undefined): T | undefined {
  if (base === undefined) return base;
  let data: unknown = base;
  let changed = false;
  for (const c of outbox.waiting) {
    if (c.scope !== scope && !scope.startsWith(`${c.scope}|`)) continue;
    const fn = appliers.get(c.kind);
    if (!fn) continue;
    try {
      data = fn(data, c, scope);
      changed = true;
    } catch {
      // Can't show this one (e.g. its list is gone): it still syncs.
    }
  }
  if (changed && data && typeof data === "object") Object.defineProperty(data, OVERLAID, { value: true });
  return data as T;
}

/** Data that already has waiting changes laid over it (never save it as the server's copy). */
export const isOverlaid = (data: unknown) =>
  !!data && typeof data === "object" && (data as Record<symbol, unknown>)[OVERLAID] === true;

setOverlay(overlay, isOverlaid);

// --- Sending ------------------------------------------------------------------------------
type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
const waiters = new Map<string, Waiter>();
let flushing: Promise<void> | null = null;

/** The server said no for good (not "try later"). */
const refused = (e: unknown) =>
  e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

/** Sends waiting changes in order until one can't go (offline, server busy) or all went. */
export function flush(): Promise<void> {
  // Cleared after it's been set (the run can finish before this assignment otherwise).
  flushing ??= sendWaiting().finally(() => (flushing = null));
  return flushing;
}

async function sendWaiting() {
  outbox.sending = true;
  let sent = 0;
  try {
    while (outbox.waiting.length && connection.online) {
      const c = outbox.waiting[0]!;
      try {
        const data = await request<unknown>(c.method, c.path, c.body, { key: c.id, quiet: true });
        outbox.waiting = outbox.waiting.slice(1);
        save();
        sent++;
        if (data && typeof data === "object" && readCache(c.scope) !== undefined) publish(c.scope, data);
        waiters.get(c.id)?.resolve(data);
      } catch (e) {
        if (!refused(e)) {
          waiters.get(c.id)?.resolve(undefined); // stays queued; the caller shows it as waiting
          break;
        }
        outbox.waiting = outbox.waiting.slice(1);
        const waiter = waiters.get(c.id);
        // Someone is waiting on screen: they see the reason now. Otherwise keep it listed.
        if (waiter) waiter.reject(e);
        else outbox.failed = [...outbox.failed, { ...c, reason: (e as Error).message }];
        save();
        refreshAll(); // take the refused change off screens
      } finally {
        waiters.delete(c.id);
      }
    }
  } finally {
    outbox.sending = false;
  }
  if (sent) {
    refreshAll();
    saveSoon();
  }
}

/**
 * Makes a change: saved in the outbox first, then sent (in order) if online. Resolves with
 * the server's answer when it arrives in time; otherwise with the saved data plus waiting
 * changes, so the screen shows it at once. Rejects if the server refuses it right away.
 */
export async function send<T>(change: Omit<Change, "at" | "id"> & { id?: string }): Promise<T> {
  const c: Change = { ...change, id: change.id ?? crypto.randomUUID(), at: Date.now() };
  outbox.waiting = [...outbox.waiting, c];
  save();
  const shown = () => overlay(c.scope, readCache<T>(c.scope)) as T;
  if (!connection.online) return shown();
  const answer = new Promise<unknown>((resolve, reject) => waiters.set(c.id, { resolve, reject }));
  void flush();
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 10_000));
  const data = await Promise.race([answer, timeout]);
  return (data ?? shown()) as T;
}

export function dismissFailed(id?: string) {
  outbox.failed = id ? outbox.failed.filter((f) => f.id !== id) : [];
  save();
}

/** Sends whenever there's a chance: back online, back in the app, and every 30 s. */
export function startSync() {
  addEventListener("online", () => void flush());
  addEventListener("offline", updateShowWaiting);
  updateShowWaiting();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  setInterval(() => {
    if (outbox.waiting.length && connection.online) void flush();
  }, 30_000);
  void flush();
}
