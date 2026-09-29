import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cloudflare } from "@cloudflare/vite-plugin";

// One dev server for everything: the Svelte app with hot reload, and the Worker
// (apps/worker) running in workerd behind it. Port 8787 matches the Google
// OAuth redirect URI registered for local development.
// Writes /sw.js from src/sw.js with the build's files, so the app works offline
// (docs/design/offline.md). In dev it serves the same worker with nothing to keep offline.
function serviceWorker(): Plugin {
  const source = () => readFileSync(new URL("./src/sw.js", import.meta.url), "utf8");
  const render = (files: string[], version: string) =>
    source().replace("/* files */ []", JSON.stringify(files)).replace("__VERSION__", version);
  const STATIC = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png"];
  return {
    name: "service-worker",
    applyToEnvironment: (env) => env.name === "client",
    configureServer(server) {
      server.middlewares.use("/sw.js", (_req, res) => {
        res.setHeader("content-type", "text/javascript");
        res.setHeader("cache-control", "no-store");
        res.end(render([], "dev"));
      });
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map"))
        .map((f) => `/${f}`);
      const version = createHash("sha256").update(files.sort().join()).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: render([...files, ...STATIC], version) });
    },
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    serviceWorker(),
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      // Share local state (D1) with wrangler commands run in apps/worker (pnpm db:migrate).
      persistState: { path: "../worker/.wrangler/state" },
    }),
  ],
  server: { port: 8787, strictPort: true },
  preview: { port: 8787, strictPort: true },
});
