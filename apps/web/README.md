# apps/web

Vite + Svelte SPA (becomes the offline PWA in Phase 2). Served by the Worker.

```
src/core/            shell, auth, workspace switcher, settings, API client
src/modules/gigs/    dashboard widgets, gigs, clients, forms, reports
```

Navigation is built from the workspace's enabled modules. No business logic here. Set up in T01/T07.
