// The signed-in user, loaded once and refreshed after changes.
// The last known user is kept on the device so the app opens instantly; the server
// check runs in the background and signs out if the session has ended.
import type { MeResponse } from "@assistant/shared";
import { api, ApiError } from "./api.ts";
import { clearCache, useCacheFor } from "./query.svelte.ts";

const KEY = "assistant:me";

function saved(): MeResponse | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as MeResponse | null;
  } catch {
    return null;
  }
}

const initial = saved();
useCacheFor(initial?.user.id ?? null);

export const session = $state<{ me: MeResponse | null; loaded: boolean; error: string }>({
  me: initial,
  loaded: initial !== null,
  error: "",
});

function remember(me: MeResponse | null) {
  try {
    if (me) localStorage.setItem(KEY, JSON.stringify(me));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the app just won't open instantly next time.
  }
}

export async function refreshSession() {
  try {
    const me = await api.me();
    useCacheFor(me.user.id);
    session.me = me;
    remember(me);
    session.error = "";
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      forgetSession();
    } else if (!session.me) {
      session.error = err instanceof Error ? err.message : String(err);
    }
    // Otherwise (offline, server busy): keep showing the saved user and data.
  } finally {
    session.loaded = true;
  }
}

/** Sign-out: forget the user and everything cached on this device. */
export function forgetSession() {
  session.me = null;
  remember(null);
  clearCache();
}
