// What modules call to tell someone something (T11). Best effort: a failure is logged and
// never breaks the change that caused it.
import type { NewNotification } from "./inbox.ts";

export const inboxName = (userId: string) => `inbox:${userId}`;

export async function notify(env: Env, userId: string, n: NewNotification): Promise<void> {
  try {
    await env.INBOX.getByName(inboxName(userId)).notify(n);
  } catch (err) {
    console.error("notify failed", err instanceof Error ? err.message : String(err));
  }
}
