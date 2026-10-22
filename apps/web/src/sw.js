// Service worker for the whole site (built by the "site" plugin in vite.config.ts, which fills
// in the build's files). Two jobs:
// 1. Offline (docs/design/offline.md): keeps the site's own files on the device. Pages come
//    from the network when it answers in time, otherwise from the saved copy; files with a
//    hash in their name come from the saved copy. API calls are never touched here.
//    The site's page is the app's (decision 2026-10-22 "The website is the app"); the old
//    site's pages (the same list as packages/shared site.ts) have their own.
// 2. Notifications (T11): shows pushes and opens the right page when one is tapped.
const VERSION = "__VERSION__";
const SHELL = /* files */ [];
const CLASSIC = new RegExp("__CLASSIC__");
const CACHE = `site-${VERSION}`;
const PAGE_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // The old site's worker kept "shell-…" and "app-shell": a device still on it gets the
      // app on its next open, and the pages it has open now are reloaded onto it once.
      const fromOldSite = keys.some((k) => k.startsWith("shell-") || k === "app-shell");
      for (const k of keys) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
      if (fromOldSite)
        for (const w of await self.clients.matchAll({ type: "window" }))
          if ("navigate" in w) await w.navigate(w.url).catch(() => {});
    })(),
  );
});

const SERVER_PATHS = /^\/(api|auth|mcp|\.well-known|app)(\/|$)/;
// Files with a hash in their name: the app's (_expo, assets) and the old site's (assets).
const HASHED = /^\/(_expo|assets)\//;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || SERVER_PATHS.test(url.pathname)) return;
  if (req.mode === "navigate") {
    event.respondWith(page(req, CLASSIC.test(url.pathname) ? "/classic/index.html" : "/index.html"));
  } else if (HASHED.test(url.pathname)) {
    event.respondWith(hashedFile(req));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});

/** The page from the network if it answers in time, else the saved one. */
async function page(req, index) {
  const saved = () => caches.open(CACHE).then((c) => c.match(index));
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), PAGE_TIMEOUT_MS)),
    ]);
    if (res.ok || res.type === "opaqueredirect") return res;
    return (await saved()) || res;
  } catch {
    return (await saved()) || Response.error();
  }
}

/** Hashed names never change, so a saved copy is always right; one seen once is kept. */
async function hashedFile(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Gigspree", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.id,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin)
    .href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
