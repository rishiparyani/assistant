# Data model (Phase 1, draft)

Finalised in T02, after the open decision on member shares (see [decisions.md](decisions.md)).

Conventions for every table: `id` ULID text primary key; `workspace_id` on tenant rows; `created_at`/`updated_at` UTC ISO strings; money as integer `*_paise`; `deleted_at` for soft-deletable entities; an index on every filtered column.

## Core

- **Better Auth tables:** users, sessions, accounts, verification; organizations/members/invitations if the organization plugin is used as workspaces (verify in T00).
- **workspaces:** Better Auth organization + `kind` (`personal` | `band`; more kinds can be added). One personal workspace per user.
- **memberships:** user ↔ workspace with role (`owner`, `member`).
- **workspace_modules:** workspace_id, module_id, enabled, settings_json, timestamps. Which modules a workspace uses.
- **api_tokens:** id, user_id, workspace_id (nullable = all of the user's workspaces), name, token_hash, scopes (JSON, e.g. `["gigs:read","gigs:write"]`), last_used_at, revoked_at, created_at. For Siri: scoped (read + add gig + record payment, no delete/cancel), revocable.
- **idempotency_keys:** key, user_id, request_hash, response_json, created_at (24 h retention).
- **confirm_tokens:** id, user_id, workspace_id, operation_id, input_hash, preview_json, expires_at, used_at.
- **audit_log:** id, workspace_id, actor_user_id, source (`web`/`siri`/`mcp`/`system`), module, action, entity_type, entity_id, before_json, after_json, created_at.

## Module: gigs

- **clients:** id, workspace_id, name, phone, email, organisation, notes, timestamps, deleted_at.
- **venues:** id, workspace_id, name, city, address, notes, timestamps, deleted_at.
- **gigs:** id, workspace_id, client_id, venue_id, title, event_type, start_at, end_at (UTC ISO; displayed in Asia/Kolkata), status (`enquiry` → `confirmed` → `completed` | `cancelled`), fee_paise, notes, created_by, timestamps, deleted_at.
- **payments:** id, workspace_id, gig_id, amount_paise (negative for reversals), paid_on, method (`cash`/`upi`/`bank`/`cheque`/`other`), reverses_payment_id, note, created_by, created_at. Never updated or deleted.
- **expenses:** id, workspace_id, gig_id (nullable), category, amount_paise, spent_on, note, created_by, created_at.

Derived, never stored: balance = fee − sum(payments); payment status `unpaid` / `partial` / `paid` / `overpaid`.

Indexes (minimum): `workspace_id` on all; `gigs(workspace_id, start_at)`, `gigs(workspace_id, client_id)`, `gigs(workspace_id, status)`, `payments(workspace_id, gig_id)`, `payments(workspace_id, paid_on)`, `expenses(workspace_id, spent_on)`, `expenses(gig_id)`, `clients(workspace_id, name)`, `venues(workspace_id, name)`, `audit_log(workspace_id, created_at)`.

## Open

- **Member shares:** track each band member's share and payout in Phase 1, or only the band's total fee? Ask the user before T02.
- **Clients vs. contacts:** clients live in the gigs module for now. If a second module needs people (e.g. band members, contacts), consider promoting a core `contacts` table. Decide when that happens (modules rule 7).
