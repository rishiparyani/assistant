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
- `GET /api/me/calendar` (`get_calendar_feed`), `POST /api/me/calendar` (`enable_calendar_feed`, `{reset: true}` for a new link), `DELETE /api/me/calendar` (`disable_calendar_feed`): my private calendar feed link (`url`, `webcal_url`, `last_used_at`). One per person; switching on again returns the same link; a retry with the same Idempotency-Key too.
- `GET /api/calendar/<token>.ics` (no sign-in; the link is the key): my events as iCalendar, 90 days back onwards, cancelled ones marked `STATUS:CANCELLED`, enquiries `TENTATIVE`, no money. Unknown or revoked links get a plain 404. Modules add events through `calendar` in their definition.
- `GET /api/me/tokens` (`list_api_tokens`), `POST /api/me/tokens` (`create_api_token`: `name`, `write`; the secret `token` is returned once), `DELETE /api/me/tokens/:token_id` (`revoke_api_token`). Signed-in sessions only.
- **API tokens (T09):** send `Authorization: Bearer ast_…` instead of a cookie. A token acts as its owner on operation routes only (never admin, live updates, or token and feed management: `403`/`401`), with scope `read` or `read write` (a read-only token gets `403` on writes). Writes still need an `Idempotency-Key`. Audited with source `siri`. Unknown or revoked: `401`. Siri recipes: `shortcuts/README.md`.
- **Notifications (T11):** `GET /api/me/notifications` (`get_notifications`: latest, with `unread`), `POST /api/me/notifications/read` (`mark_notifications_read`). Push on this device (session only): `GET /api/me/push?endpoint=` (public key, device count, whether this device is on), `POST /api/me/push` (`{endpoint, keys: {p256dh, auth}, label}`; only Apple, Google, Mozilla and Microsoft push services), `POST /api/me/push/remove`, `POST /api/me/push/test`. Modules notify through core `notify(env, userId, {kind, title, body, url})`.
- **MCP (T10)** at `POST /mcp` (Streamable HTTP, stateless, JSON responses; GET/DELETE answer 405). Assistants connect with OAuth (dynamic client registration; consent page `/consent`; discovery at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`). Tools are the operations above by their `tool` names, minus session-only ones (tokens, calendar feed); input schemas come from the same Zod definitions. Write tools take an optional `request_id` (repeat-safe). Tools marked "needs confirmation" (money, cancellations, deletes) first return `needs_confirmation`, a preview and a `confirm_token` (sealed, bound to the person, tool and exact arguments, 10 minutes); calling again with it applies the action, and retries of that call don't repeat it. Results are JSON in `structuredContent`, and in text inside `<data>…</data>` with a note that names and notes are data, not instructions. Errors come back as tool errors (`isError`) with the same codes as the HTTP API. Audited with source `mcp`.

## Gigs (docs/design/gig-centric.md)

User-scoped routes under `/api` (access comes from each gig's own people and roles; people not on a gig get 404). Writes need an `Idempotency-Key`, which is stored **inside the gig's object**, not in D1; a retried create returns the same gig (the key maps to the gig id in the creator's person object).

| Operation (tool)                                           | Route                                                                         | Who                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `create_gig`                                               | `POST /gigs`                                                                  | anyone signed in; becomes manager       |
| `find_my_gigs`                                             | `GET /me/gigs?from=&to=&order=&limit=&cursor=`                                | me (from my summaries; may lag seconds) |
| `get_gig`                                                  | `GET /gigs/:gig_id`                                                           | people on the gig                       |
| `update_gig`                                               | `PATCH /gigs/:gig_id` (with `version`)                                        | managers                                |
| `set_gig_status`                                           | `POST /gigs/:gig_id/status` (`confirm`/`complete`/`cancel`/`reopen`)          | managers                                |
| `delete_gig`                                               | `DELETE /gigs/:gig_id`                                                        | managers (soft delete)                  |
| `get_gig_history`                                          | `GET /gigs/:gig_id/history?before=`                                           | managers (plain words, 50 a page)       |
| `add_gig_event`, `update_gig_event`, `remove_gig_event`    | `POST /gigs/:gig_id/events`, `PATCH`/`DELETE /gigs/:gig_id/events/:event_id`  | managers (a gig keeps ≥ 1 event)        |
| `set_rehearsal_attendance`                                 | `PUT /gigs/:gig_id/events/:event_id/attendance`                               | anyone on the gig (managers for others) |
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

| `get_brief` | `GET /me/brief?what=next\|week\|owed_to_me\|to_collect\|to_pay` | me (a sentence for Siri, plus items) |
| `pick_gig_or_person` | `GET /me/pick?q=` or `?gig_id=` | me (label → id, for Shortcuts' Choose from List) |

| `get_gig_types`, `set_gig_types` | `GET`/`PUT /me/gig-types` (`types`: names in order, unique, up to 30) | me (Public and Private until changed) |
| `find_contacts` | `GET /me/contacts?kind=&q=&limit=` | me (my address book) |
| `save_contact` | `POST /me/contacts` (`kind` client/venue/person, `name`, `phone`, `email`, `city`, `notes`) | me |
| `update_contact`, `remove_contact` | `PATCH`/`DELETE /me/contacts/:contact_id` | me |

| `create_gig_list`, `update_gig_list`, `remove_gig_list` | `POST /gigs/:gig_id/lists`, `PATCH`/`DELETE /gigs/:gig_id/lists/:list_id` | people on the gig (players unless `players_edit_lists` is off) |
| `add_list_items`, `update_list_item`, `remove_list_item` | `POST /gigs/:gig_id/lists/:list_id/items`, `PATCH`/`DELETE …/items/:item_id` | same |
| `move_list_item` | `POST /gigs/:gig_id/lists/:list_id/items/:item_id/move` (`after_item_id`, null = top) | same |
| `add_gig_note`, `update_gig_note`, `remove_gig_note` | `POST /gigs/:gig_id/notes`, `PATCH`/`DELETE /gigs/:gig_id/notes/:note_id` | same; only the author edits; author or a manager removes |

| `add_gig_guests`, `update_gig_guest`, `remove_gig_guest` | `POST /gigs/:gig_id/guests`, `PATCH`/`DELETE /gigs/:gig_id/guests/:guest_id` | people on the gig: their own guests while the list is open; managers: anyone's, any time, and arrivals |
| `set_guest_list` | `PATCH /gigs/:gig_id/guest-list` (`total_limit`, `per_person_limit`, `closes_at`; null clears) | managers |
| `get_guest_link`, `enable_guest_link`, `disable_guest_link` (app only) | `GET`/`POST`/`DELETE /gigs/:gig_id/guest-link` (`check_in`, `reset`) | managers |
| (venue, no sign-in) | `GET /api/shared/:token`, `POST /api/shared/:token/arrive` (`guest_id`, `arrived`; Idempotency-Key) | anyone with the link |

**Guest list.** Every gig response carries `guest_list`: limits, `closes_at`, `open` (can I change my guests now), `heads` (guests + plus-ones), `my_heads`, `arrived_heads`, `guests` (managers: everyone's with `host_name`; players: their own) and, for managers, `link` (`enabled`, `check_in`). Going over a limit returns `409` `guest_list_full` or `guest_limit_reached`; changing after it closes (or once the gig is played or cancelled) returns `409` `guest_list_closed` for players. The venue link is `/guests/gl_<gig id>_<secret>`: the gig stores only its hash (and the token sealed, so managers can see it again); a wrong, reset or turned-off link gets `404`. The shared view has the gig's title, first event time and venue, and each guest's name, plus-ones, note, whose guest and arrived; no money, phone numbers or other gig details.

**Ids made on the device.** `add_gig_note`, `create_gig_list` (and its `items`), `add_list_items` items and `add_gig_guests` guests take an optional `id` (a ULID) so the app can refer to something made offline before it syncs (docs/design/offline.md). A taken id returns `409` `id_taken`.

**Lists and notes.** Every gig response carries `lists` (in the order made; each with `title`, `event_id` or null for the whole gig, `checkable`, and `items` in order with `text`, `detail`, `done`, `done_by`), `shared_notes` (newest first; `author`, `is_mine`, `created_at`, `edited_at`) and `can_edit_lists`. The gig's own `notes` field is separate (managers' notes on the gig). Items are added at the end, at the top (`after_item_id: null`) or after an item; a move changes only that item (numeric positions with room between them; a list is renumbered when a gap runs out). Limits: 30 lists a gig, 300 items a list, 500 notes a gig; item text 200 characters, detail 200, note 2,000. These writes don't change the gig's `version`. Assistants confirm removals.

**Address book.** My own clients, venues and people, most recently used first, each with `gigs` (gigs I manage that used it). Filled in from gigs I manage (blanks only; never overwrites my edits; removed contacts stay removed) and by me. A second contact with the same kind and name returns `409` `duplicate_contact` with its `contact_id`; saving a removed one's name brings it back. Gigs keep their own copies, so edits never change past gigs.

**Tags, autofill, duplicates (step 5).** `create_gig`/`update_gig` take `collective` (a name; `null` clears it) and `tags` (up to 10 names; replaces the current ones). Names are matched case- and space-insensitively against the D1 tag registry (a new name creates a tag), so "Wedding" and "wedding" are one tag; gig responses carry `collective` and `tags` as `{id, name}`. Reports filter by `collective` and `tags` (all must match; comma-separated). Autofill returns names (and `user_id` for people with accounts) from my latest gig with that collective whose lineup I could see; never roles or amounts. People added by an email without an account are listed in D1 `pending_people`; when that email signs up, the gigs attach to the new account (sign-up hook, with Home as a safety net). Duplicate warnings look at the month index for that India date, match venue or client (case- and space-insensitive), skip cancelled gigs and gigs I'm on, and only show gigs managed by people I've been on gigs with (their name, the date and the venue).

**Home and reports (step 4)** read only my own summaries, so they add up only my money: my share, paid and owed on every gig; fee, received, expenses, shares, payouts and net only for gigs I manage. Home: next 8 events, this month's gigs with my earned/received, played gigs still owing me, and (managers) played gigs with money still due from the client or still to pay out. Reports: dates are India calendar days (inclusive), cancelled gigs left out unless `status=cancelled`, totals overall, by month and by gig. `find_my_gigs` also takes `q` (title, event, client, venue) and `status`.

**Money (step 3).** `create_gig` and `update_gig` take `fee` (rupees) or `fee_paise`, and `settings` (`players_see_lineup` default on, `players_see_fee` and `players_see_shares` default off). Every gig response carries `settings` and `money`: fee side (`fee`, `received`, `balance`, `payment_status`, `payments`; null for players unless `players_see_fee`), `mine` (the caller's share, paid, owed, always), `payees` (everyone's; null for players unless `players_see_shares`) and managers-only `expenses`, `expenses_total`, `shares_total`, `unallocated`, `net`. Each event has a `lineup` (players who may not see the lineup get only their own entry, and `people` shows only them and the managers). Lineup shares: per person (`share`/`share_paise`), `split: "equal"` of `split_total`, or `percent` of `split_total`. People on lineups and payouts are picked by `person_id` or exact `person_name` (case-insensitive; near matches return `ambiguous` with candidates). Payments and payouts are append-only; reversing adds a negative entry (`409` `already_reversed` / `is_reversal`). Money writes don't change the gig's `version`. Removing someone who has been paid returns `409` `has_payouts`. Assistants must confirm every money write. `find_my_gigs` rows include my `part` and `share` per event.

**Reopening.** `reopen` undoes a cancellation: the gig goes back to the status it had (enquiry or confirmed; kept on the gig as `cancelled_from`, booking migration 9) and its cancel reason is cleared. A refund recorded when cancelling stays (refunds can't be reversed; record a new payment if it didn't happen). Anything else gets `409` `invalid_transition`.

People are added by `user_id`, by `email` (matched to an account case-insensitively; otherwise kept as a name) or by `name`. Edits to details and events send the gig's `version`; a changed gig returns `409` with `details.reason = "version_mismatch"` and `current_version`. Other conflict reasons: `invalid_transition`, `last_event`, `last_manager`, `already_on_gig`, `idempotency_key_reused`.

## Music (docs/design/music.md)

My own songs only (someone else's song is 404). Writes need an `Idempotency-Key`; a create may send an `id` made on the device (reused id: `409` `id_taken`).

- `GET /api/songs?q=&limit=` (`find_songs`): my songs sorted by title (ignoring The/A/An), each word of `q` starting a word of the title or artist; no charts.
- `GET /api/songs/:song_id` (`get_song`): one song with its ChordPro `chart`.
- `POST /api/songs` (`create_song`: `title`, optional `artist`, `key` like `G`/`F#m`/`Bb`, `tempo_bpm`, `capo`, `notes`, `chart`), `PATCH /api/songs/:song_id` (`update_song`; empty text clears), `DELETE /api/songs/:song_id` (`remove_song`, confirmation from MCP). Up to 2000 songs (more: `400` `validation_failed`).
- `GET /api/songs-all` (`all_songs`, session only): the whole library with charts, for the web app's offline copy.
- Gig list items (`create_gig_list`, `add_list_items`) take an optional `song_id`, returned on each item; that is a setlist.

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
