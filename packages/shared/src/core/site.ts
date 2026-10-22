// The website is the app (decision 2026-10-22 "The website is the app"): the Expo app's web
// build answers every path of the site, except the pages the old Svelte site still owns, each
// at the address it always had (links people were sent keep working): sign-in and OAuth
// consent, the admin page, join and public links, shared cards, Songbook, workflow diagrams,
// records and group chats. The Worker, the service worker and the old site's router all
// decide with this one list.
const CLASSIC =
  /^\/(login|consent|admin|settings|help|join|s|open-view|shared|songs|workflows|c|g|guests|gigs)(\/|$)|^\/chat\/[^/]+/;

/** Whether a path is still a page of the old site (served from /classic/index.html). */
export const isClassicPath = (pathname: string) => CLASSIC.test(pathname);

/** The same test as plain source, for the service worker (built without imports). */
export const CLASSIC_PATH_SOURCE = CLASSIC.source;
