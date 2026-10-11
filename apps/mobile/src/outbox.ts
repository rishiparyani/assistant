// Offline first (docs/design/offline.md): a change made on a card goes into this outbox, shows
// at once, and is sent in order when there's a connection. Each change keeps one
// Idempotency-Key, so sending it again is safe. A refused change is kept under "failed" with
// the reason. One owner at a time (the signed-in user), kept on the device.
import { AppState, Platform } from "react-native";
import { ApiError, request } from "./api.ts";
import { kv, readJson, writeJson } from "./storage.ts";

export interface Change {
  /** Also the Idempotency-Key. */
  id: string;
  kind: string;
  method: string;
  path: string;
  body: unknown;
  label: string;
  at: number;
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
let sending = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());
const save = () => owner && writeJson(PREFIX + owner, state);

export function useOutboxFor(userId: string | null) {
  if (userId === owner) return;
  owner = userId;
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

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Queues a change and tries to send at once. Resolves when it's queued, not when it's synced. */
export function send(c: Omit<Change, "id" | "at">): Change {
  const change: Change = { ...c, id: newId(), at: Date.now() };
  state.waiting.push(change);
  save();
  notify();
  void flush();
  return change;
}

/** Sends waiting changes in order. Stops at the first that can't reach the server. */
export async function flush(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    while (state.waiting.length) {
      const c = state.waiting[0]!;
      try {
        await request(c.method, c.path, c.body, c.id);
        state.waiting.shift();
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // offline: try again later
        if (e instanceof ApiError && e.status === 401) break; // signed out: keep until sign-in
        state.waiting.shift();
        state.failed.push({ ...c, reason: e instanceof Error ? e.message : String(e) });
      }
      save();
      notify();
    }
  } finally {
    sending = false;
  }
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
