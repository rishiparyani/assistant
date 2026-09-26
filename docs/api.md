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

Planned (T05, T06):

- Gigs: `create_gig`, `find_gigs`, `get_gig`, `update_gig`, `confirm_gig`, `complete_gig`, `cancel_gig`
- Clients: `create_client`, `find_clients`, `get_client_history`
- Venues: `create_venue`, `find_venues`
- Money: `record_payment`, `reverse_payment`, `record_expense`
- Band members: `create_musician`, `find_musicians`, `set_gig_lineup` (musicians + shares; optional `split: equal | percent`), `record_payout`, `reverse_payout`
- Views: `get_schedule`, `get_outstanding_payments`, `get_monthly_report`, `get_dashboard`, `get_payouts_owed` (per musician, per gig), `get_my_earnings` (the signed-in user's shares and payouts across their workspaces)

Two-step from MCP: `record_payment`, `reverse_payment`, `record_expense`, `set_gig_lineup`, `record_payout`, `reverse_payout`, `cancel_gig`, and any delete.

Scopes: `gigs:read`, `gigs:write`. Siri default token: `gigs:read` + `create_gig` + `record_payment` + `record_payout` (no cancel/reverse).

Share visibility is enforced in services: members get only their own lineup row and payouts; owners get all (see [data-model.md](data-model.md)).
