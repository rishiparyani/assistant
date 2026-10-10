// Minimal path-based router for the SPA (the Worker serves index.html for unknown paths).
export interface Route {
  name: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

const PATTERNS: [string, RegExp][] = [
  ["root", /^\/$/],
  // Another chat with the assistant (the first one is the home page).
  ["chat", /^\/chat\/(?<chatId>[^/]+)$/],
  // What the assistant remembers.
  ["memory", /^\/memory$/],
  ["login", /^\/login$/],
  ["consent", /^\/consent$/],
  ["settings", /^\/settings$/],
  ["admin", /^\/admin$/],
  // A card (record) opened full screen, from a pinned view or a link.
  ["record", /^\/c\/(?<collectionId>[^/]+)\/(?<recordId>[^/]+)$/],
  ["help", /^\/help$/],
  // A saved view by name (Siri's "Show a Gigspree view").
  ["open_view", /^\/open-view$/],
  // Cards others shared with me; /join#<token> joins one.
  ["join", /^\/join$/],
  // A view or form shared by link: no sign-in (/s#<token>).
  ["public_share", /^\/s$/],
  ["shared", /^\/shared$/],
  ["shared_card", /^\/shared\/(?<shareId>[^/]+)$/],
  // Old gig links (gig notifications, the calendar feed) until gigs are rebuilt as a setup
  // (chat-first step 8): they open the chat with a note instead of an error.
  ["old_gig", /^\/gigs(\/.*)?$/],
];

function match(location: Location): Route {
  for (const [name, re] of PATTERNS) {
    const m = re.exec(location.pathname);
    if (m) return { name, params: { ...m.groups }, query: new URLSearchParams(location.search) };
  }
  return { name: "not_found", params: {}, query: new URLSearchParams(location.search) };
}

export const router = $state({ route: match(window.location) });

export function navigate(path: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  router.route = match(window.location);
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", () => (router.route = match(window.location)));

/** Intercepts same-origin <a href="/..."> clicks so they don't reload the page. */
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const href = a.getAttribute("href");
  if (!href?.startsWith("/") || href.startsWith("/auth/") || href.startsWith("/api/")) return;
  e.preventDefault();
  navigate(href);
});

/** The path of the current page, for "is this nav item active". */
export function isActive(href: string, exact = false): boolean {
  const path = window.location.pathname;
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}
