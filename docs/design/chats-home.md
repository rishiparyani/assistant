# Chats as home: the look and flow the owner picked (2026-10-28)

**Status: being designed in a clickable prototype; nothing here is built yet.** The owner said "Don't build yet" (2026-10-28): first the prototype, then lock the design, then build in small steps. This file is the running record of the discussion, so it survives a new session or a compacted context. It builds on [from-scratch.md](from-scratch.md) (Today, spaces, rehearse, the build order FS1–FS10) and changes its home, look and space layout; where the two disagree, this file is newer.

## Links

- **The working prototype** (the one to keep refining): https://claude.ai/artifact/R1Lj9hfZWEHp7FfmBBvbBx — a stand-alone page, made-up data. The two-dot button on Chats switches colours and **Now / Polished**.
- The five look options plus "answers that are tiny apps" and "the assistant at work" (a design canvas): https://claude.ai/artifact/XSf9gtPy1jLdvGs78v4Gwi
- The requirements prompt for other AI design tools (no UI suggestions in it, by the owner's wish): https://claude.ai/artifact/H8UeKNGtrHt2f7gzgqqXJa
- The prototype's source: [prototypes/chats-home.html](prototypes/chats-home.html) (a copy, updated when the prototype changes; open it in a browser).

## What the owner chose

From five directions (Quiet Pro, Chats as home, Bento, Timeline, Command dark) and two in-chat ideas, the owner picked **2 (Chats as home), 6 (answers that are tiny apps) and 7 (the assistant at work)**, then refined it:

1. **Home is Chats**, like WhatsApp: a large "Chats" title that shrinks on scroll; no search bar at the top. **Search appears when the list is pulled down** (the owner: "everyone using other chat apps knows pull down to search"), plus a magnifier button.
2. **The Assistant is a dark card pinned at the top**, showing what it's watching ("This week: electricity ₹2,340 Mon, society meeting Wed"). It is not a chat row.
3. **One list under it, newest activity first**, no sections (the owner preferred this to Spaces/Chats sections). Each kind looks different:
   - a **space** is a rounded tile tinted in its colour, with a square icon, "· space", status chips ("1 waiting on you", "3 inside now", "2 complaints") and the last message;
   - a **person** is a plain row with one round face;
   - a **group chat** is a plain row with overlapping faces.
   Filters: All · Unread · Spaces · Chats. A group chat becomes a space once it has lists. Archived chats sit at the bottom.
4. **"Needs you"**: one slim amber bar at the top ("4 things need you" and the oldest one); tapping opens a **Needs you** screen listing every question, approval, vote and form with its buttons. It never pushes the chats down however many there are.
5. **Every space has the same top**: **Chats · Lists · Flows · People** (owner, on Family lacking them: "How come?"). A plain chat with a person, or a group with no lists, opens straight into the conversation.
6. **Several chats per space** (agreed 2026-10-25): the space's Chats tab is a **list** (not chips: "there could be multiple chats"): Everyone first, then topic chats, then private ones. A chat can be for everyone or **some people** (Committee: 4 of Building's 12, "4 people · private"); only they see it, and it can use the space's lists. "+ New chat in <space>".
7. **Answers that are tiny apps** (6): the assistant answers with working cards built from the app's own fixed blocks (never code the AI writes): a spending breakdown with tappable bars, a bill splitter (who shared, tip, each person's share live, "Add to Family expenses"), a question with described answer cards, a drawn workflow with Looks right / Change, an expense added from "spent 450 on chai" with Undo.
8. **The assistant at work** (7): a job screen ("Collect November dues"): a dark summary card (28 of 42 paid, progress, Pause), **Needs your OK** (the exact reminder text, "Send to 14" / "Not yet"), "What it did" as a timeline, "Show the 14 unpaid flats", and a box to tell it things ("B-204 paid in cash"). Status in three layers, after Meta's Muse.
9. **Colours: Jamun** (deep plum with soft pink; the owner liked Leaf first, then Jamun "more now"). Hand-tuned light and dark; amber stays the "waiting on you" colour in every palette.
10. **The polished look** (the owner: "This is better"): screens slide in and back, sheets spring up, buttons press in; light space headers with the space's square icon and a segmented tab bar; one card style for every answer (dot, label, divider); a display face for names and numbers; softer bubbles; on a laptop two panes (chats left, open chat right).

## Agreed behaviour behind it (from the same discussion)

- **The AI reads a chat like ChatGPT or Claude**: the whole conversation up to the model's budget, plus a running summary of what's older; New chat starts fresh. In group chats the AI runs only when someone uses it (a save suggestion, a private question, the catch-up), never on every message; the space's owner pays. (Recorded in decisions.md 2026-10-25 "Space pages, and chats per space".)
- **Many chats stay tidy**: unread first, search, filters, pin, archive, mute.
- Group chat suggestions ("+ Add to Complaints · Not that"), the catch-up card ("While you were away"), workflow questions inline (buttons only for their person, outcome for everyone), "✦ Ask privately".

## Still to design in the prototype (owner said yes, 2026-10-28)

1. **First run**: sign-in, then the empty Chats screen before anything exists.
2. **Joining from an invite link**: what a resident sees with no account and no AI.
3. **Profile and settings**: name, photo, assistant on/off, notifications, colours.
4. **A list and a record full screen** in the polished style.
Then: extra-large text and Hindi/Hinglish labels; gestures (swipe to archive/reply, long-press menus); real photos.

## Planned build order (once the owner says build)

1. The look: Jamun and the polished styles in the theme tokens (a theme change: the owner has now chosen it).
2. Chats as home (pinned assistant card, one list, pull-down search, Needs you bar and screen).
3. Spaces with Chats · Lists · Flows · People; several chats per space, private ones; the AI's full context plus summary.
4. Answer cards (6) from the fixed blocks.
5. The assistant at work (7).
6. Two panes on a laptop.
7. The account switcher (below).

## Other things discussed on 2026-10-27/28

- **Testing chats as several people without signing out**: for now, use the phone as yourself and the website in a private/incognito window (or another browser) as the other person. Proposed to build: an **account switcher** (stay signed in to several accounts, swap with one tap, like Gmail), and later **rehearse group chats** in a practice copy (part of the group-chat step). The owner hasn't chosen yet; it's on the build list above.
- **iPhone simulator on a Mac**: a Claude session on a Mac (Claude Desktop, or Claude Code with `claude remote-control` to reach it from the phone) can drive Apple's simulator to check the app. Needs Xcode (about 40 GB), the repo cloned, Node, pnpm and CocoaPods, Screen Recording and Accessibility allowed, and the Mac awake while it works. Not set up yet.
- **Native apps vs React Native**: stay on React Native (one codebase for iPhone, Android and the web). If the feel isn't enough, rewrite one screen natively (the chat) as a trial first.
- **Renaming**: the owner wants a new name later (Gigspree "sounds like a gig-specific app").
- **Research on in-chat UI** (Claude's inline visuals, ChatGPT's Intelligent UI with GPT-6, ChatGPT "dots" agents, Meta's Muse): summarised in the chat of 2026-10-28; the takeaway is items 7 and 8 above, with the rule that the AI never writes code for screens.

## Owner to-dos still open

- Production start over (Actions › Start over; this session was refused).
- Move the visitor lists from Personal to Building (ask the chat to delete them in Personal and set them up in Building), then make the visitor flow again.
- Try the latest TestFlight build (chat smoothness, keyboard, drawn workflow cards).
- Decide on a Mac for the simulator, if wanted.
