# API

REST under `/api`, same operations exposed as MCP tools at `/mcp`. Both are generated from operation definitions ([modules.md](modules.md)).

## Conventions

- JSON in and out. ISO 8601 dates; timestamps stored UTC, display strings in Asia/Kolkata.
- Paths: `/api/gigs/...` for a gig (only its people can reach it; others get 404) and `/api/me/...` for the signed-in user.
- Cursor pagination: `?cursor=&limit=`, response `{ items, next_cursor }`.
- Errors: `{ "error": { "code": "not_found", "message": "…", "details": {…}? } }`. Ambiguous matches return code `ambiguous` with `details.candidates`.
- Money: `amount_paise` plus `amount_display` ("₹10,000").
- LLM-friendly: include names and display strings next to IDs.
- Writes require `Idempotency-Key` (400 without it). The gig's object stores it with the write: repeating a request with the same key returns the same result; the same key with a different request is a 409 (`idempotency_key_reused`). Two-step writes from MCP: `preview` returns `{ preview, confirm_token, expires_at }`; commit with the token.
- Auth: session cookie (web), bearer API token (Siri, scripts), OAuth access token (MCP).

## Core operations

- `GET /api/me` (`get_me`): the signed-in user.
- Planned: API tokens for Siri and scripts (T09), calendar feed (T08), MCP (T10).

## Gigs (docs/design/gig-centric.md)

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

| `find_my_tags` | `GET /me/tags?kind=&q=` | me (tags on gigs I'm on) |
| `suggest_gig_people` | `GET /me/autofill?collective=` | me |
| `check_gig_duplicates` | `GET /me/duplicates?start_at=&venue_name=&client_name=` | me |

| `find_contacts` | `GET /me/contacts?kind=&q=&limit=` | me (my address book) |
| `save_contact` | `POST /me/contacts` (`kind` client/venue/person, `name`, `phone`, `email`, `city`, `notes`) | me |
| `update_contact`, `remove_contact` | `PATCH`/`DELETE /me/contacts/:contact_id` | me |

**Address book.** My own clients, venues and people, most recently used first, each with `gigs` (gigs I manage that used it). Filled in from gigs I manage (blanks only; never overwrites my edits; removed contacts stay removed) and by me. A second contact with the same kind and name returns `409` `duplicate_contact` with its `contact_id`; saving a removed one's name brings it back. Gigs keep their own copies, so edits never change past gigs.

**Tags, autofill, duplicates (step 5).** `create_gig`/`update_gig` take `collective` (a name; `null` clears it) and `tags` (up to 10 names; replaces the current ones). Names are matched case- and space-insensitively against the D1 tag registry (a new name creates a tag), so "Wedding" and "wedding" are one tag; gig responses carry `collective` and `tags` as `{id, name}`. Reports filter by `collective` and `tags` (all must match; comma-separated). Autofill returns names (and `user_id` for people with accounts) from my latest gig with that collective whose lineup I could see; never roles or amounts. People added by an email without an account are listed in D1 `pending_people`; when that email signs up, the gigs attach to the new account (sign-up hook, with Home as a safety net). Duplicate warnings look at the month index for that India date, match venue or client (case- and space-insensitive), skip cancelled gigs and gigs I'm on, and only show gigs managed by people I've been on gigs with (their name, the date and the venue).

**Home and reports (step 4)** read only my own summaries, so they add up only my money: my share, paid and owed on every gig; fee, received, expenses, shares, payouts and net only for gigs I manage. Home: next 8 events, this month's gigs with my earned/received, played gigs still owing me, and (managers) played gigs with money still due from the client or still to pay out. Reports: dates are India calendar days (inclusive), cancelled gigs left out unless `status=cancelled`, totals overall, by month and by gig. `find_my_gigs` also takes `q` (title, event, client, venue) and `status`.

**Money (step 3).** `create_gig` and `update_gig` take `fee` (rupees) or `fee_paise`, and `settings` (`players_see_lineup` default on, `players_see_fee` and `players_see_shares` default off). Every gig response carries `settings` and `money`: fee side (`fee`, `received`, `balance`, `payment_status`, `payments`; null for players unless `players_see_fee`), `mine` (the caller's share, paid, owed, always), `payees` (everyone's; null for players unless `players_see_shares`) and managers-only `expenses`, `expenses_total`, `shares_total`, `unallocated`, `net`. Each event has a `lineup` (players who may not see the lineup get only their own entry, and `people` shows only them and the managers). Lineup shares: per person (`share`/`share_paise`), `split: "equal"` of `split_total`, or `percent` of `split_total`. People on lineups and payouts are picked by `person_id` or exact `person_name` (case-insensitive; near matches return `ambiguous` with candidates). Payments and payouts are append-only; reversing adds a negative entry (`409` `already_reversed` / `is_reversal`). Money writes don't change the gig's `version`. Removing someone who has been paid returns `409` `has_payouts`. Assistants must confirm every money write. `find_my_gigs` rows include my `part` and `share` per event.

People are added by `user_id`, by `email` (matched to an account case-insensitively; otherwise kept as a name) or by `name`. Edits to details and events send the gig's `version`; a changed gig returns `409` with `details.reason = "version_mismatch"` and `current_version`. Other conflict reasons: `invalid_transition`, `last_event`, `last_manager`, `already_on_gig`, `idempotency_key_reused`.

## Live updates

`GET /api/live` (WebSocket; signed-in session; the `Origin` must be the app's own, so other sites can't open it with your cookies). The connection goes to your person object, which sends `{"type":"gig_changed","gig_id":"…"}` whenever a gig you're on changes (after its summary reaches you, usually within about a second). Send `ping` to keep it open (answered `pong` without waking the object). At most 8 open connections per person; the oldest is closed. The web app keeps one open while visible and refreshes what's on screen on each notice.

## Admin panel (owner-only; docs/design/gig-centric.md §10b)

Plain routes, not operations (never MCP tools or Siri actions). Admins are the emails in the `ADMIN_EMAILS` secret (owners; can't be removed from the panel) plus those added in the panel (D1 `admins`). Everyone else gets 404. Counts only; no one's gigs, names or money.

| Route                                                              | What                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `GET /api/admin/me`                                                | `{ is_admin }` (any signed-in user; the app shows the link only to admins)                           |
| `GET /api/admin/overview`                                          | sections of counts (people from D1; each module adds its own via `admin.sections`) and the tool list |
| `GET`, `POST /api/admin/admins`, `DELETE /api/admin/admins/:email` | list, add, remove admins                                                                             |
| `POST /api/admin/tools/:module.tool`                               | run a module tool (gigs: `flush`, `rebuild` with `from`/`to` months)                                 |
| `GET /api/admin/log`                                               | last 50 admin actions (D1 `admin_audit`)                                                             |
