// Offline first (docs/design/offline.md): a change made on a card goes into this outbox, shows
// at once, and is sent in order when there's a connection. Each change keeps one
// Idempotency-Key, so sending it again is safe. A refused change is kept under "failed" with
// the reason. One owner at a time (the signed-in user), kept on the device.
import { AppState, Platform } from "react-native";
import { ApiError, request } from "./api.ts";
import { kv, readJson, writeJson } from "./storage.ts";
import { practiceMode, type PracticeAs } from "./practice-mode.ts";

export interface Change {
  /** Also the Idempotency-Key. */
  id: string;
  kind: string;
  method: string;
  path: string;
  body: unknown;
  label: string;
  at: number;
  /**
   * The rehearsal it was made in (src/practice-mode.ts), or null for your own app: replayed
   * as made, so an edit queued in a practice copy never lands on the real list after Done.
   */
  practice?: PracticeAs | null;
  /** The account it was made in (the account switcher): never sent as anyone else. */
  account?: string | null;
}
export interface FailedChange extends Change {
  reason: string;
}
interface Saved {
  waiting: Change[];
  failed: FailedChange[];
}

const PREFIX = "gigspree:outbox:";
let owner: string | null = null;
let state: Saved = { waiting: [], failed: [] };
let sending: Promise<void> | null = null;
/** Held while the device changes accounts: nothing is sent until the next account's copy opens. */
let held = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());
const save = () => owner && writeJson(PREFIX + owner, state);

export function useOutboxFor(userId: string | null) {
  if (userId === owner) return;
  owner = userId;
  held = false;
  state = (userId && readJson<Saved>(PREFIX + userId)) || { waiting: [], failed: [] };
  notify();
  void flush();
}
export function clearOutbox() {
  if (owner) kv.remove(PREFIX + owner);
  state = { waiting: [], failed: [] };
  notify();
}
export const outboxState = () => state;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Queues a change and tries to send at once. Resolves when it's queued, not when it's synced.
 * Pass `id` when the change was already tried online with that Idempotency-Key, so a request
 * that did reach the server before the connection dropped isn't applied twice.
 */
export function send(c: Omit<Change, "id" | "at"> & { id?: string }): Change {
  const change: Change = {
    practice: practiceMode(),
    account: owner,
    ...c,
    id: c.id ?? newId(),
    at: Date.now(),
  };
  state.waiting.push(change);
  save();
  notify();
  void flush();
  return change;
}

/** Sends waiting changes in order. Stops at the first that can't reach the server. */
export function flush(): Promise<void> {
  if (held) return Promise.resolve();
  if (sending) return sending;
  sending = (async () => {
    while (state.waiting.length) {
      const c = state.waiting[0]!;
      try {
        await request(c.method, c.path, c.body, c.id, {
          practice: c.practice ?? null,
          account: c.account ?? owner,
        });
        state.waiting.shift();
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // offline: try again later
        if (e instanceof ApiError && e.status === 401) break; // signed out: keep until sign-in
        // Another account is signed in: keep it for its own account.
        if (
          e instanceof ApiError &&
          (e.details as { account_changed?: boolean } | undefined)?.account_changed
        )
          break;
        state.waiting.shift();
        state.failed.push({ ...c, reason: e instanceof Error ? e.message : String(e) });
      }
      save();
      notify();
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

/**
 * Before switching accounts: sends what can go as this account, then holds the rest (they
 * stay in this account's copy and go when it is open again), so no change is ever sent as
 * someone else. Says how many are still waiting. `releaseOutbox` undoes it if the switch fails.
 */
export async function holdOutbox(): Promise<number> {
  await flush();
  held = true;
  await sending;
  return state.waiting.length;
}
export function releaseOutbox() {
  held = false;
  void flush();
}

// Waiting changes go out again when the app comes back to the front or the network returns.
AppState.addEventListener("change", (s) => {
  if (s === "active") void flush();
});
if (Platform.OS === "web") {
  if (typeof window !== "undefined") window.addEventListener("online", () => void flush());
} else {
  import("expo-network")
    .then((n) =>
      n.addNetworkStateListener((state) => {
        if (state.isConnected) void flush();
      }),
    )
    .catch(() => undefined);
}

export function dropFailed(id: string) {
  state.failed = state.failed.filter((f) => f.id !== id);
  save();
  notify();
}
