# Data model (Phase 1, draft)

Finalised in T02. Member shares are tracked per member (see [decisions.md](decisions.md)).

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
- **musicians:** the band roster. id, workspace_id, name, phone, email, instrument, user_id (nullable: linked when the musician has an account and is a workspace member), notes, timestamps, deleted_at. Includes the user themself. Not every musician needs to sign in (deps, session players).
- **gig_lineup:** who plays a gig and what they're owed. id, workspace_id, gig_id, musician_id, role (e.g. "lead guitar", "dep"), share_paise, timestamps. Unique (gig_id, musician_id). Editable until payouts exist for that row; after that, changes are audited like any write.
- **payouts:** money paid from the band to a musician for a gig. id, workspace_id, gig_id, musician_id, amount_paise (negative for reversals), paid_on, method, reverses_payout_id, note, created_by, created_at. Append-only, same rules as payments.

Derived, never stored:

- Client side: balance = fee − sum(payments); payment status `unpaid` / `partial` / `paid` / `overpaid`.
- Member side: owed to musician = share − sum(payouts) for that gig; payout status `unpaid` / `partial` / `paid` / `overpaid`.
- Band side: gig net = fee − sum(shares) − sum(expenses for the gig). Negative net is allowed but flagged.
- Shares need not add up to the fee (the band may keep a kitty). The API reports `unallocated_paise` = fee − sum(shares).

Shares are always stored as paise. The web app can help split (equal or by percentage); rounding leftovers go to the first lineup row, so the stored shares always add up exactly to what was split.

A personal workspace (playing as a hired musician in someone else's band) usually has no lineup: the gig fee is the user's own income.

Indexes (minimum): `workspace_id` on all; `gigs(workspace_id, start_at)`, `gigs(workspace_id, client_id)`, `gigs(workspace_id, status)`, `payments(workspace_id, gig_id)`, `payments(workspace_id, paid_on)`, `expenses(workspace_id, spent_on)`, `expenses(gig_id)`, `musicians(workspace_id, name)`, `musicians(user_id)`, `gig_lineup(workspace_id, gig_id)`, `gig_lineup(workspace_id, musician_id)`, `payouts(workspace_id, gig_id)`, `payouts(workspace_id, musician_id)`, `clients(workspace_id, name)`, `venues(workspace_id, name)`, `audit_log(workspace_id, created_at)`.

## Visibility of shares

- Owners see all shares and payouts in their band workspace.
- Members see the gig fee status and **their own** share and payouts only. (Default; could become a per-workspace setting later.)
- A user's own earnings across bands are shown by summing their linked `musicians` rows across the workspaces they belong to (reads each workspace through the normal scoped layer; no cross-workspace query shortcuts).

## Open

- **Clients and musicians vs. contacts:** clients and musicians live in the gigs module for now. If a second module needs people (e.g. a contacts or teaching module), consider promoting a core `contacts` table. Decide when that happens (modules rule 7).
