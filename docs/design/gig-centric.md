# Design: gig-centric, scale-ready

_Status: **draft for the owner's review** (2026-09-28). Nothing here is built yet. Once approved, the decisions go into `docs/decisions.md`, the architecture rules in `AGENTS.md` are updated, and the work plan (section 12) replaces the current backlog items it covers._

Plain-language explanations of the scaling ideas used here (partitioning, hot spots, idempotency, outbox, fan-out, eventual consistency): [`docs/learn/scale.md`](../learn/scale.md).

## 1. Why change

Today everything lives in **workspaces**: a personal one per user and one per collective, with members. Real life is looser:

- Groups change from gig to gig (stand-ins, replacements, one-off lineups).
- The same people play in several groups; money is always settled per gig, never pooled.
- The owner wants to learn and build for **high volume and concurrency**.

So the app becomes **gig-centric**: a gig (booking) is the unit of sharing, money and consistency. "Collective" becomes a **tag** on gigs.

## 2. Concepts (what people see)

| Concept                         | What it is                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gig** (internally: _booking_) | One engagement with a client: fee, client payments, expenses, people, notes. Has **one or more events**.                                                                               |
| **Event**                       | A performance within a gig: date/time, venue, lineup with shares, payouts. Most gigs have one event; a wedding may have mehendi, sangeet and reception.                                |
| **People on a gig**             | Everyone involved, with a **role**: _manager_ (runs the gig) or _player_ (plays). A person may have an account or be just a name (stand-in, session player). Anyone can be on any gig. |
| **Lineup**                      | Per event: which people play, their part (e.g. drums), their share.                                                                                                                    |
| **Collective tag**              | Optional label on a gig, e.g. "Monsoon Project". Used for reports, filtering and autofill. Has an id behind the name, so renames don't break grouping.                                 |
| **Address book**                | Each person's own clients, venues and musicians. Used to **fill in** a gig; the gig keeps its own copy of the details, so editing the address book never changes past gigs.            |

There are no workspaces, no memberships and no collective settings pages. Each person has **Home** (gigs they're on, their money), **Gigs** (list and search), **Reports**, **Address book** and **Settings**.

### Rules agreed with the owner

1. **Visibility:** you see only gigs you're on. Players see the gig details and their own share by default; managers can let players see more, per gig. Reports only ever add up **your own** money (players: your share; managers: the full money of gigs you manage).
2. **Managers:** whoever creates a gig is its first manager; a gig can have several managers; only managers add or remove people.
3. **Collective tag autofill:** tagging a new gig offers "Use the people from the last _Monsoon Project_ gig?" It fills **people only** (no roles, no amounts), taken from the most recent gig with that tag you're on and whose lineup you could see. Roles and shares are set while creating the gig.
4. **Stand-ins:** a temporary player sees only the gigs they were on and only their own details, like everyone else.
5. **People without accounts:** added by name (optionally email/phone). If they sign up later with that email, those gigs attach to their account and appear on their Home.
6. **Duplicates:** when you create a gig, the app warns if someone you know already has a gig on that date at that venue or for that client: _"Ananya has a gig on 12 Dec at JW Marriott — is this the same one? Ask to be added instead."_ It never merges automatically.
7. **Money:** always per gig. Client payments and expenses belong to the gig; shares and payouts belong to events and people. Append-only with reversing entries, as today.
8. **Collaboration (later):** notes and comments, setlists (reorderable, live, offline on stage), checklists, run of show. Designed for now, built after the core rework (section 11).

## 3. Permissions per gig

| Action                                                | Manager | Player       | Notes                                   |
| ----------------------------------------------------- | ------- | ------------ | --------------------------------------- |
| See gig details (date, venue, client name, notes)     | ✓       | ✓            |                                         |
| See who's playing                                     | ✓       | ✓ by default | setting: `players_see_lineup`           |
| See fee and client payments                           | ✓       | ✗ by default | setting: `players_see_fee`              |
| See everyone's shares and payouts                     | ✓       | ✗ by default | setting: `players_see_shares`           |
| See own share, paid, owed                             | ✓       | ✓            | always                                  |
| Edit gig and events, record client payments, expenses | ✓       | ✗            |                                         |
| Set lineup and shares, record and reverse payouts     | ✓       | ✗            | could become a setting later            |
| Add or remove people, change roles                    | ✓       | ✗            | a gig always keeps at least one manager |
| Comment, edit setlist (later)                         | ✓       | ✓            | setting to restrict                     |

Authorization happens **inside the gig's own database** (section 5) on every request: it knows its people and roles, so there is no separate membership lookup.

## 4. Storage architecture

One app, four kinds of storage. The rule: **no ordinary action writes to one shared place.**

```
Worker (one app: /api, /auth, /mcp, web app)
│
├── D1 (one small shared database)
│     accounts and sign-in (Better Auth), API tokens, tag registry
│     written rarely: sign-up, sign-in, creating/renaming a tag
│
├── Booking objects        booking:<gig id>           one per gig
│     the gig, its events, people and roles, lineup, money,
│     settings, audit history, idempotency records, outbox
│
├── Person objects         person:<user id>           one per user
│     summary rows of my gigs and events, address book,
│     pending invites by email, my tag usage
│
└── Index objects          index:<YYYY-MM>            one per month
      one small card per event: date, venue, client, gig id,
      managers; used for duplicate warnings and group reports
```

The objects are **Cloudflare Durable Objects with SQLite storage**: each is its own small SQLite database, reached by a name we choose, processing one request at a time. Dev and prod are separate Worker deployments, so each has its own D1 and its own objects.

### Why each piece lives where it does

- **Booking object = unit of consistency.** Everything that must be exactly right together (a payment and the balance it changes, a payout and what's owed) is in one small database, updated one request at a time. Money never crosses gigs, so nothing ever needs a lock across objects.
- **Person object = my read model.** Home and reports read one person's object: a few thousand summary rows at most, whatever the total volume.
- **Index by month = searchable without a hot spot.** Every question the index answers starts with a date, so month is the partition key. A busy month can be split further by day later.
- **D1 = identity only.** Sign-in needs a normal relational database; it's read on every request (cached, section 8) and written rarely.

## 5. Inside each object

All tables use ULIDs, integer paise, UTC ISO times, as today. Each object runs its own schema migrations when it wakes (a `schema_version` row).

### Booking object (`booking:<gig id>`)

- `gig`: id, title, status (`enquiry`/`confirmed`/`completed`/`cancelled`), client snapshot (name, phone, organisation, address-book id), fee_paise, tag_id + tag_name snapshot, notes, settings (JSON: `players_see_lineup`, `players_see_fee`, `players_see_shares`), version, created_by, timestamps, deleted_at.
- `events`: id, title (e.g. "Sangeet"), start_at, end_at, venue snapshot, notes, position, deleted_at.
- `people`: id, user_id (nullable), name, email, phone, role (`manager`/`player`), added_by, timestamps, removed_at.
- `lineup`: id, event_id, person_id, part (e.g. "drums"), share_paise. Unique (event_id, person_id).
- `payments`: client payments (append-only, reversals), as today but per gig.
- `expenses`: gig-level, optional event_id.
- `payouts`: person_id, optional event_id, amount (append-only, reversals).
- `audit`: every write: actor, source, action, entity, before/after.
- `idempotency`: key → result, 24 h.
- `outbox`: pending summary updates to deliver (section 6).
- Later: `comments`, `setlist_items`, `checklist_items`, `schedule_items`.

Derived, never stored: balance, payment status, owed per person, net.

### Person object (`person:<user id>`)

- `my_events`: one row per event I'm on: gig id, event id, title, start_at, venue name, client name, tag id, my role, my part, my share, paid to me, owed to me; for gigs I manage also fee, received, balance, shares total, expenses, net. Updated by the booking's outbox.
- `address_book`: clients, venues, musicians (my own; used to fill in gigs).
- `tags_seen`: tags on gigs I'm on (for suggestions and autofill).
- `applied`: which booking updates have been applied (booking id → last sequence number), so deliveries can be repeated safely.

### Index object (`index:<YYYY-MM>`)

- `cards`: event id, gig id, start_at, venue key, client key, tag id, manager user ids, status. One per event.

### D1

- Better Auth tables (users, sessions, accounts, passkeys, OAuth for MCP), API tokens.
- `tags`: id, name, created_by, timestamps (written only on create and rename).
- `pending_people`: email → gig ids, for people added before they have an account (so sign-up can attach them). Written only when adding someone without an account.

Workspace tables (`organization`, `member`, `invitation`, `workspace_modules`) and the gigs module's D1 tables are retired.

## 6. How a write flows

Example: a manager records a ₹20,000 advance.

1. The Worker checks the session (cached) and sends the request to `booking:<gig id>`.
2. The booking object, one request at a time:
   1. checks the idempotency record (a retry returns the stored result and stops);
   2. checks the caller is a manager on this gig;
   3. in **one SQLite transaction**: inserts the payment, the audit row, the idempotency record, and **outbox rows** ("update the summaries of these people and the index card");
   4. replies immediately with the new money view.
3. The booking object's **alarm** (a timer Durable Objects provide) wakes shortly after and delivers the outbox: it calls each affected `person:<id>` and the `index:<month>` object with the new summary. Each delivery carries a sequence number; receivers ignore anything older than what they've applied, so repeats and out-of-order deliveries are harmless. Delivered rows are removed; failures are retried with backoff.

This is the **transactional outbox**: the change and "tell the others" are saved together, so a crash can never leave one without the other. Home and reports catch up within a second or two; the gig's own page is always exact.

**Many updates at once** (e.g. ten edits in a second, or a gig with many people) are combined: the outbox keeps only the latest summary per recipient. Cloudflare Queues can take over delivery later if needed; it isn't required now.

## 7. How reads flow

- **Gig page:** one call to `booking:<id>`, which returns only what the caller may see (section 3).
- **Home and reports:** one call to `person:<me>`; SQL over my summary rows (by month, tag, client, status).
- **Duplicate warning on create:** one call to `index:<month of the date>` for cards on that date matching venue or client, filtered to managers I've been on gigs with (or all managers, showing only name and date: to decide in review).
- **Group report for a tag, e.g. "Monsoon this year":** built from my summary rows (only my money), so no cross-person query is needed.

## 8. Hot spots and how they're handled

| Could run hot      | Why                              | Handling                                                                                                                                     |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D1                 | every request checks the session | short-lived session cache (signed cookie cache + edge cache); D1 read replicas if needed; nothing written per action                         |
| Month index        | wedding season bunches events    | split a busy month by day (`index:2026-12-12`), then by day + shard number                                                                   |
| Busy person object | someone on thousands of gigs     | outbox combines updates; very long histories split by year (`person:<id>:2026`)                                                              |
| Big gig            | one change updates many people   | outbox delivers in the background, combined and retried                                                                                      |
| One booking object | heavy traffic on one gig         | a normal gig is nowhere near the limit (hundreds of requests a second per object); a public page would be cached, not served from the object |

We watch object latency and storage per object; the load test is deferred (owner's call).

## 9. Correctness under concurrency

- **One request at a time per gig:** no lost updates inside a gig.
- **Version check on edits:** editing gig or event details sends the version you loaded; if someone changed it since, you get "Changed by Ananya — reload" instead of overwriting.
- **Money is append-only:** two payments at the same moment are two rows; nothing is overwritten.
- **Idempotency:** every write carries a key; retries return the first result (stored in the booking object, so check and write happen together).
- **Outbox with sequence numbers:** summaries are eventually exact; the **rebuild tool** recomputes any person's summaries or any index month from the bookings.

## 10. Environments, backups, limits, cost

- **Environments:** local tests (in-memory, including Durable Objects), dev (`assistant-dev`), prod (`assistant`); each deployment has its own D1 and objects. A staging deployment can be added the same way.
- **Backups:** D1 has point-in-time recovery (7 days free, 30 paid). Durable Object storage: I'll confirm the recovery options against Cloudflare's docs during step 1; in addition, a nightly job copies each changed booking to private R2 as JSON.
- **Limits checked (2026-09-28, Cloudflare docs source on GitHub):** Durable Objects free plan: 100,000 requests/day, 5 million rows read/day, 100,000 rows written/day, 5 GB stored in total, 1 GB per object, unlimited objects. Paid ($5/month): 10 GB per object, 1 million requests/month included then $0.15/million, 50 million rows written/month included. D1 free: 500 MB per database, 10 databases, 5 GB total. Queues: available on free with 24 h retention (not needed now).
- **Cost:** free plan to start. The first limit likely to matter is 100,000 object requests per day; I'll tell the owner before anything needs the paid plan.

## 11. Collaboration (designed now, built later)

- Tables in the booking object: `comments`, `setlist_items` (per event, fractional position keys so a move touches one row), `checklist_items`, `schedule_items`.
- **Live updates:** the booking object keeps WebSocket connections to people viewing the gig (hibernating when idle) and broadcasts changes.
- **Offline on stage:** the PWA stores the setlists of upcoming gigs; edits made offline sync when back online (positions merge; conflicting text edits keep both).
- Songs start as text rows and link to the future music library module.

## 12. Migration and work plan

**Existing data:** prod has only test data, so the new design starts **empty on prod** (owner's default). User accounts stay; old workspace and gig tables are dropped by a migration. I'll confirm with the owner right before that migration runs on prod.

**Work plan** (each step shipped to dev, verified, then prod):

1. **Foundation:** Durable Object bindings, booking/person/index objects with per-object migrations, idempotency and audit inside the booking, outbox with alarms, rebuild tool, test setup. Architecture rules and docs updated.
2. **Gigs:** create gig with events, people and roles, client/venue snapshot from the address book, status, edit with version check, delete/cancel; permissions per section 3; API and MCP operations reworked (routes under `/api/gigs/:gig_id/...`).
3. **Money:** payments, expenses, lineup with shares per event, payouts, derived views; per-gig visibility settings.
4. **Home and reports** from person objects; Gigs list and search.
5. **Tags and autofill; people without accounts** (attach on sign-up); **duplicate warnings** via the month index.
6. **Screens** reworked throughout (Home, Gigs, gig page with events, address book, reports, settings), checked at 390 / 820 / 1280 px, light and dark.
7. **Retire workspaces** (code, tables, collective page) and drop old data on prod (with the owner's OK).
8. Later: collaboration (section 11), load test when the owner decides.

## 13. Architecture rules that change

| Rule today                                             | Becomes                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1. Shared database, `workspace_id` on every tenant row | Partition by entity: a booking object per gig, a person object per user, month index objects; D1 for identity and tags only |
| 2. Services take `{db, user, workspace, source}`       | Services run inside the object that owns the data and take `{user, source, role on this gig}`                               |
| 3. Authorization: user → membership → role → module    | User (session/token) → object checks the person's role on that gig → token scope                                            |
| 8. Idempotency key on every write (stored 24 h)        | Unchanged, stored in the object that performs the write                                                                     |
| 11. Audit log for every write                          | Unchanged, stored in the object; copied to R2 for a global view                                                             |
| 12. Indexes on every filtered column                   | Unchanged inside each object; plus: never write per action to one shared place                                              |
| 15. Modules depend on core                             | Unchanged; modules own their object classes                                                                                 |

Rules 4–7, 9, 10, 13, 14 stay as they are.

## 14. Open points for review

1. **Duplicate warning scope:** warn about gigs of anyone who has a matching date and venue/client (showing only "someone has a gig here that day"), or only gigs of people you've played with (showing their name)? Suggested: the second.
2. **Booking vs gig naming:** people see "Gig" everywhere, with "events" inside (e.g. "Sangeet", "Reception"). Suggested wording for events: **"Events"**.
3. Anything missing from section 2's rules.
