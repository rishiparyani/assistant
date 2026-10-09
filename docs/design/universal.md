# Design: a universal assistant (spaces, collections, rules, chat)

_Status: **draft for the owner's review** (2026-10-09; revised the same day: collaborators get only what's shared with them, plus reports; then: chat-centric, starter setup, model router, how setups are stored, search, per-person visibility and the fam jam test case). Nothing is built until the owner approves. Replaces the gig-specific app: nobody uses it yet, so there is no data to move (owner, 2026-10-09)._

## 1. Why change

Gigspree was built for gigs. The owner wants one assistant for **everything**: gigs, personal expenses, a dinner at 8 and the groceries for it, family notes. Gigs are just one of many things.

So the app stops knowing about gigs. Instead it gives people **building blocks**: collections with typed fields, links between records, calculated fields, rules, views and sharing. Anyone can build a workflow from them, by tapping or by chatting. "Gigs" becomes a **template** built from the same blocks, which anyone can install and change.

Four principles:

1. **Two kinds of people.** **Full users** (the owner for now) get everything: spaces, collections, rules, reports, AI. **Collaborators** (bandmates, family, venues) get only the specific things shared with them, like a shared note in a notes app, and a simple screen to work on them. Collaborating is free; full features and AI can be offered to them later (section 8).
2. **Rules belong to the user, not the code.** Checks, status flows, automations and permissions are data the user creates. The code only runs them.
3. **Money and permissions stay trustworthy.** Money is exact (integer paise), can be protected (add-only, corrected by reversing), and every change is audited.
4. **Chat-centric.** The chat is the home screen and the main way to do things; screens and views open from it. Every action also has a normal screen (collaborators, and days when the AI allowance is used up).

## 2. Concepts (what people see)

| Concept             | What it is                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space**           | A full user's place where things live: _Personal_, _Band_, _Family_. Everything belongs to exactly one space. Only full users have spaces.                                                   |
| **Collaborator**    | Someone you shared a specific thing with. They see only that thing (and the parts of it you chose), in a simple card screen. No collections, reports, rules or AI of their own.              |
| **Collection**      | A kind of thing, like a table: _Gigs_, _Expenses_, _Dinners_, _Groceries_. Has fields.                                                                                                       |
| **Field**           | A typed column: text, long text, number, **money**, date, date and time, yes/no, choice, multiple choice, person, **link**, file (later), **formula**, **rollup**.                           |
| **Record**          | One thing in a collection: "Sunburn gig", "Dinner with Ananya".                                                                                                                              |
| **Link**            | A field that points to records in another (or the same) collection. See section 3.                                                                                                           |
| **Formula**         | A calculated, read-only field, e.g. `Fee - Paid`. Written in a small safe formula language, never code.                                                                                      |
| **Rollup**          | A total over linked records, e.g. "Paid = sum of Amount over linked Payments", "Rehearsals = count of linked Rehearsals".                                                                    |
| **Check**           | A condition a record must meet to be saved, e.g. "Amount > 0", "Rehearsal date is before its gig's date", or a uniqueness rule: "only one Selected per Song and Instrument".                 |
| **Status flow**     | Allowed moves for a choice field: Enquiry → Confirmed → Played, or → Cancelled. Each move can require conditions and can trigger automations.                                                |
| **Automation**      | _When_ something happens (record added, field changed, status moved, a date is near), _then_ do something (notify, create a record, set a field, remind).                                    |
| **View**            | A saved way to look at records: table, list, calendar, board, chart, single card. Keeps its filter, sort and grouping. Can be pinned.                                                        |
| **Share**           | Gives a collaborator one card (a record and the linked parts you include), a view or a form, with _view_, _comment_, _edit_ or _fill in_ access and a choice of visible and editable fields. |
| **Form**            | A share link that lets people add records to a collection, like a Google Form.                                                                                                               |
| **Chat**            | The full user's conversation with the assistant (the home screen). Collaborators talk on the shared card itself (comments).                                                                  |
| **Report**          | A view or summary sent out on a schedule or on demand: to Telegram, by email, or as a live link (e.g. "Upcoming gigs, every Monday, to the band's Telegram group").                          |
| **Join link**       | One link many people use to join a shared list or form, each signing in once as themselves. The owner sees who joined.                                                                       |
| **Visibility rule** | Which rows each collaborator sees, e.g. "people see Songs where _Visible to_ includes them or their group". Applied by the app, so hidden rows never reach their device.                     |
| **Personal answer** | A field each collaborator fills in for themselves on a shared row ("I'll play guitar"), like a vote. Private to that person and the owner unless the owner shares it.                        |
| **Starter setup**   | What every new full user gets: _Notes_, _Reminders_, _Events_ and _Expenses_, enough for everyday requests without building anything.                                                        |
| **Template**        | A ready-made set of collections, fields, rules and views (e.g. _Gigs_, _Expenses_, _Groceries_). Installing one copies it into a space, where it can be changed freely.                      |

## 3. Links between records (relations)

A **link field** connects records. It covers the cases the owner asked about, for example a rehearsal linked to a gig, or groceries linked to a dinner.

- **Both directions.** Adding a _Gig_ link on Rehearsals automatically shows a _Rehearsals_ list on each gig. Change it on either side and both update.
- **One or many.** A link can allow one record (a rehearsal belongs to one gig) or many (a dinner has many grocery items; a person plays in many gigs).
- **Any collection, or "anything".** A link can be limited to one collection (only Gigs) or open to any record (a note can be linked to a gig, a dinner or a person).
- **Optional or required.** "Not for a gig" is just an empty link; a required link must be filled.
- **Used by rules.** Rollups total over links ("Paid = sum of linked Payments"). Checks can read linked fields ("Rehearsal date is before Gig date"). Formulas can use them (`Gig.Date - 2 days`).
- **When the other side is deleted.** Each link chooses: _unlink_ (default), _block the delete_ while links exist, or _delete with it_ (e.g. a gig's payments).
- **By chat.** "Link this rehearsal to the Sunburn gig." If two gigs match, the assistant asks which one; it never guesses.
- **Suggested links.** When you add "buy groceries" near "dinner at 8", the assistant can suggest the link; you confirm it.

Example, the owner's rehearsal: _Rehearsals_ has a link field **Gig** (one, optional, any record in _Gigs_). The Sunburn gig then shows "Rehearsals: 2". A check "Date before Gig.Date" stops a rehearsal being set after the show.

## 4. How setups are stored and run

A **setup** is the collections, fields, rules and views for one workflow. Setups are **data, not code**: one engine reads them and follows them, the way a spreadsheet follows the formulas you typed.

**In each space's database**

- The shape: `collections`, `fields` (type and options: choices, link target, formula text and its parsed form, required, default), `rules` (kind: check, status flow, automation, permission or visibility; a validated definition; on/off), `views` (saved filter, sort, grouping, layout).
- The data: `records` (values keyed by **field id**, so renames break nothing), `record_values` (each value copied into a typed, indexed column for fast filters, sorts and totals), `links` (both directions), money entries (add-only for protected money), `responses` (personal answers: record, field, person, value) and the history.

**Every write follows the same steps**, whatever the setup: check types → calculate formulas → run checks, uniqueness and the status flow → check permissions and visibility → save in one transaction and update totals on linked records → history → after commit, automations, search indexing and notifications through the outbox and queue. Reads turn a view's saved filter, plus the reader's visibility rules, into a query over the index table.

**Rules are small validated definitions** with a tiny formula language (`Amount > 0`, `Fee - Paid`, `Gig.Date - 2 days`), never code: no `eval`, no network, bounded run time. Example, an Expenses setup:

```
Collection: Expenses
Fields:     Date (date, required) · Amount (money, required) · Category (choice: Food, Travel, Gear)
            · For (link → any record, optional)
Check:      Amount > 0 — "Amount must be more than zero"
Automation: when a record is added with Amount > 5000 → notify me "Big expense: {Amount} on {Category}"
View:       "This month" — table, Date in this month, newest first, total of Amount
```

**Changing a setup is safe:** adding a field is instant; changing a type shows a preview of what converts; removing a field hides it first (undoable); formulas recalculate in the background. Limits stop runaway setups (fields per collection, automation chain depth, formula run time).

**There is a fixed, small set of blocks** (about 14 field types and 5 rule kinds), each built and tested once. Variety comes from combining them. When a real workflow needs something the blocks can't express, a new **generic** block is added, never workflow-specific code.

## 5. Test case: fam jam sign-ups

The finished system must run this workflow end to end, built by chat ("help me run fam jam sign-ups").

1. **Setup:** _Songs_ (Title, Artist, Key, Parts needed, **Visible to**: people or groups, empty = everyone) and _Sign-ups_ (link Song, Person, Instrument, Status: Requested → Selected / Not this time).
2. **Join link:** the organizer sends one link to 40–50 people on WhatsApp. Each opens it in a browser, signs in once, and appears in "Joined: 47".
3. **Per-person visibility:** "hide songs 1–40 from Rahul", "only guitarists see these 30". Each person sees only their songs; hidden ones never reach their phone.
4. **Personal answers:** each person marks which instrument they'll play on which songs. Their answers are private to them and the organizer.
5. **Consolidating:** a board grouped by Song → Instrument shows who asked. The organizer taps one person → Selected; the uniqueness rule keeps one guitarist per song ("Replace Rahul with Dev?"); others become "Not this time". A view shows songs still missing a player.
6. **Results:** an automation tells each selected person, and the final list (who plays what) goes out as a live link and to Telegram.

The organizer is a full user; participants are free collaborators. Fifty people at once go through the one space object, which applies visibility before anything is returned.

## 6. How the Gigs template is built from the blocks

Everything the current gig app does becomes data, not code:

| Today (code)                      | In the template (blocks)                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Gig with fee, client, status      | _Gigs_ collection: Title, Client (link to Contacts), Fee (money), Status (choice with a status flow)                      |
| Events (shows, rehearsals, holds) | _Events_ collection linked to Gigs; Kind (show / rehearsal / hold); check "a gig needs at least one show to be confirmed" |
| Lineup, shares, payouts           | _Lineup_ (link Gig + Person, Share); _Payouts_ (protected money, link Person + Gig); rollups for "owed"                   |
| Payments received                 | _Payments_ (protected money, link Gig); rollup "Paid", formula "Balance = Fee - Paid"                                     |
| Players don't see the fee         | The gig is shared with players without the Fee field; each player's share is in their own card                            |
| Guest list and venue page         | _Guests_ collection with Arrived count; a share link to a view with "edit Arrived only"                                   |
| Notifications                     | Automations: "when Status moves to Confirmed, tell everyone in the Lineup on Telegram"                                    |
| Confirm with date options         | Status flow condition: "to confirm, keep at least one hold" with an automation that removes the others                    |

The template is checked against the current app's tests: if a behaviour can't be built from blocks, the blocks are missing something, and that is fixed in the engine (not with gig-only code).

## 7. Chat and the assistant

- **Chat is the home screen.** Your chat with the assistant opens first; your spaces and pinned views are one tap away.
- **Pop-up views.** "Show my calendar" opens a panel (a sheet on phones, a side panel on wide screens). It can be closed, minimised to a chip above the message box, or **pinned** to the shortcuts bar with its filter.
- **Everything has a screen too.** Collections, records, views and settings are normal screens. The assistant uses the same actions.
- **Safe actions only.** The assistant gets structured tools (find, filter, total, add, change, link, create collection, add field, add rule), never raw database access. Text in records is data, never instructions.
- **Confirmation.** Deletes, money changes and new rules are shown first in plain words ("When a gig moves to Confirmed → notify everyone in its lineup") and applied only after you agree.
- **Ambiguity.** If a name matches more than one record, the assistant asks; it never guesses on a write.
- **Search everything you can see.** Records, notes, chats with the assistant and comments on shared cards, across your spaces and what's shared with you, never beyond your access.
  - **By meaning** ("how did we decide to pay for the studio?" finds "we'll split the studio cost equally"): each item gets an embedding from Cloudflare Workers AI after it's written, stored in Cloudflare Vectorize with its space, place and date.
  - **By exact words** (names, amounts) from a word index inside each space.
  - Filters for time ("last month") and place ("in the band"). The assistant answers with the source ("On 12 Sep, in the Sunburn gig's comments, Rahul said… [open]").
- **Starter setup first.** Simple requests ("remind me at 6", "note that…", "spent ₹450 on groceries") use the starter setup. Complex ones make the assistant propose a new setup in plain words; it's created only after you approve.
- **Only full users chat with the assistant.** Collaborators work on shared cards and see comments; they never see the chat.

### AI providers and cost

AI is only for full users. At first that's only the owner, so the free tiers below are plenty. Later a collaborator can become a full user (monthly or prepaid credits; needs a payment gateway such as Razorpay), and anyone can connect their own Claude or ChatGPT (as today, through `/mcp`) at no cost to the owner.

The app talks to AI through a **model router** with a daily budget per person:

- **Sort each request first.** Quick everyday requests go to a fast free model; **setup work** (designing collections, rules, views) goes to the strongest model available.
- **Check, then step up.** Everything the AI proposes is validated by the app (fields exist, formulas parse, rules are allowed). If validation fails, the router retries on a stronger model before showing anything.
- **Providers, free first:** OpenRouter free models (about 1,000 requests a day after a one-time 10-credit purchase, roughly ₹850), Cloudflare Workers AI (10,000 neurons a day; also search embeddings) and Groq (free daily token caps per model), with automatic fallback when one is busy.
- **Free only to start.** A paid model can be switched on later in settings, for setup work only and with a monthly cap; no code change.

When the day's allowance is used up, the assistant says so and the normal screens keep working. Limits come from providers' current published terms and change often; they are checked again before building.

## 8. Collaborators and sharing

Like sharing one note from a notes app: the other person works on **that note**, not on your whole app.

**What you share**

- **A card:** one record, plus the linked parts you choose. Share the Sunburn gig with the band and include its rehearsals, set list and guest list, but not its payments.
- **A view:** e.g. "Band calendar, November", which updates live.
- **A form:** collaborators add records to one collection ("Availability for December", "Expense claim"), like a Google Form.

- **A join link:** one link many people use to join a shared list or form, each signing in once as themselves (fam jam, section 5).

**What they can do**, set per share:

- _View_, _comment_, _edit_ or _fill in_.
- **Which fields** they see (hide Fee) and which they can change (only Arrived on the guest list, only their own availability).
- **Which rows** they see: visibility rules per person or group ("Rahul doesn't see songs 1–40").
- **Personal answers:** fields each person fills in for themselves on shared rows, private to them and the owner.
- Link-only access (no account) for viewing and forms; a quick sign-in (Google or passkey) to edit or comment, so the history shows who did what.

**What they get:** a simple "Shared with me" screen with their cards, comments and notifications. No spaces, collections, rules, reports across records or AI. They can't combine two gigs into a report; you can, and you can **send them reports**.

**Reports you send them**

- **Telegram:** a bot posts to a person or a group ("Upcoming gigs this week", "Who still owes me"), on a schedule or when something changes (an automation).
- **Email**, and a **live link** to a read-only report page.
- Reports show only the fields you chose, like shares.

**Control:** shares can expire, be turned off or reset at any time; only a hash of each link is stored; every change a collaborator makes is in the history.

**Later: upgrading a collaborator.** You can make someone a full user (their own spaces, reports, AI), paid by you or by them. Their existing shares keep working.

## 9. Storage and architecture (for agents)

Same stack: Cloudflare Workers, Durable Objects, D1, Svelte, Capacitor for iPhone.

- **D1** keeps identity (Better Auth), which users are full users, the list of spaces, share hashes and admin tables only.
- **One Durable Object per space** (SQLite) holds the space's collections, fields, records, links, rules, views, chats index, audit log and idempotency keys. One space is one unit of consistency, so rules, rollups and checks run inside one transaction.
  - `records (id, collection_id, values_json, created_*, updated_*, deleted_at)`
  - `record_values (record_id, field_id, num, text, date)` with indexes, for filtering and sorting without scanning (rule 12).
  - `links (field_id, from_id, to_id)` indexed both ways.
- **One Durable Object per chat** for the assistant conversation, and comments live with the record they belong to.
- **One Durable Object per person** for "my things across spaces": calendar, reminders, notifications, AI allowance, and for collaborators their "Shared with me" list.
- **Shares** are checked inside the space object on every read and write: a collaborator's request only reaches the shared record, its included linked records, the rows their visibility rules allow and the allowed fields; anything else is 404. Personal answers are stored per person (`responses`) and returned only to that person and the owner.
- **Reports** are views rendered by the space object and delivered by the queue (Telegram bot, email), with the same field limits as shares.
- **Search:** Cloudflare Vectorize for meaning (embeddings from Workers AI, tagged with space, place and date so results are filtered to what the person can see), plus word indexes in each space. Indexing goes through the outbox and queue.
- **Why Durable Objects and not a wide-column store like Cassandra:** this app needs transactions across a record, its links and its totals, ad-hoc filters and reports, all of which SQLite does well inside one object per space; flexible fields come from values stored by field id plus the typed index table. Cassandra suits huge write volumes across many servers but is poor at ad-hoc queries and joins, and isn't on Cloudflare.
- **Automations** run after the write commits, through the outbox and queue, with a depth limit (an automation can't trigger itself forever) and a per-space daily limit.
- **Formulas** are parsed into a small expression tree and evaluated in the space object; no `eval`, no network, bounded time.
- **Kept from today:** sign-in and passkeys, the operation registry (one definition → screen API, MCP tool and assistant tool), idempotency and audit, the outbox, offline outbox and appliers, live updates, the UI kit (sheets, tabs, swipe), notifications, backups, the iPhone shell, deploys.
- **Removed once the Gigs template passes:** the gigs and music modules' own objects and screens.

### Offline

The app opens offline; pinned views and upcoming records are saved ahead. Record changes go through the offline outbox and sync later. Chat with the assistant needs a connection; comments queue and sync later.

## 10. Rules that change (AGENTS.md)

These need the owner's OK and a decision entry:

- "Don't build an in-app AI assistant" → **the in-app assistant is allowed**, with per-person allowances, structured tools only, confirmation for deletes, money and rules.
- "Gig-centric: a Durable Object per gig" → **space-centric**: a Durable Object per space, per chat and per person.
- "Collective is a tag, no workspaces" → **spaces belong to full users**; others collaborate through **shares** of specific things.
- Money, idempotency, audit, soft delete, ULIDs, no fuzzy writes, offline-first and "no raw SQL for the AI" **stay** as they are.

## 11. Build stages

Each stage ships something usable.

1. **Core with chat.** Chat home with the assistant (model router on free tiers), the starter setup, spaces, collections and fields, records, links, list/table/card views, pop-up and pinned views. The assistant creates and finds things for you.
2. **Sharing.** Cards, views and forms; join links; field and row visibility; personal answers; the collaborators' "Shared with me" screen; comments.
3. **Search.** By words and by meaning across records, chats and comments.
4. **Calculated fields and rules.** Formulas, rollups, checks (including uniqueness), status flows, permissions, protected money; the pick board. Fam jam test passes.
5. **Automations and reports.** Notifications, reminders, scheduled reports to Telegram, email and live links, set up by chat.
6. **The Gigs template.** Rebuild gigs from blocks, pass the current behaviour checks, then remove the old gig code.
7. **Full users beyond the owner.** Upgrading collaborators; later, paid plans. Telegram as a second way to chat (nice to have).

## 12. Decided and open

Decided by the owner (2026-10-09): chat-centric; starter setup plus setups built by chat; free models first with a router; AI providers raise no extra privacy rule while only the owner uses AI; reports configured by chat (Telegram or email); Telegram chat is nice to have, after the main app; no WhatsApp automation (against WhatsApp's terms).

Open: sharing templates between full users (later).
