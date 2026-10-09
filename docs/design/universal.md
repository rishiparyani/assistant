# Design: a universal assistant (spaces, collections, rules, chat)

_Status: **draft for the owner's review** (2026-10-09, complete version for approval; revised the same day: collaborators get only what's shared with them, plus reports; then: chat-centric, starter setup, model router, how setups are stored, search, per-person visibility and the fam jam test case). Nothing is built until the owner approves. Replaces the gig-specific app: nobody uses it yet, so there is no data to move (owner, 2026-10-09)._

## 1. Why change

Gigspree was built for gigs. The owner wants one assistant for **everything**: gigs, personal expenses, a dinner at 8 and the groceries for it, family notes. Gigs are just one of many things.

So the app stops knowing about gigs. Instead it gives people **building blocks**: collections with typed fields, links between records, calculated fields, rules, views and sharing. Anyone can build a workflow from them, by tapping or by chatting. "Gigs" becomes a **template** built from the same blocks, which anyone can install and change.

Four principles:

1. **Two kinds of people.** **Full users** (the owner for now) get everything: spaces, collections, rules, reports, AI. **Collaborators** (bandmates, family, venues) get only the specific things shared with them, like a shared note in a notes app, and a simple screen to work on them. Collaborating is free; full features and AI can be offered to them later (section 9).
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

## 6. Test case: a gig's guest list, built by chat

The old app's guest list, rebuilt by the chat from blocks, with no guest-list code:

| Behaviour                                                 | Blocks                                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Guests for a gig                                          | _Guests_: Name, Plus-ones, Note, link to Gig                                                                                                 |
| Each guest has a host                                     | **Host** (person) **defaulting to whoever adds the guest**                                                                                   |
| Heads                                                     | Formula `1 + Plus-ones`                                                                                                                      |
| Bandmates add and see only their guests; managers see all | Share with "add" rights and a visibility rule "rows where Host = me"                                                                         |
| Total and per-person limits                               | Gig fields _Guest limit_, _Per-person limit_; checks "total Heads for this gig ≤ Guest limit" and "my Heads for this gig ≤ Per-person limit" |
| List closes at a time                                     | Gig field _Closes at_; a check "only before Closes at" that applies to collaborators only                                                    |
| Groups arrive in parts                                    | _Arrived_ number shown as a − / + counter; check "Arrived ≤ Heads"; an **All in** button setting Arrived = Heads                             |
| Door page for the venue                                   | A share link to a view of the gig's guests: no account, only _Arrived_ editable, **door list** layout with search and big tap targets        |
| Print                                                     | Print or PDF any view                                                                                                                        |

Generic blocks this adds: default to the current person; checks scoped to certain people; filtered totals inside checks; time (`now`) in checks; counter display and action buttons; door-list layout and print/PDF for views.

## 7. How the Gigs template is built from the blocks

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

## 8. Chat and the assistant

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

### Model router

All AI goes through one **router**: our own code in the Worker (in the chat's object). It is not an AI and never interprets the user's words with patterns or rules (no regex "level 0"). It decides only facts: which level, which model, budgets, retries.

**Levels (models are a settings table, swapped without code changes):**

| Level       | For                                                                           | Initial model                                                                                           | Cost                   |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1. Everyday | Every message starts here: questions, add/find/update, reminders, small edits | GLM 4.7 Flash on Workers AI (free allowance); Claude Haiku 5.5 if it tests better and the budget allows | ₹0 to ~₹0.09 a message |
| 2. Smart    | Building or changing setups; tricky requests                                  | Kimi K2.6 on Workers AI                                                                                 | ~₹6 a big setup        |
| 3. Best     | When level 2's work fails the checks                                          | Claude Sonnet 5.5 (through AI Gateway)                                                                  | ~₹13 a big setup       |

**How a request is routed**

1. Level: "setup in progress" in this chat, or the user pressed **Think harder** → level 2; otherwise level 1.
2. Model within the level: the first enabled model with budget left (free allowance, person's limit, monthly cap, credit) that hasn't failed in the last few minutes.
3. Call through **Cloudflare AI Gateway** with only that level's tools.
4. The model answers, proposes actions, or calls **hand to the smart model** (with a reason).
   - Actions are **checked by the app** (fields exist, formulas parse, permissions, visibility); valid ones run or wait for confirmation (deletes, money, setups); results go back to the model (bounded steps).
   - **Hand over** → the chat is marked "setup in progress" and continues on level 2 with a short summary; level 2 calls **hand back** when the setup is approved and saved.
   - Provider error or timeout → next model at the same level.
5. **Automatic escalation:** two failed checks → next level up; failing at level 3 → the assistant says it couldn't, instead of doing it wrong.
6. Every call is logged: person, level, model, tokens, cost in ₹, time, escalations.

**How the line between everyday and setup is drawn:** by tools, not by guessing. Level 1 has only everyday tools (find, add, update, link, remind, search, show view) and the handover tool; it has no tools to create collections, fields, rules, automations, forms or shares, so those requests must be handed over. If level 1 answers "I can't" instead, the reply offers **Try with the smart model**. The model test measures how often level 1 hands over correctly; if it's poor, level 1 moves to a stronger model or gets a small sorting step.

**Keeping requests small:** short instructions; only the level's tools; recent messages plus a running summary; search results fetched on demand; cached repeated instructions where the provider discounts them.

**Language:** English screens; the assistant understands English and Hinglish (mixed Hindi-English as typed on WhatsApp).

### AI cost and limits

- **Cloudflare stays on the Free plan** (decision 2026-10-09): it stops at its free limits and can never bill. Paid AI is used only through **prepaid AI Gateway credit** (5% fee on purchases), with **auto top-up off**.
- **Budget: ₹2,000 a month** for all AI (owner, 2026-10-09). Enforced three ways: Cloudflare **spend limits** on the gateway (overall and per person, set a little below the loaded credit), the app's own monthly cap with a warning at 80%, and per-person limits. After the cap, everyday chat uses the free allowance only; setup work waits.
- **Free allowance first:** 10,000 neurons a day on Workers AI (resets 5:30 AM IST). On GLM 4.7 Flash that's roughly 110 typical messages a day, about 8–10 daily AI users; search embeddings cost almost nothing.
- **Expected spend:** about ₹300–800 a month for the owner, family and a few bandmates.
- **To confirm at setup:** that on the Free plan, usage beyond the free allowance is charged to the credit rather than blocked (the docs suggest so).
- **OpenRouter and other providers:** not needed now; the router can add them later as table entries.
- **Collaborators** never use AI. Anyone can still connect their own Claude or ChatGPT through `/mcp` at no cost to the owner.

### Model test

Before the router is final, run the test set through the candidate models and keep the results in the repo: the **fam jam setup**, the **gig workflow**, small setup changes, and a script of everyday and Hinglish requests. Measure: correct setups (pass the app's checks and do what was asked), correct handovers by level 1, cost per request, time. Re-run when prices or models change.

### Connectors

Like Claude's and ChatGPT's connectors: a **Connectors** page where a full user connects outside services (Gmail, Google Calendar, Drive, later others) with a one-time sign-in. Built on **MCP** where a service offers it; small built-in connectors otherwise (email forwarding, Telegram, calendar feeds). **Read-only by default**; anything that acts (sending an email, creating an event) is shown first and needs approval. Data from connectors is untrusted data, never instructions. Example: "check my bank emails this week and log the UPI payments" → the assistant proposes records → you confirm. Payments themselves are never made by the app; it can prepare a UPI pay link.

### Safeguards against runaway use

Per-person and per-link rate limits; a CPU limit per request; automation depth and daily limits; capped retries; a usage watchdog in the 15-minute health check that switches to **safe mode** (pause automations and background jobs) and alerts on Telegram; a kill switch. DDoS traffic is not billed by Cloudflare, and on the Free plan nothing is billed at all.

## 9. Collaborators and sharing

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

## 10. Storage and architecture (for agents)

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

## 11. Rules that change (AGENTS.md)

These need the owner's OK and a decision entry:

- "Don't build an in-app AI assistant" → **the in-app assistant is allowed**, with per-person allowances, structured tools only, confirmation for deletes, money and rules.
- "Gig-centric: a Durable Object per gig" → **space-centric**: a Durable Object per space, per chat and per person.
- "Collective is a tag, no workspaces" → **spaces belong to full users**; others collaborate through **shares** of specific things.
- Money, idempotency, audit, soft delete, ULIDs, no fuzzy writes, offline-first and "no raw SQL for the AI" **stay** as they are.

## 12. Build stages

Each stage ships something usable.

1. **Core with chat.** Chat home with the assistant (model router, free allowance first, model test), the starter setup, spaces, collections and fields, records, links, list/table/card views, pop-up and pinned views. The assistant creates and finds things for you.
2. **Sharing.** Cards, views and forms; join links; field and row visibility; personal answers; the collaborators' "Shared with me" screen; comments.
3. **iPhone widgets and App Intents.** Any pinned view as a home-screen or lock-screen widget (chosen in iOS's widget settings, keeps its filters; interactive: tick, mark done, count arrivals). App Intents expose actions to Siri, Shortcuts, Spotlight and the Action button ("Add expense", "Ask Gigspree…", "Show [view]", "Add to [list]"). Native Swift in `apps/ios`: the app saves view snapshots in shared App Group storage and widgets refresh from the server when iOS allows; views map to native widget layouts (list, number, progress, next item, mini calendar).
4. **Search.** By words and by meaning across records, chats and comments.
5. **Calculated fields and rules.** Formulas, rollups, checks (including uniqueness), status flows, permissions, protected money; the pick board; counters, action buttons, door-list layout and print. Fam jam and guest list tests pass.
6. **Automations, reports and connectors.** Notifications, reminders, scheduled reports to Telegram, email and live links, set up by chat; the Connectors page (Gmail, Calendar, Drive).
7. **The Gigs template.** Rebuild gigs from blocks, pass the current behaviour checks, then remove the old gig code.
8. **Full users beyond the owner.** Upgrading collaborators; later, paid plans.
9. **Later, if wanted:** in-app group chats (Band, Family) with the assistant on mention; Telegram as a second way to chat; Live Activities on gig days.

## 13. Decided and open

Decided by the owner (2026-10-09):

- A universal, **chat-centric** assistant; the gig-specific app is replaced **in place** at gigspree.in as the new one becomes usable (nobody uses it yet). The name stays **Gigspree** for now.
- Starter setup plus setups built by chat; collaborators get only what's shared with them; reports by chat to Telegram or email.
- **AI:** Cloudflare only (Workers AI and AI Gateway); Free plan; prepaid credit; **₹2,000 a month** cap; router with three levels and no rule-based message parsing; Kimi K2.6 for setups, Claude Sonnet 5.5 as backup, everyday on the free model unless the test favours Haiku 5.5.
- Connectors instead of "email in". English and Hinglish.
- iPhone widgets for any pinned view and App Intents (Siri, Shortcuts, Spotlight, Action button), right after core and sharing.
- Test cases the engine must pass: fam jam sign-ups and the gig guest list, both built by chat.
- No privacy rule for AI providers while only the owner uses AI. No WhatsApp automation (against WhatsApp's terms). In-app group chats later.

Open: sharing templates between full users (later).
