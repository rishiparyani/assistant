# API

REST under `/api`, same operations exposed as MCP tools at `/mcp`. Both are generated from operation definitions ([modules.md](modules.md)).

## Conventions

- JSON in and out. ISO 8601 dates; timestamps stored UTC, display strings in Asia/Kolkata.
- Workspace in the path: `/api/w/:workspaceId/...` for workspace data; `/api/me/...` for the user.
- Cursor pagination: `?cursor=&limit=`, response `{ items, next_cursor }`.
- Errors: `{ "error": { "code": "not_found", "message": "…", "details": {…}? } }`. Ambiguous matches return code `ambiguous` with `details.candidates`.
- Money: `amount_paise` plus `amount_display` ("₹10,000").
- LLM-friendly: include names and display strings next to IDs.
- Writes require `Idempotency-Key`. Two-step writes from MCP: `preview` returns `{ preview, confirm_token, expires_at }`; commit with the token.
- Auth: session cookie (web), bearer API token (Siri, scripts), OAuth access token (MCP).

## Core operations

- Me/workspaces: `list_workspaces`, `get_workspace`, `create_band_workspace`, `invite_member`, `remove_member`
- Modules: `list_modules`, `set_module_enabled`
- API tokens: `create_api_token`, `list_api_tokens`, `revoke_api_token`
- Calendar: private tokenised `.ics` feed URL per user (modules contribute events)

## Gigs module operations (Phase 1)

- Gigs: `create_gig`, `find_gigs`, `get_gig`, `update_gig`, `confirm_gig`, `complete_gig`, `cancel_gig`
- Clients: `create_client`, `find_clients`, `get_client_history`
- Venues: `create_venue`, `find_venues`
- Money: `record_payment`, `reverse_payment`, `record_expense`
- Views: `get_schedule`, `get_outstanding_payments`, `get_monthly_report`, `get_dashboard`

Two-step from MCP: `record_payment`, `reverse_payment`, `record_expense`, `cancel_gig`, and any delete.

Scopes: `gigs:read`, `gigs:write`. Siri default token: `gigs:read` + `create_gig` + `record_payment` (no cancel/reverse).
