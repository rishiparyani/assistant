// Plain Node tests for the web app (the app's own Vite config needs the Cloudflare plugin).
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
