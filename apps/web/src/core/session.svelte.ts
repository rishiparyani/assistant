// The signed-in user and their workspaces, loaded once and refreshed after changes.
import type { MeResponse } from "@assistant/shared";
import { api, ApiError } from "./api.ts";

export const session = $state<{ me: MeResponse | null; loaded: boolean }>({ me: null, loaded: false });

export async function refreshSession() {
  try {
    session.me = await api.me();
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
    session.me = null;
  } finally {
    session.loaded = true;
  }
}
