// Rehearsing as a person (docs/design/from-scratch.md §2 point 9, FS3): the whole app as one of
// a practice copy's people. While this is set, every call carries the `x-practice-as` header
// (src/api.ts), so the server answers from the copy, as that person: Today, lists, records,
// cards, what's waiting; nothing of the owner's shows and nothing reaches anyone. Kept on the
// device so a relaunch comes back to the same person; sign-out clears it with everything else.
import { useSyncExternalStore } from "react";
import { readJson, writeJson, kv } from "./storage.ts";

export interface PracticeAs {
  /** The practice copy. */
  space: string;
  /** The space it copies. */
  of: string;
  /** The person played (the one practising themself, a member, someone shared with, a stand-in). */
  as: string;
  name: string;
  /** The one practising (so "yourself" is known while playing someone else). */
  self: string;
}

const KEY = "gigspree:practice-as";
let mode: PracticeAs | null = readJson<PracticeAs>(KEY);
const listeners = new Set<() => void>();
const set = (next: PracticeAs | null) => {
  mode = next;
  if (next) writeJson(KEY, next);
  else kv.remove(KEY);
  listeners.forEach((l) => l());
};

export const practiceMode = () => mode;
export function usePracticeMode(): PracticeAs | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
    () => mode,
  );
}
export const enterPractice = (next: PracticeAs) => set(next);
export const leavePractice = () => set(null);
/** Reads again after the device opened another account's copy (each has its own rehearsal). */
export const reloadPracticeMode = () => {
  mode = readJson<PracticeAs>(KEY);
  listeners.forEach((l) => l());
};

/** The header's value for a call made while rehearsing. */
export const practiceHeader = (m: PracticeAs | null = mode) => (m ? `${m.space} ${m.as}` : null);
