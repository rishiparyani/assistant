// Offline first (docs/design/offline.md). Knows whether we're online, and saves data ahead
// so screens open without a connection: modules register what to save (e.g. upcoming
// gigs); core runs it when online, at most every few minutes. Core imports no module.
import { refreshAll } from "./query.svelte.ts";

export const connection = $state({ online: typeof navigator === "undefined" ? true : navigator.onLine });

type Saver = () => Promise<void>;
const savers: Saver[] = [];
let lastSaved = 0;
let saving: Promise<void> | null = null;
let signedIn = false;
const EVERY_MS = 10 * 60_000;

/** A module's "save for offline" step (runs in the background, errors ignored). */
export function saveAheadWith(fn: Saver) {
  savers.push(fn);
}

/** Saves what's registered, if online and not done recently (`force` skips the wait). */
export function saveForOffline(force = false): Promise<void> {
  if (!signedIn || !connection.online || saving) return saving ?? Promise.resolve();
  if (!force && Date.now() - lastSaved < EVERY_MS) return Promise.resolve();
  lastSaved = Date.now();
  saving = (async () => {
    for (const fn of savers) {
      try {
        await fn();
      } catch {
        // Offline again or server busy: next time.
      }
    }
  })().finally(() => (saving = null));
  return saving;
}

/** Tracks the connection and saves ahead while signed in. Call once at start. */
export function startOffline(isSignedIn: () => boolean) {
  const update = () => {
    const was = connection.online;
    connection.online = navigator.onLine;
    signedIn = isSignedIn();
    if (connection.online && !was) {
      // Back online: catch up on screen, then save ahead again.
      refreshAll();
      void saveForOffline(true);
    }
  };
  addEventListener("online", update);
  addEventListener("offline", update);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    signedIn = isSignedIn();
    void saveForOffline();
  });
  return (nowSignedIn: boolean) => {
    signedIn = nowSignedIn;
    if (nowSignedIn) void saveForOffline(true);
  };
}

/** A request failed because there's no connection (not because the server said no). */
export const isOfflineError = (e: unknown) => e instanceof TypeError || !connection.online;
