// The app lives at gigspree.in (decision 2026-09-29). Browsers that open an old address
// (the *.workers.dev ones, e.g. a Home Screen icon from before) or www go to the domain.
// The old addresses keep answering /api (calendar links, shortcuts); only pages move.
import { hasSavedChanges } from "./outbox-key.ts";

const MOVED: Record<string, string> = {
  "assistant.rishiparyani.workers.dev": "https://gigspree.in",
  "www.gigspree.in": "https://gigspree.in",
  "assistant-dev.rishiparyani.workers.dev": "https://dev.gigspree.in",
};

/** Where this page should be instead (same path), or null if it's on the app's own domain. */
export function domainTarget(
  location: Pick<Location, "hostname" | "pathname" | "search" | "hash">,
): string | null {
  const target = MOVED[location.hostname];
  return target ? target + location.pathname + location.search + location.hash : null;
}

/**
 * Leaving an old address. Its storage stays behind (the domain can't read it), so changes
 * made offline there must reach the server first: with any waiting, the app starts here,
 * syncs as usual, and moves once nothing is left ("now" is false then).
 */
export function moveToDomain(
  location: Location = window.location,
  storage: Storage = window.localStorage,
): { now: boolean } {
  const target = domainTarget(location);
  if (!target) return { now: false };
  if (!hasSavedChanges(storage)) {
    location.replace(target);
    return { now: true };
  }
  const timer = setInterval(() => {
    if (hasSavedChanges(storage)) return;
    clearInterval(timer);
    location.replace(domainTarget(location) ?? target);
  }, 3000);
  return { now: false };
}
