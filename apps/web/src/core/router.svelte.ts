// Minimal path-based router for the SPA (the Worker serves index.html for unknown paths).
export interface Route {
  name: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

const PATTERNS: [string, RegExp][] = [
  ["root", /^\/$/],
  ["login", /^\/login$/],
  ["consent", /^\/consent$/],
  ["settings", /^\/settings$/],
  ["admin", /^\/admin$/],
  ["my_gigs", /^\/gigs$/],
  ["booking", /^\/gigs\/(?<gigId>[^/]+)$/],
  ["reports", /^\/reports$/],
  ["contacts", /^\/contacts$/],
  // A gig's guest list shared with its venue (no sign-in; the link is the key).
  ["guest_link", /^\/guests\/(?<token>[A-Za-z0-9_-]+)$/],
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
