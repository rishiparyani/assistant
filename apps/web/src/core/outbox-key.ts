// Where the outbox keeps each user's waiting changes on the device (core/outbox.svelte.ts).
// A plain file so code that runs before the app (core/domain.ts) and tests can read it.
export const OUTBOX_PREFIX = "assistant:outbox:";

/** Whether this device has changes (for anyone) that haven't reached the server yet. */
export function hasSavedChanges(storage: Pick<Storage, "length" | "key" | "getItem">): boolean {
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith(OUTBOX_PREFIX)) continue;
      const saved = JSON.parse(storage.getItem(k) ?? "{}") as { waiting?: unknown[]; failed?: unknown[] };
      if (saved.waiting?.length || saved.failed?.length) return true;
    }
  } catch {
    // Unreadable storage: nothing we can send from it anyway.
  }
  return false;
}
