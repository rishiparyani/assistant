# Data model

Gig-centric (docs/design/gig-centric.md §5, decided 2026-09-28). Workspaces were retired in R1 step 7.

## Durable Objects (one small SQLite database each)

- **Booking** (`booking:<gig id>`): the gig (title, status, client snapshot, fee, collective tag, settings, version), `gig_tags`, `events`, `people` (manager/player, account or name/email), `lineup` (per event: part, share), `payments` (append-only; kind `payment` or `refund`; corrections reverse), `payouts` (append-only), `expenses` (soft delete), plus `_audit`, `_idempotency`, `_outbox`, `_meta`, `_targets`. Balances, owed amounts and statuses are derived, never stored.
- **Person** (`person:<user id>`): `my_events` and `my_gigs` (summaries of the gigs I'm on: my part, share, paid; the gig's money only for managers), `my_gig_tags`, `my_gig_people` (for duplicate warnings), `applied` (sequence per gig), `create_keys` (retried creates reach the same gig). Also holds the person's live-update WebSockets.
- **Month index** (`index:<YYYY-MM>`): one card per event (date, venue, client, managers, status) for duplicate warnings; `created` registry used by the rebuild tool.
- **Pending** (`pending:<shard>`): gigs whose outbox couldn't be handed to the queue yet.

Each object migrates its own schema when it wakes (`_schema` table).

## D1 (shared, written rarely)

- Better Auth: `user`, `session`, `account`, `verification`, `passkey`, `jwks`, OAuth tables for MCP.
- `tags`: the tag registry (one per kind and normalised name).
- `pending_people`: email → gig and person, for people added before they had an account.
- `admins`, `admin_audit`: the admin panel.

## Conventions

ULIDs, integer paise (`amount_paise` + display string), UTC ISO timestamps (dates without time are India calendar days), indexes on filtered columns.
