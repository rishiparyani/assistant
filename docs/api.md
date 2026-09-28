# API

REST under `/api`, same operations exposed as MCP tools at `/mcp`. Both are generated from operation definitions ([modules.md](modules.md)).

## Conventions

- JSON in and out. ISO 8601 dates; timestamps stored UTC, display strings in Asia/Kolkata.
- Workspace in the path: `/api/w/:workspaceId/...` for workspace data; `/api/me/...` for the user.
- Cursor pagination: `?cursor=&limit=`, response `{ items, next_cursor }`.
- Errors: `{ "error": { "code": "not_found", "message": "…", "details": {…}? } }`. Ambiguous matches return code `ambiguous` with `details.candidates`.
- Money: `amount_paise` plus `amount_display` ("₹10,000").
- LLM-friendly: include names and display strings next to IDs.
- Writes require `Idempotency-Key` (400 without it). Repeating a request with the same key replays the stored response (header `Idempotent-Replayed: true`); the same key with a different request is a 409 (`idempotency_key_reused`). Two-step writes from MCP: `preview` returns `{ preview, confirm_token, expires_at }`; commit with the token.
- Auth: session cookie (web), bearer API token (Siri, scripts), OAuth access token (MCP).

## Core operations

- Me/workspaces (operations since T04; deletes return JSON, e.g. `{ removed: true }`):
  - `GET /api/me`: user + workspaces (`list_workspaces`)
  - `POST /api/workspaces {name}`: `create_band_workspace`
  - `GET /api/w/:id`: `get_workspace` (members; pending invitations for owners; enabled modules)
  - `POST /api/w/:id/invitations {email, role?}`: `invite_member` (owner; returns a shareable link)
  - `DELETE /api/w/:id/invitations/:invitationId`: `cancel_invitation` (owner)
  - `DELETE /api/w/:id/members/:memberId`: `remove_member` (owner; not the last owner)
  - `GET /api/invitations/:id`, `POST /api/invitations/:id/accept`: for the invited email only
- Modules: `list_modules`, `set_module_enabled`
- API tokens: `create_api_token`, `list_api_tokens`, `revoke_api_token`
- Calendar: private tokenised `.ics` feed URL per user (modules contribute events)

## Gig-centric gigs (R1, steps 2–3; docs/design/gig-centric.md)

User-scoped routes under `/api` (access comes from each gig's own people and roles; people not on a gig get 404). Writes need an `Idempotency-Key`, which is stored **inside the gig's object**, not in D1; a retried create returns the same gig (the key maps to the gig id in the creator's person object).

| Operation (tool)                                           | Route                                                                         | Who                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `create_gig`                                               | `POST /gigs`                                                                  | anyone signed in; becomes manager       |
| `find_my_gigs`                                             | `GET /me/gigs?from=&to=&order=&limit=&cursor=`                                | me (from my summaries; may lag seconds) |
| `get_gig`                                                  | `GET /gigs/:gig_id`                                                           | people on the gig                       |
| `update_gig`                                               | `PATCH /gigs/:gig_id` (with `version`)                                        | managers                                |
| `set_gig_status`                                           | `POST /gigs/:gig_id/status` (`confirm`/`complete`/`cancel`)                   | managers                                |
| `delete_gig`                                               | `DELETE /gigs/:gig_id`                                                        | managers (soft delete)                  |
| `get_gig_history`                                          | `GET /gigs/:gig_id/history`                                                   | managers                                |
| `add_gig_event`, `update_gig_event`, `remove_gig_event`    | `POST /gigs/:gig_id/events`, `PATCH`/`DELETE /gigs/:gig_id/events/:event_id`  | managers (a gig keeps ≥ 1 event)        |
| `add_gig_person`, `update_gig_person`, `remove_gig_person` | `POST /gigs/:gig_id/people`, `PATCH`/`DELETE /gigs/:gig_id/people/:person_id` | managers (a gig keeps ≥ 1 manager)      |

| `record_gig_payment`, `reverse_gig_payment` | `POST /gigs/:gig_id/payments`, `POST /gigs/:gig_id/payments/:payment_id/reverse` | managers |
| `record_gig_expense`, `remove_gig_expense` | `POST /gigs/:gig_id/expenses`, `DELETE /gigs/:gig_id/expenses/:expense_id` | managers |
| `set_event_lineup` | `PUT /gigs/:gig_id/events/:event_id/lineup` (with `version`) | managers |
| `record_gig_payout`, `reverse_gig_payout` | `POST /gigs/:gig_id/payouts`, `POST /gigs/:gig_id/payouts/:payout_id/reverse` | managers |

| `get_home` | `GET /me/overview` | me |
| `get_my_report` | `GET /me/report?from=&to=&status=&role=&client=` | me |

**Home and reports (step 4)** read only my own summaries, so they add up only my money: my share, paid and owed on every gig; fee, received, expenses, shares, payouts and net only for gigs I manage. Home: next 8 events, this month's gigs with my earned/received, played gigs still owing me, and (managers) played gigs with money still due from the client or still to pay out. Reports: dates are India calendar days (inclusive), cancelled gigs left out unless `status=cancelled`, totals overall, by month and by gig. `find_my_gigs` also takes `q` (title, event, client, venue) and `status`. The old workspace Home stays at `/me/home` until step 7.

**Money (step 3).** `create_gig` and `update_gig` take `fee` (rupees) or `fee_paise`, and `settings` (`players_see_lineup` default on, `players_see_fee` and `players_see_shares` default off). Every gig response carries `settings` and `money`: fee side (`fee`, `received`, `balance`, `payment_status`, `payments`; null for players unless `players_see_fee`), `mine` (the caller's share, paid, owed, always), `payees` (everyone's; null for players unless `players_see_shares`) and managers-only `expenses`, `expenses_total`, `shares_total`, `unallocated`, `net`. Each event has a `lineup` (players who may not see the lineup get only their own entry, and `people` shows only them and the managers). Lineup shares: per person (`share`/`share_paise`), `split: "equal"` of `split_total`, or `percent` of `split_total`. People on lineups and payouts are picked by `person_id` or exact `person_name` (case-insensitive; near matches return `ambiguous` with candidates). Payments and payouts are append-only; reversing adds a negative entry (`409` `already_reversed` / `is_reversal`). Money writes don't change the gig's `version`. Removing someone who has been paid returns `409` `has_payouts`. Assistants must confirm every money write. `find_my_gigs` rows include my `part` and `share` per event.

People are added by `user_id`, by `email` (matched to an account case-insensitively; otherwise kept as a name) or by `name`. Edits to details and events send the gig's `version`; a changed gig returns `409` with `details.reason = "version_mismatch"` and `current_version`. Other conflict reasons: `invalid_transition`, `last_event`, `last_manager`, `already_on_gig`, `idempotency_key_reused`. The old workspace gig tools are renamed `legacy_*` until they're retired (design step 7).

## Admin panel (owner-only; docs/design/gig-centric.md §10b)

Plain routes, not operations (never MCP tools or Siri actions). Admins are the emails in the `ADMIN_EMAILS` secret (owners; can't be removed from the panel) plus those added in the panel (D1 `admins`). Everyone else gets 404. Counts only; no one's gigs, names or money.

| Route                                                              | What                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `GET /api/admin/me`                                                | `{ is_admin }` (any signed-in user; the app shows the link only to admins)                           |
| `GET /api/admin/overview`                                          | sections of counts (people from D1; each module adds its own via `admin.sections`) and the tool list |
| `GET`, `POST /api/admin/admins`, `DELETE /api/admin/admins/:email` | list, add, remove admins                                                                             |
| `POST /api/admin/tools/:module.tool`                               | run a module tool (gigs: `flush`, `rebuild` with `from`/`to` months)                                 |
| `GET /api/admin/log`                                               | last 50 admin actions (D1 `admin_audit`)                                                             |

## Gigs module operations (Phase 1)

Implemented in T04 (all under `/api/w/:workspaceId`):

| Operation                                              | Route                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `create_client`, `find_clients`                        | `POST`, `GET /clients` (`?q=&cursor=&limit=`)                                            |
| `get_client_history`, `update_client`, `delete_client` | `GET`, `PATCH`, `DELETE /clients/:client_id`                                             |
| `create_venue`, `find_venues`                          | `POST`, `GET /venues`                                                                    |
| `update_venue`, `delete_venue`                         | `PATCH`, `DELETE /venues/:venue_id`                                                      |
| `create_gig`, `find_gigs`                              | `POST`, `GET /gigs` (`?from=&to=&status=&client_id=&venue_id=&q=&order=&cursor=&limit=`) |
| `get_gig`, `update_gig`, `delete_gig`                  | `GET`, `PATCH`, `DELETE /gigs/:gig_id`                                                   |
| `confirm_gig`, `complete_gig`, `cancel_gig`            | `POST /gigs/:gig_id/confirm \| complete \| cancel`                                       |

Inputs: times are ISO 8601 with an offset or local India time (`2026-12-12T19:00`); money as `fee_paise` (integer) or `fee` (rupee string/number, e.g. `"₹50,000"`); a gig's client/venue by `client_id` or `client_name` (exact, case-insensitive). Ambiguous or partial names return `409 { code: "ambiguous", details: { candidates } }`; unknown names return 404. Status changes: enquiry → confirmed → completed; enquiry can go straight to completed; enquiry/confirmed → cancelled; asking for the current status is a no-op. `delete_gig` is for mistakes and refuses gigs with payments.

Money and roster (T05):

| Operation                            | Route                                     | Who                                            |
| ------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| `get_gig_money`                      | `GET /gigs/:gig_id/money`                 | members (who plays + own share) / owners (all) |
| `record_payment`                     | `POST /gigs/:gig_id/payments`             | members                                        |
| `reverse_payment`                    | `POST /payments/:payment_id/reverse`      | owners, or whoever recorded it                 |
| `record_expense`, `find_expenses`    | `POST`, `GET /expenses`                   | members / owners                               |
| `delete_expense`                     | `DELETE /expenses/:expense_id`            | owners, or whoever recorded it                 |
| `create_musician`, `find_musicians`  | `POST`, `GET /musicians`                  | owners (+ lineup editors) / members            |
| `update_musician`, `delete_musician` | `PATCH`, `DELETE /musicians/:musician_id` | owners                                         |
| `set_gig_lineup`                     | `PUT /gigs/:gig_id/lineup`                | owners, or everyone if the collective allows   |
| `record_payout`                      | `POST /gigs/:gig_id/payouts`              | owners, or everyone if the collective allows   |
| `reverse_payout`                     | `POST /payouts/:payout_id/reverse`        | owners, or everyone if the collective allows   |

What members may see and do follows the collective's Gigs settings (`get_gigs_settings` `GET /settings/gigs`, members; `update_gigs_settings` `PATCH /settings/gigs`, owners): `lineup_visible_to_members` (default true), `lineup_editors` and `payout_recorders` (`"owners"` default, or `"everyone"`). `set_gig_lineup`, `record_payout`, `reverse_payout` and `create_musician` check them (403 otherwise); members who may set lineups can add roster entries but not link accounts; editing and deleting roster entries stays with owners. `get_gig_money` returns `permissions` (`can_see_lineup`, `can_see_lineup_amounts`, `can_edit_lineup`, `can_record_payouts`). Members who may set lineups or record payouts see everyone's amounts; otherwise other people's `share`, `paid`, `owed` and `payout_status` are `null` and `payouts` is empty; with the lineup hidden, members only see their own entry. Expenses and totals stay owners-only. Linking a roster entry to an account that is already linked in the same workspace returns `409 conflict`.

Me (T06, user-scoped under `/api`, read-only; decision 2026-09-27):

| Operation     | Route              | Who                                                                |
| ------------- | ------------------ | ------------------------------------------------------------------ |
| `get_my_home` | `GET /api/me/home` | any signed-in user; covers only their workspaces with Gigs enabled |

Returns `upcoming` (next 8 gigs I play, my own gigs, or collective gigs with no lineup yet, with my amount), `this_month` (earned from played gigs, received, gigs played), `owed_to_me` and `i_owe` per workspace, and `not_on_roster`. Amounts are only mine: shares from roster entries linked to my account; in my personal workspace, the fee minus what I pay others. Only `confirmed`/`completed` gigs that have started count as due.

Joining a collective (creating it or accepting an invitation) puts the person on its roster: an unlinked entry with the same email is linked, otherwise a new entry is created.

Amounts: `amount_paise` or `amount` (a number is rupees; strings like `"₹5,000"` work). Dates (`paid_on`, `spent_on`) are `YYYY-MM-DD` and default to today in India. A lineup is replaced as a whole: each person gets `share`/`share_paise` or `percent` (of `split_total`, default the fee), or use `split: "equal"`. Leftover paise from splits go to the first person. People with payout history can't be removed from a lineup. Payouts need the musician in the lineup.

Planned (T06):

- Gigs: `create_gig`, `find_gigs`, `get_gig`, `update_gig`, `confirm_gig`, `complete_gig`, `cancel_gig`
- Clients: `create_client`, `find_clients`, `get_client_history`
- Venues: `create_venue`, `find_venues`
- Money: `record_payment`, `reverse_payment`, `record_expense`
- Band members: `create_musician`, `find_musicians`, `set_gig_lineup` (musicians + shares; optional `split: equal | percent`), `record_payout`, `reverse_payout`
- Views: `get_schedule`, `get_outstanding_payments`, `get_monthly_report`, `get_dashboard`, `get_payouts_owed` (per musician, per gig), `get_my_earnings` (the signed-in user's shares and payouts across their workspaces)

Two-step from MCP: `record_payment`, `reverse_payment`, `record_expense`, `set_gig_lineup`, `record_payout`, `reverse_payout`, `cancel_gig`, and any delete.

Scopes: `gigs:read`, `gigs:write`. Siri default token: `gigs:read` + `create_gig` + `record_payment` + `record_payout` (no cancel/reverse).

Share visibility is enforced in services: members get only their own lineup row and payouts; owners get all (see [data-model.md](data-model.md)).
