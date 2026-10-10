# Design: chat first (memory, live cards, workflows, group chats)

_Status: **approved by the owner** (2026-10-10). It changes how the universal design ([universal.md](universal.md)) looks and the order it is built in. The engine, sharing, data and architecture in universal.md stay. Section 10 (chat) and section 14 (build stages) of universal.md are replaced by this page. Mockup: the "Chat-first Gigspree" artifact (owner's claude.ai account)._

## 1. What the app is

- **The chat is the app.** It opens on the chat with the assistant. There is no tab bar. A side menu holds: chats, group chats, pinned cards, "What it remembers", "Workflows", settings and help.
- **Answers are live cards.** The assistant replies with cards bound to real records: a list to tick, an expense to fix, a summary with bars, a record with its parts (a gig's set list, notes, guests), a question sent to people, a form, a pick board, a workflow, a setup proposal. A change made in a card is a normal write (same operations, checks, audit, offline outbox), so it shows everywhere. Any card can be pinned to the menu and opened full screen.
- **Memory.** Facts the person tells the assistant ("weddings are ₹25,000 for the band") and corrections they make ("groceries go under Home") are kept per person, each with where it came from, listed under "What it remembers" and deletable. The assistant reads them in every chat. Memory is data in the person's object, never instructions from other people's records.
- **Workflows** are the automations of universal.md §2 (when / check / wait / then), built by asking. Every workflow is shown as **a diagram and in plain words, both drawn from the saved definition** (not from the model's description), so what the person reads is what runs. A new workflow is a card with **Turn on**; nothing runs before that. The Workflows page lists them with an on/off switch and run history ("Ran 3 times · last on 2 Nov").
- **Setups by chat** (new collections, fields, rules) are proposed as a card first: the lists, how they link, the rules it adds, and a plain-words summary. Made only on **Make it**.
- **People are pulled in through cards.** "Ask Rahul and Priya if they're free" sends question cards and shows answers as they arrive. Sharing a gig card lets bandmates add to its set list, notes and guests; money hidden by default (universal.md §11).
- **Group chats** (band, family): people talk to each other; the assistant answers only when someone with assistant access writes @assistant.

## 2. People and cost

- **Full user** (the owner): chats, memory, workflows, setups. The assistant runs on the owner's allowance (₹2,000 monthly cap).
- **Collaborators** (bandmates, family, fam jam guests): free. They get the cards shared with them, a "Shared with you" screen and the group chats they are in. **No assistant by default.** The owner can switch it on per person later (it costs the owner).
- **In group chats** only people with assistant access can ask it; others can't send @assistant messages (the composer explains why). What the owner asks there comes from the owner's allowance.

## 3. Look

The mockup's style replaces the single indigo: a colour per kind of card (lists and notes amber, money green, people indigo, workflows and memory violet, forms and new setups rose), the gradient assistant mark, raised cards, springy motion (`docs/decisions.md`, Motion), light and dark. Tokens live in `apps/web/src/core/ui/theme.css`.

## 4. What goes

The tab bar and the old screens (Overview, Gigs, Collections, Songs, Contacts, Reports, and their pages) are **removed in step 1**, not kept behind links (owner, 2026-10-10: "I want to see the app as is from scratch"). Their data stays; the server code for gigs and music stays until step 8 replaces it. Shared-with-you, join and public link pages, settings, help and admin stay.

## 5. Build order

Each step ships on its own (one PR, reviewed, deployed).

1. **New look and the chat-first shell.** Colour tokens per kind, the assistant mark, top bar and side menu, full-screen chat; old screens removed.
2. **Live cards in the chat.** Cards bound to records (list, note, expense, summary, record with parts), edit inside the card, pin, open full screen.
3. **Several chats and memory.**
4. **Bringing people in from the chat.** Question cards, share from the chat, the "Shared with you" screen redesigned as cards, per-person assistant switch (off).
5. **Workflows with diagrams.** Automation engine (when / check / wait / then), diagram + plain words from the definition, on/off, run history; reminders and notifications run here.
6. **Setups by chat and the fam jam.** Setup proposal cards; formulas, rollups, checks (uniqueness), status flows; pick board; results workflow. The fam jam test (universal.md §5) passes.
7. **Group chats.** People plus the assistant on @mention by people with access.
8. **Gigs as a setup; Songbook as cards.** The Gigs template from blocks (universal.md §7), checked against today's behaviour, then the old gig code goes. Songbook charts and stage mode open from cards.
9. **iPhone:** pinned cards as widgets, Share extension into the chat, on-device model (rest of the old stage 3).
10. **Later:** search by meaning, reports to Telegram and email, connectors, other full users.
