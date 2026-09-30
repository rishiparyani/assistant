// Service worker (built by the "service-worker" plugin in vite.config.ts, which fills in
// the build's files). Two jobs:
// 1. Offline (docs/design/offline.md): keeps the app's own files on the device. Pages come
//    from the network when it answers in time, otherwise from the saved copy; files with a
//    hash in their name come from the saved copy. API calls are never touched here.
// 2. Notifications (T11): shows pushes and opens the right page when one is tapped.
const VERSION = "__VERSION__";
const SHELL = /* files */ [];
const CACHE = `shell-${VERSION}`;
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
      for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

const SERVER_PATHS = /^\/(api|auth|mcp|\.well-known)(\/|$)/;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || SERVER_PATHS.test(url.pathname)) return;
  if (req.mode === "navigate") {
    event.respondWith(page(req));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});

/** The page from the network if it answers in time, else the saved app. */
async function page(req) {
  const saved = () => caches.open(CACHE).then((c) => c.match("/index.html"));
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), PAGE_TIMEOUT_MS)),
    ]);
    if (res.ok) return res;
    return (await saved()) || res;
  } catch {
    return (await saved()) || Response.error();
  }
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
