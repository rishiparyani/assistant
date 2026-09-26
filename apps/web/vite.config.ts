import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cloudflare } from "@cloudflare/vite-plugin";

// One dev server for everything: the Svelte app with hot reload, and the Worker
// (apps/worker) running in workerd behind it. Port 8787 matches the Google
// OAuth redirect URI registered for local development.
export default defineConfig({
  plugins: [
    svelte(),
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      // Share local state (D1) with wrangler commands run in apps/worker (pnpm db:migrate).
      persistState: { path: "../worker/.wrangler/state" },
    }),
  ],
  server: { port: 8787, strictPort: true },
  preview: { port: 8787, strictPort: true },
});
