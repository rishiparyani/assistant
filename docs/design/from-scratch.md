# From scratch: the agreed shape of the app (2026-10-24)

**Status: approved by the owner on 2026-10-24** ("I'm good with your idea… This is good what you've decided"). This document is the handover from the session that designed it. **It is the brief; do not reinterpret it.** Where it is silent, keep the current app's behaviour and ask the owner, in plain words, before inventing anything. The clickable prototype that the owner approved is a private Claude artifact (https://claude.ai/artifact/69Zx2Vs6uJmPZyemZiJtEB); this document carries everything in it.

This builds on [home-first.md](home-first.md) and [universal.md](universal.md); it does not replace the rules in `AGENTS.md`. It changes the home, the navigation, the words, and the order of work. The current app is close: most pieces exist, and the work is to rearrange them, not to rebuild.

## 1. Six words, and one word kept out

Everything people see uses six nouns, in the app's copy and in the assistant's replies:

| Word         | Meaning                                                                                                                                                                               | Today in code                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Space**    | A set of people and what they share. Society, Fam Jam, Gigs, Personal.                                                                                                                | `spaces`, `SpaceObject`; a chat's space ("chat homes")           |
| **Chat**     | A space's one conversation. Not a separate thing. A one-to-one chat is a space of two; Personal's chat is the private assistant chat.                                                 | `GroupObject`, `ChatObject`                                      |
| **List**     | Things of one kind: Songs, Visitor requests, Bills.                                                                                                                                   | collections                                                      |
| **Workflow** | What happens by itself.                                                                                                                                                               | workflows (processes)                                            |
| **Screen**   | An arrangement of blocks for using what is in a space. A form, a report, a tally, a board. A screen belongs to a space (its main screen) or to a list (how that list's records open). | views, cards, forms; the saved arrangement of blocks is new (§5) |
| **Setup**    | A bundle of lists, workflows, screens and roles that a new space can start from, or be handed to someone else.                                                                        | templates / "setups" in the assistant's instructions             |

**The word "app" stays out of the product.** The app is the app; inside it people make spaces, lists, workflows and screens. "Dashboard" is not used either: a dashboard is a screen.

A record is a list item. "Complex" items (an event's Set 2 with thirty musicians and a hundred songs linked) are items with more links and a screen on their list. Nothing else.

## 2. The rules the whole design keeps

1. **Chat makes, screens use** (unchanged from `AGENTS.md`).
2. **Today, not a home of cards.** The first screen is sorted by what needs you: questions and forms first, then what is coming up (records with a date, across spaces), then your chats, then your spaces. Nobody arranges it, so it can never go blank. Today is always everything; a space's own Today is its space page (same sections, scoped).
3. **One composer, on every screen, and it is the chat.** The bar at the bottom follows you; tapping it raises the conversation as a sheet over what you are looking at, already about it (the "About: X" chip, tappable away). No separate chat screen; no floating button once this lands (the floating button of 2026-10-24 is the interim).
4. **A space is its people, its lists, its workflows, its screens and its chat.** Making a group chat makes a space; making a space with people makes its chat. Membership is decided once. Roles (admin, resident, guard) and row rules decide who sees and does what inside a space.
5. **The group chat is the product.** Every message can become a thing (a complaint, a reminder, an expense); every thing can report back into the chat (a workflow's question lands inline, with buttons only for the person it is for and the outcome for everyone). Build the parts of chat that make messages actionable; **do not build** the messaging-app long tail: media galleries, stickers, calls, read receipts, end-to-end encryption.
6. **Photos are input, not content.** A photo of a notice, a bill, a visitor's ID, a screenshot: posted in the chat, read by the assistant, the action offered under it. Tapping a photo shows it. No editing, no gallery.
7. **Nothing stacks.** Screens push with a back arrow. Only two things are sheets: a record and the chat. A sheet never opens over a sheet.
8. **Workflows are always drawn.** The diagram is the workflow; field names read as names (never `{braces}`). "Try it" plays a practice run; "Change it" goes to the chat.
9. **Rehearse is "the whole app as that person".** The owner on the prototype's View-as switch: "that is exactly what I wanted the rehearse to be." Rehearsing a space means the app itself, every screen of it (Today, the space, its chat, its lists, records, screens), rendered as one of its people inside a practice copy, with a banner ("Practising as Priya · Switch · Done") and nothing else different. No separate practice screen with its own cards. Switching person switches the whole app; Done returns to yourself and the real space. A workflow's run can additionally be read as a story (person by person, answer at your line) from the workflow's page; that is the walkthrough, not the rehearsal. Nothing in a practice copy reaches anyone.
10. **Every thing has a thread.** A record's page carries the conversation about it, its status, and what the workflow did. Replying there goes to everyone in the space.
11. **Screens are arrangements of blocks, never free HTML.** The blocks are a fixed set the app owns (§5). The chat arranges them; the screens then work with no chat and no connection.
12. **AI is a layer, never a gate.** Three levels: _Use_ (open, answer, tick, add through a form, post a photo, see your set) works for everyone, always, offline. _Make_ (a list, a workflow, a screen) is done in the chat by whoever has AI; plain screens remain as the fallback. _Think for you_ (suggestions under messages, the catch-up card, reading a photo, Jev's picks inside a workflow) is the only part that costs, and **the space pays, not the reader**: in-space AI is charged to the space owner's balance; a person's own private assistant is charged to them. Someone with no plan never meets a wall inside a space they were invited to.
13. **Visual language.** Warm paper ground, ink text, one accent for anything that acts, amber only for what waits on you, green only for done. Headlines in a condensed grotesque so titles fit one line; a quiet humanist face for everything else. Tap targets ≥ 44 px, body text 15 px. (The prototype used Bricolage Grotesque + Figtree and a sea-green accent; the real app keeps its theme tokens and can adopt these in a theme PR, not piecemeal.)
14. **No band or gig words** in the app's own copy (unchanged). The owner's spaces may be called whatever they like.

## 3. Screens, one by one

- **Today**: date and greeting; a switcher row (§4); _Needs you_ (open questions and forms for me, inline buttons); _Up next_ (records with a date in the next 7 days, across spaces, each opening its record); _Chats_ (by activity, unread counts); _Spaces_. The composer at the bottom. The avatar button opens "View as" (people the owner can impersonate in practice only; in the real app this is the practice screen's switcher, not a global feature).
- **Space**: name; _Needs you here_; _Up next here_; _Chat_ row; _Lists_ (new ones are made in the chat); _Workflows_; _People_ with roles (changed in the chat). A space with a main screen opens on it (Gigs opens on the gig manager).
- **List**: title, count, filter chips from saved views, rows; a tap opens the record (never the chat); a "+ Add" button opens the Form block, which works offline ("saves on your phone and syncs later").
- **Record**: title, status pill, fields, actions (Approve/Reject for a waiting question, Mark fixed, Mark paid, Ask about it), _What the workflow did_, _Thread_. Drawn through its list's screen when the list has one; otherwise this plain page.
- **Workflow**: the diagram; Try it; Change it in the chat; _What happened_.
- **Rehearse (view as)**: the same app, as the chosen person, in a practice copy; a banner at the top with Switch and Done; the composer says when that person has no assistant. Everything they can see and do is exactly what they would see and do.
- **Walkthrough (story)**: from a workflow's page: beats per person; buttons where it is my line; the ending.
- **Group chat**: _While you were away_ catch-up card at the top (three lines, the actions pulled out, what waits on me first); messages; a suggestion under a message ("Add to Complaints · Jev 92%", "Not that"); photos with the suggestion read from them; workflow question and outcome cards inline; an expense split card ("You owe Dev ₹129 · Settle"); "This keeps happening" offer to make a workflow; the composer with "To everyone" and "Ask the assistant privately" (the latter absent for people with no plan).
- **Chat sheet (the assistant)**: context chip, messages, live cards, action pills; opens over any screen from the composer.
- **A space's main screen made of blocks (the gig manager)**: a "Made of N blocks in the chat · works offline" line with "Change it"; stat tiles; a segmented switch (Upcoming / Payments / Report); rows; a "+ Add" form; a record page with the Money block and the Activity block.
- **A list's screen for its records (the event's Sets)**: the record's fields first, then the blocks: tiles (marked 22/30, songs covered, clashes), the workflow's nudge card, the compiled grid (song × part, names in cells, clashes in amber, gaps marked), "Assign the clashes" (the assistant proposes a spread; the person confirms each), _Who sees what_ (the row rules), the chat row. The same list shows a different screen to another role (a musician: her songs only, chips per song to mark, her own set afterwards in stage mode, offline).

## 4. The space switcher

The row under the greeting is not a filter people need; it is a shortcut. It shows **Everything**, then the **three spaces used most recently**, then **More · N**. More opens a picker: every space with a one-line description, a search field, ordered by last use. Using a space moves it to the front. The row never grows.

## 5. Blocks

A fixed set, owned by the app, each a React Native component with a small JSON spec, each reading live data through the existing query/card machinery, each working offline from the saved copy:

stat tiles · next-up · list (rows, with the row layouts that exist) · form (add a record; offline through the outbox) · money table · activity (timeline) · report (a query rendered as table or bar, as today) · diagram (a workflow) · compiled grid (a pivot of personal answers: rows = records, columns = parts/choices, cells = who) · progress · segmented switch (tabs inside a screen) · button (runs one operation from the registry, with confirmation where the rules require it) · text.

A **screen** is a saved, ordered arrangement of blocks with their specs, attached to a space (main screen) or to a list (record screen), optionally per role. The assistant makes and changes screens through operations (preview → confirm, like every setup). **No block renders arbitrary HTML or runs code.** New block kinds are added by hand, with a decision.

## 6. What exists and what is new

| Piece                                                                                                            | State                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spaces, collections, records, links, views, formulas, rollups, query engine                                      | exists                                                                                                                                                   |
| Row visibility rules, personal fields (answers per person), roles, shares, forms                                 | exists                                                                                                                                                   |
| Workflows with Ask/Tell/Choose/If/Wait, nudges, practice copies, the flow diagram                                | exists (diagram since HF125)                                                                                                                             |
| Group chats with a space behind each, "save a message", polls, questions that act                                | exists                                                                                                                                                   |
| Jev for Choose steps and suggested actions (owners only, no cap)                                                 | exists (HF127)                                                                                                                                           |
| Offline outbox, saved copies, stage mode                                                                         | exists                                                                                                                                                   |
| Record sheet with fields and "Ask about it"                                                                      | exists (HF128)                                                                                                                                           |
| Rehearse as "the whole app as that person" (banner, Switch, Done) replacing the practice screen's own cards      | **new**; the practice copy, the stand-ins and "as" views exist (HF66, HF67, HF103, HF123–HF130); the change is to render the real screens as that person |
| Today as the first screen (needs you / up next / chats / spaces) replacing the arranged home                     | **new**                                                                                                                                                  |
| Composer on every screen that raises the chat as a sheet; retire the floating button and the separate chat route | **new**                                                                                                                                                  |
| Space page with scoped Needs you / Up next; chat shown as part of the space                                      | **new** (mostly framing: chat homes exist)                                                                                                               |
| Workflow cards inline in the group chat (question with buttons for its person, outcome for all)                  | **new**                                                                                                                                                  |
| Suggestion under a message, one tap, "Not that"                                                                  | **new** (today a separate suggestion flow)                                                                                                               |
| Photos in group messages: resized, stored, read by the assistant, suggestion under                               | **new**; needs a store (Cloudflare R2 free tier) → a decision from the owner                                                                             |
| While you were away (catch-up card)                                                                              | **new**                                                                                                                                                  |
| Record page with its thread (threads on records)                                                                 | **new** (reuses "chat about this record")                                                                                                                |
| Expense split from a message                                                                                     | **new** (reuses the money model: transactions, derived balances)                                                                                         |
| "This keeps happening" (the assistant offers a workflow from repeated messages)                                  | **new**                                                                                                                                                  |
| Screens as saved arrangements of blocks; the assistant's operations to make/change them; block kinds in §5       | **new** (the custom-UI piece)                                                                                                                            |
| Compiled grid block; "propose a spread" as a reusable Choose step with Jev                                       | **new**                                                                                                                                                  |
| The space switcher (recent 3 + More)                                                                             | **new**                                                                                                                                                  |
| In-space AI charged to the space owner's balance                                                                 | **new** (budget objects exist per person; this is routing)                                                                                               |
| Setups: a space bundled and started from (lists, workflows, screens, roles)                                      | partly (templates exist for setups); screens to be included                                                                                              |

## 7. Build order

One PR at a time, each verified on the built site at 390 light/dark (and 1280), each with its STATUS entry, following the process in `tasks/STATUS.md` → "Handover". Order chosen so each step is useful on its own and the risky ones come last:

1. **Today** replaces the arranged home: Needs you, Up next (dated records across spaces), Chats, Spaces; the switcher (recent 3 + More). The arranged pages and the library's "Add to home" go away; cards remain as blocks on screens. This also removes the blank-home class of bug (HF132 is the stopgap).
2. **Composer everywhere, chat as a sheet** over the current screen with the About chip; retire `ChatFab` and the separate `/chat` route on the phone (the wide-window panel stays). "Nothing stacks": audit every `router.push` of a modal.
3. **Rehearse = view the app as a person.** Entering a practice copy switches the whole app to that person (every screen reads as them, through their shares, roles and row rules), under a banner with Switch and Done; the practice screen's own cards and "Your notifications" go. The walkthrough story stays on the workflow page. Reuses the "as" machinery that exists.
4. **Space page** with scoped sections and the chat as its first row; the people chat screen and the space become one place.
5. **Group chat, actionable**: workflow question/outcome cards inline; the suggestion under a message with "Not that"; the catch-up card. In-space AI charged to the space owner (decision below).
6. **Threads on records**: the record page with its thread; the "Chat about this record" share becomes the thread.
7. **Photos as input**: after the owner's R2 decision. Resize on upload, store, read with the free vision route first and the Careful route when confidence is low, suggestion under.
8. **Screens from blocks**: the screen format, the first block kinds (stat tiles, list, form, money, activity, report, diagram, button, text), operations to make/change a screen, a space's main screen and a list's record screen, per role. The gig manager rebuilt as the Gigs space's main screen is the acceptance test.
9. **Event blocks**: compiled grid, progress, "propose a spread" step; the Event setup; the Fam Jam case end to end, with a musician who has no AI plan.
10. **Expense split from a message**; **"This keeps happening"**; **setups including screens**.

Not in this order and not to be started without the owner: a visual theme change (§2.13), caps and who gets Jev when the app opens to others, Jev pinned to a version.

## 8. Don'ts for whoever builds this

- Don't rebuild the app. Rearrange it. The data engine, the objects, the offline layer and the operation registry stay.
- Don't add a messaging long tail (stickers, galleries, calls, read receipts, E2E).
- Don't let the assistant or anyone produce free HTML or code for screens. Blocks only (§5).
- Don't gate anything a collaborator needs on AI or a plan (§2.12).
- Don't use "app" or "dashboard" in copy. Six words (§1).
- Don't put an arranged, user-maintained home back.
- Don't pattern-parse messages to decide what they mean; the model decides, Jev picks among labels (unchanged rule).
- Don't start the photo store, a theme change, or billing changes without the owner's explicit OK (they are listed as decisions to take).

## 9. Decisions the owner still has to take

- **Photo store**: Cloudflare R2 free tier (10 GB) for photos posted in chats, resized on upload. New dependency → needs an OK.
- **In-space AI billing**: confirm "the space's owner pays for AI inside the space; a person's private assistant is on their own balance" (the owner agreed in conversation on 2026-10-24; record it formally when the first PR that charges this way goes up).
- **Theme**: adopt the prototype's palette and type, or keep the current indigo. Not urgent.
