// The app lives at gigspree.in (decision 2026-09-29). Browsers that open an old address
// (the *.workers.dev ones, e.g. a Home Screen icon from before) or www go to the domain.
// The old addresses keep answering /api (calendar links, shortcuts); only pages move.
const MOVED: Record<string, string> = {
  "assistant.rishiparyani.workers.dev": "https://gigspree.in",
  "www.gigspree.in": "https://gigspree.in",
  "assistant-dev.rishiparyani.workers.dev": "https://dev.gigspree.in",
};

/** Sends the browser to the app's own domain if it's on an old address. Returns true if leaving. */
export function moveToDomain(location: Location = window.location): boolean {
  const target = MOVED[location.hostname];
  if (!target) return false;
  location.replace(target + location.pathname + location.search + location.hash);
  return true;
}
