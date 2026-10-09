# Design: a universal assistant (spaces, collections, rules, chat)

_Status: **draft for the owner's review** (2026-10-09). Nothing is built until the owner approves. Replaces the gig-specific app: nobody uses it yet, so there is no data to move (owner, 2026-10-09)._

## 1. Why change

Gigspree was built for gigs. The owner wants one assistant for **everything**: gigs, personal expenses, a dinner at 8 and the groceries for it, family notes. Gigs are just one of many things.

So the app stops knowing about gigs. Instead it gives people **building blocks**: collections with typed fields, links between records, calculated fields, rules, views and sharing. Anyone can build a workflow from them, by tapping or by chatting. "Gigs" becomes a **template** built from the same blocks, which anyone can install and change.

Three principles:

1. **AI is optional.** Everything works with normal screens. The assistant presses the same buttons for you. People without AI can still collaborate fully.
2. **Rules belong to the user, not the code.** Checks, status flows, automations and permissions are data the user creates. The code only runs them.
3. **Money and permissions stay trustworthy.** Money is exact (integer paise), can be protected (add-only, corrected by reversing), and every change is audited.

## 2. Concepts (what people see)

| Concept         | What it is                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space**       | A place where things live, with its own members and chat: _Personal_ (just you), _Band_, _Family_. Everything belongs to exactly one space.                             |
| **Member**      | Someone in a space, with a role: _owner_, _editor_, _member_ or _viewer_. Roles decide what they can see and change (with per-collection and per-field rules on top).   |
| **Collection**  | A kind of thing, like a table: _Gigs_, _Expenses_, _Dinners_, _Groceries_. Has fields.                                                                                  |
| **Field**       | A typed column: text, long text, number, **money**, date, date and time, yes/no, choice, multiple choice, person, **link**, file (later), **formula**, **rollup**.      |
| **Record**      | One thing in a collection: "Sunburn gig", "Dinner with Ananya".                                                                                                         |
| **Link**        | A field that points to records in another (or the same) collection. See section 3.                                                                                      |
| **Formula**     | A calculated, read-only field, e.g. `Fee - Paid`. Written in a small safe formula language, never code.                                                                 |
| **Rollup**      | A total over linked records, e.g. "Paid = sum of Amount over linked Payments", "Rehearsals = count of linked Rehearsals".                                               |
| **Check**       | A condition a record must meet to be saved, e.g. "Amount > 0", "Rehearsal date is before its gig's date".                                                               |
| **Status flow** | Allowed moves for a choice field: Enquiry → Confirmed → Played, or → Cancelled. Each move can require conditions and can trigger automations.                           |
| **Automation**  | _When_ something happens (record added, field changed, status moved, a date is near), _then_ do something (notify, create a record, set a field, remind).               |
| **View**        | A saved way to look at records: table, list, calendar, board, chart, single card. Keeps its filter, sort and grouping. Can be pinned.                                   |
| **Share link**  | A link to a card (one record), a view or a form, with _view_, _comment_, _edit_ or _fill in_ access.                                                                    |
| **Form**        | A share link that lets people add records to a collection, like a Google Form.                                                                                          |
| **Chat**        | Each space has chats: your own chat with the assistant, and group chats with members. The assistant answers only people who have AI turned on.                          |
| **Template**    | A ready-made set of collections, fields, rules and views (e.g. _Gigs_, _Expenses_, _Groceries_). Installing one copies it into a space, where it can be changed freely. |

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

## 4. How the Gigs template is built from the blocks

Everything the current gig app does becomes data, not code:

| Today (code)                      | In the template (blocks)                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Gig with fee, client, status      | _Gigs_ collection: Title, Client (link to Contacts), Fee (money), Status (choice with a status flow)                      |
| Events (shows, rehearsals, holds) | _Events_ collection linked to Gigs; Kind (show / rehearsal / hold); check "a gig needs at least one show to be confirmed" |
| Lineup, shares, payouts           | _Lineup_ (link Gig + Person, Share); _Payouts_ (protected money, link Person + Gig); rollups for "owed"                   |
| Payments received                 | _Payments_ (protected money, link Gig); rollup "Paid", formula "Balance = Fee - Paid"                                     |
| Players don't see the fee         | Field permission on Fee: members can't see it, editors can                                                                |
| Guest list and venue page         | _Guests_ collection with Arrived count; a share link to a view with "edit Arrived only"                                   |
| Notifications                     | Automations: "when Status moves to Confirmed, notify everyone linked in Lineup"                                           |
| Confirm with date options         | Status flow condition: "to confirm, keep at least one hold" with an automation that removes the others                    |

The template is checked against the current app's tests: if a behaviour can't be built from blocks, the blocks are missing something, and that is fixed in the engine (not with gig-only code).

## 5. Chat and the assistant

- **Chat is the home screen.** Your personal chat with the assistant opens first; group chats are listed beside it.
- **Pop-up views.** "Show my calendar" opens a panel (a sheet on phones, a side panel on wide screens). It can be closed, minimised to a chip above the message box, or **pinned** to the shortcuts bar with its filter.
- **Everything has a screen too.** Collections, records, views and settings are normal screens. The assistant uses the same actions.
- **Safe actions only.** The assistant gets structured tools (find, filter, total, add, change, link, create collection, add field, add rule), never raw database access. Text in records is data, never instructions.
- **Confirmation.** Deletes, money changes and new rules are shown first in plain words ("When a gig moves to Confirmed → notify everyone in its lineup") and applied only after you agree.
- **Ambiguity.** If a name matches more than one record, the assistant asks; it never guesses on a write.
- **Search by meaning.** Records and chat messages are indexed for search by words and by meaning ("what did we decide about the dinner?").
- **Groups.** In a group chat, the assistant answers only when mentioned, and only for members with AI on. Others chat normally.

### AI providers and cost

AI is per person: **off** by default; the owner turns it on for someone with a daily allowance. Later, people can pay (monthly or prepaid credits; needs a payment gateway such as Razorpay). Anyone can also connect their own Claude or ChatGPT to the app (as today, through `/mcp`) at no cost to the owner.

The app talks to AI through one small router with a daily budget per person and per space:

1. **OpenRouter free models** as the main provider (about 1,000 requests a day after a one-time 10-credit purchase, roughly ₹850).
2. **Cloudflare Workers AI** (10,000 neurons a day free; also used for search embeddings) and **Groq** (free daily token caps per model) as backups when the main one is busy.
3. A paid model can be switched on later in settings; no code change.

When the day's allowance is used up, the assistant says so and the normal screens keep working. Limits come from providers' current published terms and change often; they are checked again before building.

## 6. Sharing without AI

- **Cards:** any record gets a share link with _view_, _comment_ or _edit_ access.
- **Views:** e.g. "Band calendar, November", read-only or editable.
- **Forms:** add records to a collection ("Availability for December", "Expense claim").
- **No account needed** to view or fill a form. Editing and commenting ask for a quick sign-in (Google or passkey), so the history shows who changed what.
- Links can expire, be turned off or reset. Only a hash of each link is stored.

## 7. Storage and architecture (for agents)

Same stack: Cloudflare Workers, Durable Objects, D1, Svelte, Capacitor for iPhone.

- **D1** keeps identity (Better Auth), the list of spaces and members, share-link hashes and admin tables only.
- **One Durable Object per space** (SQLite) holds the space's collections, fields, records, links, rules, views, chats index, audit log and idempotency keys. One space is one unit of consistency, so rules, rollups and checks run inside one transaction.
  - `records (id, collection_id, values_json, created_*, updated_*, deleted_at)`
  - `record_values (record_id, field_id, num, text, date)` with indexes, for filtering and sorting without scanning (rule 12).
  - `links (field_id, from_id, to_id)` indexed both ways.
- **One Durable Object per chat** for messages (a busy group chat never slows the space). Messages are kept in the chat; a short summary and the search index point back to it.
- **One Durable Object per person** for "my things across spaces": calendar, reminders, notifications, AI allowance.
- **Search:** Cloudflare Vectorize for meaning, plus word indexes in each space. Indexing goes through the outbox and queue.
- **Automations** run after the write commits, through the outbox and queue, with a depth limit (an automation can't trigger itself forever) and a per-space daily limit.
- **Formulas** are parsed into a small expression tree and evaluated in the space object; no `eval`, no network, bounded time.
- **Kept from today:** sign-in and passkeys, the operation registry (one definition → screen API, MCP tool and assistant tool), idempotency and audit, the outbox, offline outbox and appliers, live updates, the UI kit (sheets, tabs, swipe), notifications, backups, the iPhone shell, deploys.
- **Removed once the Gigs template passes:** the gigs and music modules' own objects and screens.

### Offline

The app opens offline; pinned views and upcoming records are saved ahead. Record changes go through the offline outbox and sync later. Chat with the assistant needs a connection; chatting with people queues messages.

## 8. Rules that change (AGENTS.md)

These need the owner's OK and a decision entry:

- "Don't build an in-app AI assistant" → **the in-app assistant is allowed**, with per-person allowances, structured tools only, confirmation for deletes, money and rules.
- "Gig-centric: a Durable Object per gig" → **space-centric**: a Durable Object per space, per chat and per person.
- "Collective is a tag, no workspaces" → **spaces with members** come back (bands, families).
- Money, idempotency, audit, soft delete, ULIDs, no fuzzy writes, offline-first and "no raw SQL for the AI" **stay** as they are.

## 9. Build stages

Each stage ships something usable.

1. **Core, no AI.** Spaces and members, collections and fields, records, links, table/list/card views, share links (cards, views, forms). You can track expenses and dinners and share a list with family.
2. **Chat with AI, for the owner.** Personal chat home, pop-up and pinned views, calendar view, search by words and meaning, the AI router on free tiers.
3. **Calculated fields and rules.** Formulas, rollups, checks, status flows, permissions on fields, protected money collections.
4. **Automations and group chats.** Automations with notifications and reminders; group chats with the assistant on mention.
5. **The Gigs template.** Rebuild gigs from blocks, pass the current behaviour checks, then remove the old gig code.
6. **AI for others.** Allowances given by the owner; later, paid plans.

## 10. Open questions for the owner

1. Is chat the home screen for everyone, or only for people with AI (others land on their spaces and views)?
2. Should templates be shareable between people (e.g. a bandmate installs your Gigs setup)?
3. Anything personal that must never go to an AI provider (e.g. a "private" flag on a collection)?
