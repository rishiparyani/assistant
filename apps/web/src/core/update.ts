// Home-screen apps (iPhone/Android) resume from memory instead of reloading, so a new
// deploy isn't picked up until the app is killed. When the app comes back to the
// foreground, check whether the server has a newer build and reload if so. Only on
// return to the app (never mid-use), so nothing being typed is lost.
const current = () =>
  document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src;

async function checkForUpdate() {
  const mine = current();
  if (!mine) return; // dev server: no hashed bundle
  try {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    const latest = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
    if (latest && new URL(latest, location.href).href !== mine) location.reload();
  } catch {
    // Offline or server busy: try again next time.
  }
}

let last = Date.now();
export function watchForUpdates() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Not more than once a minute.
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    void checkForUpdate();
  });
}
