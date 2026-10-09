# Offline first (Firebase-like)

Owner, 2026-09-29: "Let's do what we already can. Like the offline sync … to make it like firebase."

Goal: the app always opens and shows my data at once, with or without a connection; what I change is applied on screen straight away and reaches the server by itself when there's a connection; everyone else's changes arrive live. No extra dependencies; the server stays the source of truth.

## Stage 1: open and read offline

- **App shell.** The service worker (`/sw.js`, built by a small Vite plugin that lists the build's files) keeps the app's own files on the device. Pages load from the network when it answers quickly, otherwise from the saved copy, so a new version still arrives when online. API calls are never cached by the service worker.
- **Saved data.** The existing read cache (`core/query.svelte.ts`, per user, on the device) keeps every screen's last data. It grows from 60 to 200 entries and drops the oldest if the device says it's full.
- **Saved ahead.** When online (after sign-in, on opening the app, on reconnect, at most every 10 minutes), the app saves Home, the gigs list, my gig types, the address book, and the full page of each gig from 2 days ago to 60 days ahead (up to 40 gigs), plus their Together pages' data (it's the same gig). So a gig I never opened still opens offline.
- **Status.** A small bar says when I'm offline ("Offline · showing what's saved"). Screens with nothing saved say so instead of showing an error.
- Sign-in state is already kept on the device, so the app opens offline.

## Stage 2: change offline

- **Every write goes through an outbox** kept on the device (per user), in order. Each entry has the request, its Idempotency-Key (made once, when I act) and a label ("Added note on Test Gig"). A sender sends entries one at a time, in order, whenever online (on reconnect, on opening the app, after each change). The key makes resending safe: the server applies each change once.
- **Applied on screen at once.** For the changes people make at a gig (notes, list items and ticks, moves, guests and arrivals, recording payments, payouts and expenses), the app updates its saved copy of the gig straight away and marks the change as waiting. When the server answers, its copy replaces mine. Other changes (editing gig details, lineup, people, status, making a gig) wait for a connection and say so, because they depend on the gig's current version and on rules only the server knows.
- **When the server says no.** A change the server refuses (not allowed, list closed, limit reached, gig changed by someone else) is taken off my screen and listed under "Couldn't sync" with the reason, to try again or discard. Nothing is dropped silently.
- **Money** stays exact: payments are only ever added (never overwritten), so an offline payment can't clash; a double tap can't record twice (same key).
- **Live updates** keep working: after reconnecting, the outbox is sent first, then screens refresh.

## Adding a new write (for agents)

Rule 17 in `AGENTS.md`. For every new thing the web app can change:

1. **Would someone do this at a gig with bad signal?** (Adding, ticking, noting, recording.) Then send it through the outbox: call `gigChange(gigId, kind, method, path, body, label, args)` in `gigs-api.ts`, make ids for new things with `newId()` (the server must accept a client `id`, see `clientId` in shared), and add an applier with `on(kind, …)` in `offline-changes.ts` that returns a new gig view with the change and `pending: true`. Test it offline in a real build (`pnpm build` + `pnpm --filter @assistant/web preview`).
2. **Otherwise** (depends on the gig's version, permissions, secrets, or rules only the server knows), call `request()` and put `// online-only: <reason>` above it. The screen shows the normal error when offline.
3. **New screens that read** data needed at a gig: add them to the save-ahead (`modules/gigs/offline.ts`).

Records in spaces (`core/spaces/spaces-api.ts`) work the same way: `addRecord` / `updateRecord` / `deleteRecord` send through the outbox with scope `space:<collection>`, which also covers every screen key under it (`space:<collection>|list|…`, `space:<collection>|record|<id>`); the appliers tell lists and records apart.

`apps/web/test/offline-rule.test.ts` (runs in `pnpm test`) fails when a write is neither sent through the outbox nor marked, when module code calls `fetch()` directly or core calls it without an `online-only` mark, or when an outbox kind has no applier (money entries excepted: the Money tab lists them as waiting).

## Out of scope for now

On-device AI and transcription (owner: later). Background sync while the app is closed (iPhones don't allow it for web apps). Making gigs offline (the server picks the gig's id; later).
