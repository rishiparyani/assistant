// Updates (decision 2026-10-30 "Updates"): what happened that someone wanted me to know (a
// workflow told me, a question about something I added was answered), newest first, from my
// inbox on the server. While rehearsing as someone, the server answers with what the practice
// copy would have told them. The last copy is kept on the device (one per person played), so
// it opens offline; the bell hears every change to the unread count.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { NotificationsView } from "@assistant/shared";
import { request } from "./api.ts";
import { practiceMode } from "./practice-mode.ts";
import { readJson, writeJson } from "./storage.ts";

const empty: NotificationsView = { items: [], unread: 0 };
/** Whose updates: my own, or the person played in a rehearsal (each kept apart). */
const keyNow = () => {
  const p = practiceMode();
  return p ? `gigspree:updates:${p.space}:${p.as}` : "gigspree:updates";
};

const listeners = new Set<() => void>();
const keep = (key: string, view: NotificationsView) => {
  writeJson(key, view);
  if (key === keyNow()) listeners.forEach((l) => l());
};

export const savedUpdates = (): NotificationsView => readJson<NotificationsView>(keyNow()) ?? empty;

export async function loadUpdates(): Promise<NotificationsView> {
  // Kept under the person it was asked for, even if a rehearsal switches meanwhile.
  const key = keyNow();
  const got = await request<NotificationsView>("GET", "/api/me/notifications?limit=50");
  keep(key, got);
  return got;
}

// online-only: read marks live on the server (offline the dot just stays until next time).
export async function markUpdatesRead(): Promise<void> {
  const key = keyNow();
  await request("POST", "/api/me/notifications/read", {});
  const kept = readJson<NotificationsView>(key) ?? empty;
  const at = new Date().toISOString();
  keep(key, { items: kept.items.map((i) => ({ ...i, read_at: i.read_at ?? at })), unread: 0 });
}

/** How many unread updates (the bell's dot): the saved count at once, the server's after. */
export function useUnreadUpdates(): { unread: number; reload: () => void } {
  const unread = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => savedUpdates().unread,
    () => savedUpdates().unread,
  );
  const reload = useCallback(() => {
    loadUpdates().catch(() => undefined);
  }, []);
  useEffect(() => reload(), [reload]);
  return { unread, reload };
}
