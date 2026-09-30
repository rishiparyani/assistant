# Roadmap

> **Superseded in part (2026-09-28):** workspaces were replaced by the gig-centric design (docs/design/gig-centric.md); read "workspace" below as history.

## Phase 1 (now): core + Gigs

See [phase-1.md](phase-1.md). Gigs, clients, venues, fees, payments, expenses, balances, schedule, reports, workspaces, Siri Shortcuts, MCP server, web app, .ics feed.

## Phase 2: `music` module + offline

**Step 1 done (2026-09-30):** my song library with ChordPro charts, transpose, stage mode (auto-scroll, page turner), setlists from gig lists, library saved for offline reading ([design](design/music.md)). Offline first for gigs was done in September. Still to do from the list below: arrangements, chart revisions, band songbooks, role-specific views.

Song library (ChordPro charts, arrangements, immutable chart revisions), setlists (drag and drop, freeze/pin revisions, link a setlist to a gig through the gigs service), offline PWA with full repertoire in IndexedDB, stage/teleprompter mode, role-specific views, Bluetooth page-turner support.

## Phase 3: stage hub

Local band sync hub (travel router + Raspberry Pi 4, hub-authoritative state over wss://; the leader turns the page and every screen follows by song section). MIDI via the Pi (Boss GT-1000, TONEX One+). Adds `apps/hub/` (Node + ws + MIDI). Stage features never depend on internet.

## Later

Notifications beyond basics, WhatsApp client messages, media integration (Drive), multi-tenant sign-up for other bands.

## Other modules (ideas, not committed)

No decision yet: we'll add modules as real needs show up.

Flexibility means these could be added as modules without touching core. Each needs a decision before work starts.

- **Tasks & reminders:** to-dos with due dates, surfaced in the dashboard, Siri and the .ics feed (e.g. "send invoice to X", "restring guitar").
- **Practice log:** what was practised, how long, linked to songs once `music` exists.
- **Gear:** inventory, serial numbers, insurance values, maintenance/restring history.
- **Contacts:** sound engineers, organisers, other people beyond gig clients and the band roster; could become a core `contacts` table shared with gigs' clients and musicians.
- **Teaching:** students, lessons, fees (reuses the payments pattern).
- **Personal finance beyond gigs:** general income/expenses, tax-year summaries.
- **Notes/knowledge:** free-form notes attached to any entity.

Pick based on what's actually painful after Phase 1 is in daily use.
