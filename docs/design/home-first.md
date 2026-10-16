# Design: home first (pages of cards, the chat one pull away)

_Status: **approved by the owner** (2026-10-11, in chat with the design model). It changes the shell and the look from [chat-first.md](chat-first.md) and adds processes, hybrid search, proposals and the inbox. Everything in chat-first.md about cards as the unit, memory, workflows, setups by chat, collaborators without an assistant and group chats still holds. Mockups (owner's claude.ai account): "Gigspree Concept Home" (the one to build), with "Gigspree Modern Home" and "Gigspree Home Prototype" as earlier steps. This document is the brief for the agent that builds it._

## 1. What the app is, in one paragraph

A chat-first **app maker where the chat never leaves**. The person describes what they do; the assistant makes lists, fields, rules, workflows and **cards**, and the person uses them from a **home screen of pinned cards**, with the chat one pull away for anything else. ChatGPT and Claude answer; this one **keeps things and does things**, with the person's data on their device. Gigs are the owner's own setup, built in the app; a clinic or an event crew would build theirs the same way. The name Gigspree stays for now (domain bought); it will change before the public listing (bundle ID stays).

## 2. Decisions (new or changed)

1. **Home first.** The app opens on the home: swipeable **pages** of pinned cards. The chat is a bar under the pages and a pull-down; it is not the first screen. (Replaces chat-first.md §1 "the app opens on the chat".)
2. _(Changed 2026-10-16, decision "A home you arrange": no pre-built pages; every page is the person's, Now is a card in the library.)_ **Page 1, "Now", is arranged by the assistant** from what is due and coming, from whatever cards the person's setup has. The other pages are the person's, arranged by hand (press and hold, drag, drag to the edge for the next page) or by chat ("move spending to my day", "make the gig card large"). Dropping onto Now is refused with a hint. Empty pages disappear.
3. **A card = components + an arrangement + a size (S/M/L).** The model picks components (from the screen builder's set, universal.md §8) and **one of a small set of named arrangements**; the app draws them. The model never positions pixels. Starting arrangements: `number`, `number-chart`, `two-numbers`, `two-numbers-list`, `list-ticks`, `list-plain`, `list-counter`, `next`, `countdown`, `question`, `quick-add`, `process`, `memory`, `progress`. Sections stack arrangements inside one card. When nothing fits, the model picks the nearest, says so, and the request is logged so a new arrangement can be added by us (data and code, not by the model).
4. **Every card answers one question on the card** (tick, +1, Going/Can't, quick add, nudge), chosen by the app from the field type. Tap opens the card full screen. A card can read **several collections** (universal.md §4 combined views).
5. **Colour comes from the collection**, picked when it is made; cards, chips and search hits carry it. One accent for the app itself.
6. **Cards know when they are done** (a countdown passes, a list empties, a gig ends) and offer to leave; "leaves after" is shown on the card.
7. **Press and hold a card:** size, **Ask about this** (opens the chat with the card as context), **Make a form**, **Share…**, **Send on a schedule**, Arrange home, Remove from home. Pull down from a card also opens the chat with that card as context.
8. **Collaborators have a home** of the pages and cards shared with them and use them fully (tick, answer, count, add rows where allowed). **No assistant** unless the owner switches it on per person (admin panel); it runs on the owner's allowance. Their chat bar reads "Search your cards".
9. **Processes** are workflows whose steps belong to **roles** (You, Band, Client by link without an account, a named person) and that **wait for that person's answer** before moving on, nudge after a set time, and can loop back. Same engine (when / check / wait / then) plus "who" and "waiting on". A process card shows the step it is waiting on and on whom. Diagram and words are drawn from the saved definition.
10. **Group chats** (already decided 2026-10-10): people with assistant access write `@assistant …`; the action happens as a card everyone in the group sees; only the asker's data is read and the asker's visibility applies to the answer.
11. **Hybrid search** (§4 below) replaces an app library: by meaning and by words with typos, over everything the person can see and nothing else. The dock has Home, Search, Inbox, This week.
12. **Inbox** holds things captured from WhatsApp, screenshots, Siri or the share sheet that fit no list yet; each is a card with the assistant's best guess and buttons; sorting is a sentence.
13. **This week** is one message a week of **proposals** (a quick add you keep doing by hand, a nudge workflow for money due, a finished card to remove). Proposals, never actions.
14. **What changed + Undo**: after any write or setup change from the chat, a card shows before/after in plain words (from the audit log) with Undo; "what did you change today" lists the log.
15. **First run** is a conversation about the person's **week**, not a template picker; the assistant proposes a setup card (lists, people, money, a home page) from it; **Make it** builds it. Setups can be **shared** with another person (structure, no data) as a starting point.
16. **Memory is visible**: a card and a page listing what the assistant knows, each with where it came from and Forget.
17. **Laptop and web:** pages flatten into one dashboard with the chat in a side panel; same cards, same data.
18. **Phone apps in React Native with Expo**, one codebase for iPhone, Android and the website (replacing the Svelte web app once the new one matches it); the Capacitor shell is retired when the Expo app reaches TestFlight; the Swift parts (App Intents, widgets, Share extension, on-device model) carry over. Macs run the iPhone/iPad app; Windows installs the website. Recorded in decisions.md.

## 3. Look (design system)

From the "Gigspree Concept Home" mockup. Tokens go in the shared theme; names are the mockup's.

- **Neutrals:** light canvas `#e9eaee`, page `#f3f4f7`, cell `#ffffff`, text `#15161a` with 62% and 32% tints for secondary and tertiary; dark canvas `#0b0c0f`, page `#0f1014`, cell `#191a20`, text `#f2f3f6`. Cool, never warm. Hairline `rgba(30,32,40,.08)` / `rgba(235,237,243,.08)`.
- **Accent:** indigo `#5b5bf6` (dark `#7c7cff`), soft tint at 14–18%. Collection colours: money teal `#0ea5a0`, time amber `#f59e0b`, people blue `#3b82f6`, flows violet `#8b5cf6`, music pink `#ec4899`, home green `#10b981`, neutral slate; dark-mode variants one step lighter. Danger `#e5484d`.
- **Type:** Plus Jakarta Sans (system fallback), 400–800. Numbers 800 with tight tracking and tabular figures. Card header 12px/700 in the collection colour with a small square dot; secondary text 12px at 62%.
- **Shapes:** cards 22px radius, hairline inset plus a soft shadow (`0 6px 20px rgba(10,12,20,.08)`); tinted cards for workflows (10% of the colour); one solid card per page at most (Next up). Glass for the chat bar, dock, menus and banners (blur 20–30, hairline). Dock icons in 54px circles; the selected one tinted.
- **Grid:** 2 columns of 169px, rows of 73px, 10px gaps; S = 1×2, M = 2×2, L = 2×4; six rows per page on a 390-wide phone; laptop 4 columns.
- **Motion:** springs, not durations: paging k≈200 critically damped with velocity carry-over and rubber-banding at the ends; sheets k≈230, drag to close; context menu scales from the card's centre with a blurred backdrop; reorder with FLIP (440 ms, `cubic-bezier(.25,1,.3,1)`); press feedback scale .97; jiggle ±0.5° only while arranging; reduced motion turns the jiggle off. Light haptic on tick, toggle, pick-up and page change.
- **Light and dark** are both first class; test every card in both. Tap targets ≥ 44 px; inputs ≥ 16 px.

## 4. Search

- **One index per person**, inside the person's object: full-text (SQLite FTS5, trigram tokenizer for typos) over every record, note, chat message, comment and card the person can see; hidden fields left out. Filled from the existing outbox: a space's write note goes to the index of its members and of everyone the record is shared with; changing a share adds or removes entries. The index is a disposable copy; the owning objects are the truth and can rebuild it.
- **By meaning:** embeddings from Workers AI into **Vectorize**, one index, filtered by person id; same fill path. Online only.
- **Hybrid:** run both, merge with reciprocal rank fusion, boost recent and often-opened things and exact matches, re-check the share on every hit before showing it.
- **On the device:** the same full-text index over the local copy, so keyword search works offline.
- D1 is not used for search (rule 1: identity and the space list only).

## 5. Engineering rules (agreed 2026-10-11)

1. **One card schema.** `card.v1` in `packages/shared` (Zod, next to `SavedView` and `MakeSetupInput`): arrangements, the components each accepts and in which slots, bindings (`{collection, filter, field}`), sizes, the one answer action. The server validates every card the model emits before saving (invalid → the error goes back to the model, nothing is saved); the phone, the web build and the Swift widgets draw from the same schema. New arrangements bump the version; old cards stay valid.
2. **A rendered catalogue in CI.** Fixtures for every arrangement × size × light/dark, rendered and pixel-diffed against the committed baseline on every change (web target with Playwright; the simulator job for native). The same fixtures are the in-app gallery.
3. **Vertical slice first.** The first Expo PRs build one thin path end to end (sign-in, local store with outbox, one page, one card, tick, chat sheet against the existing assistant endpoint, TestFlight), then widen. **Feature freeze on the Svelte app** while the Expo app catches up: fixes only.
4. **Setups are shared in the app**, like cards: "share my setup" sends a proposal card to another person (lists, fields, rules, workflows, cards; no records); they read it and tap **Make it** to get it in their own space. The copy goes between the two spaces' objects server-side, validated by the same schemas and limits as `make_setup`; `setup.json` is the internal shape, not a user-facing file. A link version for people not yet on the app comes later and behaves like a join link. **Export** ("my data out": a CSV per collection plus the setup) is a separate, later, owner-only, confirm-first, audited and rate-limited operation produced inside the space's object and delivered to the person's own Google Drive or a one-time session-bound link, never a public link.
5. **Unmet asks are logged** (hand-over that still failed, "I can't", nearest-arrangement picks) with the message, level and tools tried, in the person's own object, shown as "Things I couldn't do yet", kept a few weeks.
6. **The AI budget is a card** from the budget object: month total against the cap, by level, by person.
7. **Dated acceptance test:** the 14 December gig. The app must: show the set list in stage mode from a card; count guests at the door through a shared card; record a payment via the chat and show it on the gig's card; tell the band when the gig is confirmed through a workflow; take expenses afterwards by quick add and by chat.

## 6. Security (adds to docs/security.md; every PR touching auth, sharing, search or the AI ticks these)

- **AI boundary:** model output is validated against schemas and runs only through registered operations with the asker's permissions; confirm-first for money, deletes, setups and anything that reaches other people; other people's text (records, comments, group messages) never reaches a model acting as you; memory is the person's own only.
- **Phone app:** session tokens in Keychain/Keystore; the local database encrypted at rest; optional biometric lock; no secrets in the bundle; no certificate pinning (not worth its upkeep behind Cloudflare).
- **Search:** one index per person, built only from what they can see, re-checked on display; Vectorize queried only with the person filter.
- **Processes by link:** a step link grants that step's answer only, expires with the step, rate-limited like forms.
- **Setup sharing and export:** as in §5.4. A received setup never carries code: formulas through our parser, workflows as engine shapes; nothing is made before Make it.
- **At rest:** Cloudflare encrypts Durable Object and D1 storage. **To do (HF, before the Expo app ships to TestFlight):** encrypt the nightly backup file with a key only the owner holds (a Worker secret) before it goes to Drive, with the restore script taking the same key; today `runBackup` only gzips it. On the phone, tokens in Keychain/Keystore and the local database under the OS's strict file-protection class. Field-level encryption per space is a later option for named sensitive fields (kept out of search and the AI by design).
- **Dependencies** pinned and updated on a schedule; Actions pinned to SHAs.
- **Stated trade:** no end-to-end encryption (search by meaning, workflows and the assistant read data on the server); say so in the privacy note.

## 7. Build order (Expo app; each step ships on its own)

1. **Vertical slice** (§5.3) in `apps/mobile` (iOS, Android, web targets), sign-in (passkey, Google natively; Google in the app is a security change and waits for the owner's OK), the data layer and offline outbox shared with the web, the TestFlight and simulator-screenshot pipeline moved over.
2. **Home**: pages, the card renderer (components + arrangements + sizes), press-and-hold menu, arrange by drag, the chat bar and pull-down, the dock. Now page arranged by a ranking over the person's cards (due dates, open items, waiting processes).
3. **Chat sheet** with card context, What changed + Undo, live cards in the stream; collaborator homes and the per-person assistant switch.
4. **Processes**: roles, waiting on, nudges, loops; the process card and detail; the client-by-link step.
5. **Search** (§4), Inbox (capture from the share sheet and Siri), This week proposals.
6. **First run** conversation and setup sharing; memory page.
7. **Web target** of the same app until it matches today's site, then the switch; laptop layout.
8. **Native pieces** in Swift: real widgets from pinned cards (the arrangements map to widget layouts), App Intents, Share extension, on-device model; Android equivalents later.

## 8. What this replaces

- chat-first.md §1 (opens on the chat, side menu) and §3 (colour per kind of card, gradient mark): home first, colour per collection, the logo as the mark.
- The App Library page in the first prototype: gone, search instead.
- Fixed widget kinds and apps in the dock: there are only cards from components; the dock holds Home, Search, Inbox, This week.
