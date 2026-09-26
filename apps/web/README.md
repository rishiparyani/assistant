# apps/web

Vite + Svelte 5 SPA (becomes the offline PWA in Phase 2). Its Vite config also runs and builds the Worker from `apps/worker` via `@cloudflare/vite-plugin`, so `pnpm dev` (repo root) serves both on http://localhost:8787.

```
src/core/            shell, API client, styles; later auth, workspace switcher, settings
src/modules/<name>/  module screens (gigs from T07)
```

No business logic here: the app only calls `/api`.
