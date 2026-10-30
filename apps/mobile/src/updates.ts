// Updates (decision 2026-10-30 "Updates"): what happened that someone wanted me to know (a
// workflow told me, a question about something I added was answered), newest first, from my
// inbox on the server. While rehearsing as someone, the server answers with what the practice
// copy would have told them. The last copy is kept on the device, so it opens offline.
import { useCallback, useEffect, useState } from "react";
import type { NotificationsView } from "@assistant/shared";
import { request } from "./api.ts";
import { readJson, writeJson } from "./storage.ts";

const KEY = "gigspree:updates";
const empty: NotificationsView = { items: [], unread: 0 };

export const savedUpdates = (): NotificationsView => readJson<NotificationsView>(KEY) ?? empty;

export async function loadUpdates(): Promise<NotificationsView> {
  const got = await request<NotificationsView>("GET", "/api/me/notifications?limit=50");
  writeJson(KEY, got);
  return got;
}

// online-only: read marks live on the server (offline the dot just stays until next time).
export async function markUpdatesRead(): Promise<void> {
  await request("POST", "/api/me/notifications/read", {});
  const kept = savedUpdates();
  const at = new Date().toISOString();
  writeJson(KEY, { items: kept.items.map((i) => ({ ...i, read_at: i.read_at ?? at })), unread: 0 });
}

/** How many unread updates (the bell's dot): the saved count at once, the server's after. */
export function useUnreadUpdates(): { unread: number; reload: () => void } {
  const [unread, setUnread] = useState(() => savedUpdates().unread);
  const reload = useCallback(() => {
    loadUpdates()
      .then((u) => setUnread(u.unread))
      .catch(() => undefined);
  }, []);
  useEffect(() => reload(), [reload]);
  return { unread, reload };
}
