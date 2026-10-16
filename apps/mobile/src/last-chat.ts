// The chat a person last had open on this device (the owner, 2026-10-16: "I closed the chat
// window and I can't seem to go back and find that chat"). The home's empty-bar button goes
// back to it while it's fresh, whichever space it is in (Help's questions land in Personal even
// when asked from a space's page). Per person: another account on the device never gets it.
import { readJson, writeJson } from "./storage.ts";

/** Back to the same chat within this long; after it, the page's current chat. */
const FRESH_MS = 2 * 60 * 60 * 1000;
const keyFor = (userId: string) => `gigspree:last-chat:${userId}`;

export function rememberChat(userId: string, chatId: string) {
  writeJson(keyFor(userId), { id: chatId, at: Date.now() });
}

export function lastChat(userId: string, now = Date.now()): string | null {
  const saved = readJson<{ id: string; at: number }>(keyFor(userId));
  return saved && now - saved.at < FRESH_MS ? saved.id : null;
}
