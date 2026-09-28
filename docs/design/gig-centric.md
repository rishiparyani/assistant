# Design: gig-centric, scale-ready

_Status: **approved by the owner** (2026-09-28; the owner trusts the design and it can change as we learn). Being built in the steps of section 12. Decisions: `docs/decisions.md` (2026-09-28). Architecture rules in `AGENTS.md` follow section 13._

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
├── Queue "summaries"        (Cloudflare Queues)
│     carries "this gig changed" notes from gigs to the consumer,
│     which updates person and index objects; dead letter queue
│
├── Pending object         pending:<shard>            a few
│     which gigs have notes waiting (only while delivery fails)
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
- `outbox`: at most **one** waiting note per gig: "changed up to sequence N, recipients …" (section 6). Usually empty.
- Later: `comments`, `setlist_items`, `checklist_items`, `schedule_items`.

Derived, never stored: balance, payment status, owed per person, net.

### Person object (`person:<user id>`)

- `my_events`: one row per event I'm on: gig id, event id, title, start_at, venue name, client name, tag id, my role, my part, my share, paid to me, owed to me; for gigs I manage also fee, received, balance, shares total, expenses, net. Updated by the booking's outbox.
- `address_book`: clients, venues, musicians (my own; used to fill in gigs).
- `tags_seen`: tags on gigs I'm on (for suggestions and autofill).
- `applied`: which booking updates have been applied (booking id → last sequence number), so deliveries can be repeated or arrive out of order safely.

### Index object (`index:<YYYY-MM>`)

- `cards`: event id, gig id, start_at, venue key, client key, tag id, manager user ids, status. One per event.

### Pending object (`pending:<shard>`)

- `waiting`: gig ids whose outbox note couldn't be handed to the queue yet, with the time of the last attempt. A gig adds itself on a failed send and removes itself once its outbox is empty. Written only while delivery is failing, so it is quiet in normal operation; "Flush outboxes" walks this list. Sharded by gig id (a few shards) so an outage doesn't funnel every gig into one object.

### D1

- Better Auth tables (users, sessions, accounts, passkeys, OAuth for MCP), API tokens.
- `tags`: id, name, created_by, timestamps (written only on create and rename).
- `pending_people`: email → gig ids, for people added before they have an account (so sign-up can attach them). Written only when adding someone without an account.

Workspace tables (`organization`, `member`, `invitation`, `workspace_modules`) and the gigs module's D1 tables are retired.

## 6. How a write flows (outbox → queue)

Example: a manager records a ₹20,000 advance.

1. The Worker checks the session (cached) and sends the request to `booking:<gig id>`.
2. The booking object, one request at a time:
   1. checks the idempotency record (a retry returns the stored result and stops);
   2. checks the caller is a manager on this gig;
   3. in **one SQLite transaction**: inserts the payment, the audit row and the idempotency record, bumps the gig's **sequence number**, and **writes or updates its single outbox note** ("changed up to sequence N; recipients: these people, these month indexes");
   4. sets its alarm for "now" and replies immediately with the new money view.
3. The **alarm** runs: it sends the note to the Cloudflare Queue `summaries` (one message per gig change, not per recipient).
   - **Queue accepts →** the note is deleted from the outbox (only if its sequence number is still the one that was sent; a newer change keeps its note).
   - **Queue rejects** (daily limit, outage) **→** the note stays; the alarm is rescheduled with growing waits (2 s, 4 s … up to 1 hour) and **never gives up**. The gig adds itself to the `pending` list, and removes itself once its outbox is empty.
4. The **queue consumer** receives batches (up to 100 messages, waiting at most ~1 s), **combines** messages per gig (keeps the highest sequence), asks each gig once for the current summaries, and delivers them to the affected `person:<id>` and `index:<month>` objects. Each message is acknowledged individually; failures are retried; after the retries run out a message goes to the **dead letter queue** `summaries-dlq` (which alerts).
5. Receivers apply a summary only if its sequence number is newer than what they have (`applied` table), so duplicates and out-of-order deliveries are harmless.

**Why the note is written first:** writing to the gig and to the queue can't be one atomic step (the _dual-write problem_). If we sent to the queue after saving and crashed in between, the update would be lost. Saving the note together with the change and sending it afterwards means nothing is ever forgotten.

**Why the outbox stays tiny:** notes are deleted as soon as the queue accepts them (usually within a second or two), and each gig holds at most one note: later changes merge into it (the note says "refresh from sequence N"; the consumer reads the gig's current state). During a queue outage there is one small note per changed gig, each in its own gig's database.

**Queue budget:** one message per gig change costs 3 queue operations (write, read, delete). The free plan's 10,000 operations/day cover about 3,300 gig changes a day; beyond that, notes wait and go through after the daily reset (05:30 IST), or we move to the paid plan ($0.40 per million operations beyond 1 million/month).

**Safety-net tools** (admin page buttons, also runnable as scripts; safe to run any time thanks to sequence numbers):

- **Flush outboxes:** asks every gig on the `pending` list to send its note now.
- **Rebuild summaries:** recomputes person summaries and month indexes straight from the gigs (for one person, one month or everyone). Fixes anything, even a lost message, because the gigs hold the source of truth.

This is the **transactional outbox**. Home and reports catch up within seconds; the gig's own page is always exact.

## 7. How reads flow

- **Gig page:** one call to `booking:<id>`, which returns only what the caller may see (section 3).
- **Home and reports:** one call to `person:<me>`; SQL over my summary rows (by month, tag, client, status).
- **Duplicate warning on create:** one call to `index:<month of the date>` for cards on that date matching venue or client, **only for gigs of people I've been on gigs with** (showing their name).
- **Group report for a tag, e.g. "Monsoon this year":** built from my summary rows (only my money), so no cross-person query is needed.

## 8. Hot spots and how they're handled

| Could run hot      | Why                              | Handling                                                                                                                                     |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D1                 | every request checks the session | short-lived session cache (signed cookie cache + edge cache); D1 read replicas if needed; nothing written per action                         |
| Month index        | wedding season bunches events    | split a busy month by day (`index:2026-12-12`), then by day + shard number                                                                   |
| Busy person object | someone on thousands of gigs     | the queue consumer combines updates per batch; very long histories split by year (`person:<id>:2026`)                                        |
| Big gig            | one change updates many people   | one queue message per change; the consumer fans out in the background with autoscaling, retries and a dead letter queue                      |
| Queue budget       | free plan: 10,000 operations/day | one message per gig change (not per recipient); notes wait in the outbox if the limit is hit; alert at 70% and 90%                           |
| One booking object | heavy traffic on one gig         | a normal gig is nowhere near the limit (hundreds of requests a second per object); a public page would be cached, not served from the object |

We watch object latency and storage per object; the load test is deferred (owner's call).

## 9. Correctness under concurrency

- **One request at a time per gig:** no lost updates inside a gig.
- **Version check on edits:** editing gig or event details sends the version you loaded; if someone changed it since, you get "Changed by Ananya — reload" instead of overwriting.
- **Money is append-only:** two payments at the same moment are two rows; nothing is overwritten.
- **Idempotency:** every write carries a key; retries return the first result (stored in the booking object, so check and write happen together).
- **Outbox with sequence numbers:** summaries are eventually exact; queue delivery is at-least-once and unordered, which sequence numbers make harmless; the **rebuild tool** recomputes any person's summaries or any index month from the bookings.

## 10. Environments, backups, limits, cost

- **Environments:** local tests (in-memory, including Durable Objects), dev (`assistant-dev`), prod (`assistant`); each deployment has its own D1 and objects. A staging deployment can be added the same way.
- **Backups:** D1 has point-in-time recovery (7 days free, 30 paid). Durable Object storage: I'll confirm the recovery options against Cloudflare's docs during step 1; in addition, a nightly job copies each changed booking to private R2 as JSON.
- **Limits checked (2026-09-28, Cloudflare docs source on GitHub):** Durable Objects free plan: 100,000 requests/day, 5 million rows read/day, 100,000 rows written/day, 5 GB stored in total, 1 GB per object, unlimited objects. Paid ($5/month): 10 GB per object, 1 million requests/month included then $0.15/million, 50 million rows written/month included. D1 free: 500 MB per database, 10 databases, 5 GB total. Queues free: 10,000 operations/day, 24 h message retention, up to 5,000 messages/second per queue; paid: 1 million operations/month then $0.40/million, 14 days retention. Durable Object alarms: at-least-once, 6 automatic retries (we reschedule ourselves so it never gives up).
- **Cost:** free plan to start. The first limit likely to matter is 100,000 object requests per day; I'll tell the owner before anything needs the paid plan.

## 10a. Monitoring and alerts

**Measured:** requests, error rate and speed (typical and slowest 5%) per operation; sign-in failures; **outbox backlog and age of the oldest note** (the best early warning); queue backlog, retries, consumer errors; dead letter queue count; summary lag (gig change → Home updated); a nightly sample comparing summaries with gigs (differences are fixed by the rebuild tool); daily usage against every free limit; storage per object; nightly backup result; deploy smoke test.

**Where:** Cloudflare's dashboards (requests, errors, logs, queue backlog, usage), custom metrics in Workers Analytics Engine (outbox age, summary lag, per-operation timings), and an **admin page** in the app (backlogs, dead letter queue with retry, flush and rebuild buttons).

**Alerts by email** to a dedicated address (not the owner's main one; stored as a secret, never in the repo; verified once through Cloudflare Email Routing):

| Alert             | When                                    |
| ----------------- | --------------------------------------- |
| Free-plan usage   | 70% and 90% of any daily limit          |
| Dead letter queue | any message lands in it                 |
| Delivery stuck    | oldest outbox note older than 5 minutes |
| Errors            | error rate above 2% for 10 minutes      |
| Slow              | slowest 5% above 1.5 s for 10 minutes   |
| Backup failed     | any night                               |
| App down          | external health check fails             |

A scheduled job checks the custom metrics every few minutes and sends the emails; Cloudflare's own notifications cover usage where available. Every alert has a runbook note (what to do). **No personal data in logs or metrics:** ids and counts only.

## 11. Collaboration (designed now, built later)

- Tables in the booking object: `comments`, `setlist_items` (per event, fractional position keys so a move touches one row), `checklist_items`, `schedule_items`.
- **Live updates:** the booking object keeps WebSocket connections to people viewing the gig (hibernating when idle) and broadcasts changes.
- **Offline on stage:** the PWA stores the setlists of upcoming gigs; edits made offline sync when back online (positions merge; conflicting text edits keep both).
- Songs start as text rows and link to the future music library module.

## 12. Migration and work plan

**Existing data:** prod has only test data, so the new design starts **empty on prod** (owner's default). User accounts stay; old workspace and gig tables are dropped by a migration. I'll confirm with the owner right before that migration runs on prod.

**Work plan** (each step shipped to dev, verified, then prod):

1. **Foundation:** Durable Object bindings, booking/person/index/pending objects with per-object migrations, idempotency and audit inside the booking, outbox → queue with alarms and retries, queue consumer with sequence numbers and a dead letter queue, flush and rebuild tools, deploy workflow creating the queues, test setup. No visible change; the current app keeps working.
2. **Gigs:** create gig with events, people and roles, client/venue snapshot from the address book, status, edit with version check, delete/cancel; permissions per section 3; API and MCP operations reworked (routes under `/api/gigs/:gig_id/...`).
3. **Money:** payments, expenses, lineup with shares per event, payouts, derived views; per-gig visibility settings.
4. **Home and reports** from person objects; Gigs list and search.
5. **Tags and autofill; people without accounts** (attach on sign-up); **duplicate warnings** via the month index.
6. **Screens** reworked throughout (Home, Gigs, gig page with events, address book, reports, settings), checked at 390 / 820 / 1280 px, light and dark.
7. **Retire workspaces** (code, tables, collective page) and drop old data on prod (with the owner's OK).
8. **Monitoring and alerts** (section 10a) grow with each step; the admin page lands with step 1's tools.
9. Later: collaboration (section 11), load test when the owner decides.

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

## 14. Resolved points

1. **Duplicate warnings** cover only gigs of people you've been on gigs with, showing their name.
2. **Wording:** people see "Gig", with "Events" inside (e.g. "Sangeet", "Reception").
3. **Delivery:** one path, outbox → Cloudflare Queue (no hybrid); the outbox guarantees nothing is lost, the queue delivers.
4. **Alerts:** email to a dedicated address.
