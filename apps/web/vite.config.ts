import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cloudflare } from "@cloudflare/vite-plugin";
import { CLASSIC_PATH_SOURCE } from "@assistant/shared";

// One dev server for everything: the Svelte app with hot reload, and the Worker
// (apps/worker) running in workerd behind it. Port 8787 matches the Google
// OAuth redirect URI registered for local development.
//
// The built site (decision 2026-10-22 "The website is the app"): the Expo app's web build
// (apps/mobile/dist, made first by `pnpm build`) is the site's index and files; the Svelte
// app's index moves to /classic/index.html, from where the Worker serves the pages it still
// owns; and /sw.js, from src/sw.js with both builds' files, keeps the site working offline
// (docs/design/offline.md). In dev the Svelte app stays at / and the worker keeps nothing.
function site(): Plugin {
  const source = () => readFileSync(new URL("./src/sw.js", import.meta.url), "utf8");
  const render = (files: string[], version: string) =>
    source()
      .replace("/* files */ []", JSON.stringify(files))
      .replace("__VERSION__", version)
      .replace("__CLASSIC__", CLASSIC_PATH_SOURCE.replace(/\\/g, "\\\\"));
  const STATIC = [
    "/manifest.webmanifest",
    "/icon.svg",
    "/icon-192.png",
    "/apple-touch-icon.png",
    "/logo-light.png",
    "/logo-dark.png",
  ];
  // Public files aren't hashed by the build, so their contents go into the version too
  // (a new icon or logo then reaches devices that have the old one saved).
  const staticHash = () =>
    STATIC.map((f) => readFileSync(new URL(`./public${f}`, import.meta.url)).toString("base64")).join();
  let svelteFiles: string[] = [];
  return {
    name: "site",
    applyToEnvironment: (env) => env.name === "client",
    configureServer(server) {
      server.middlewares.use("/sw.js", (_req, res) => {
        res.setHeader("content-type", "text/javascript");
        res.setHeader("cache-control", "no-store");
        res.end(render([], "dev"));
      });
    },
    generateBundle(_options, bundle) {
      svelteFiles = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map") && f !== "index.html")
        .map((f) => `/${f}`);
    },
    closeBundle() {
      const out = resolve(import.meta.dirname, "dist/client");
      const app = resolve(import.meta.dirname, "../mobile/dist");
      if (!existsSync(resolve(app, "index.html")))
        throw new Error(
          "The app's web build is missing: run `pnpm build` from the repo root (it builds apps/mobile first).",
        );
      // The old site's index, where the Worker looks for it; the app's build becomes the root.
      mkdirSync(resolve(out, "classic"), { recursive: true });
      renameSync(resolve(out, "index.html"), resolve(out, "classic/index.html"));
      cpSync(app, out, { recursive: true });
      // The app's files to keep from the first open: its script, fonts and images (all under
      // _expo and assets, every name hashed).
      const appFiles = ["_expo", "assets"].flatMap((dir) =>
        readdirSync(resolve(app, dir), { recursive: true, withFileTypes: true })
          .filter((f) => f.isFile())
          .map((f) => `/${relative(app, resolve(f.parentPath, f.name)).split(sep).join("/")}`),
      );
      const files = ["/index.html", "/classic/index.html", ...appFiles, ...svelteFiles, ...STATIC];
      // The two pages' contents too: a change to the page alone must reach saved copies.
      const pages = ["index.html", "classic/index.html"]
        .map((f) => readFileSync(resolve(out, f), "utf8"))
        .join();
      const version = createHash("sha256")
        .update([...files].sort().join() + staticHash() + pages)
        .digest("hex")
        .slice(0, 12);
      writeFileSync(resolve(out, "sw.js"), render(files, version));
    },
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    site(),
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      // Share local state (D1) with wrangler commands run in apps/worker (pnpm db:migrate).
      persistState: { path: "../worker/.wrangler/state" },
      // Local dev never calls Workers AI (it would need a Cloudflare login); the assistant
      // uses its scripted test model there (AI_FAKE=1 in .dev.vars).
      remoteBindings: false,
    }),
  ],
  server: { port: 8787, strictPort: true },
  preview: { port: 8787, strictPort: true },
});
