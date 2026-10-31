# Chats are the base (design, 2026-10-30)

**Status: the owner said build (2026-10-30), in today's look; step 1 is built (see Build order).** The owner asked whether "spaces" earn their place or the app should be "just chats and build over it", and said: "write it up and make the mockup. Incorporate your previous suggestions also. Just don't remove the model picker." This file is the proposal. It changes the screens and words of [chats-home.md](chats-home.md) (Chats as home, spaces with tabs) and keeps everything under the hood.

**Look (owner, 2026-10-30):** "the current app's look and feel is better. But the idea… I think it's the right direction." The mock-ups show the structure only; when built, every screen keeps the app's own look (its theme, type, cards, spacing and components as they are now), and only what's where changes.

## The idea in one line

What people see is **chats**, like WhatsApp: a group chat holds its own lists, flows and people; your chat with the assistant holds your own things; when several chats must share the same lists they form a **community** (WhatsApp's own word). "Space" stops being something people see.

## Why

- Everyone already knows chats and groups. "Space" is one more idea to learn.
- A group's people already are the chat's members. Today a space and its group chat each have people, which can drift apart.
- The same thing showed twice on Chats (a space tile and its chat).
- It fits what was built: a group chat already becomes a space once it has a list.

## The model

1. **A group chat is the container.** Its lists, flows and people live in its info screen (tap the group's name), like WhatsApp's group info: **Boards · Lists · People** (flows show under the list they work on), plus the group's settings. The assistant, asked from the group, works on the group's lists.
2. **Your chat with the assistant is your own place.** Its info screen has your own lists (expenses, reminders, notes) and flows. It replaces "Personal".
3. **A community joins chats that share lists.** For a society: a committee chat, a residents chat and a guards chat, all on the same Visits and Dues lists, each person only in their chats. Its info screen has the shared lists, flows and everyone, with roles. A community appears on Chats as one row that opens to its chats (like WhatsApp communities). Only groups that need it ever see one.
4. **One-to-one chats** stay chats; they can have a list too (a chat that gets a list works like a small group).
5. **Who sees what is unchanged**: roles (owner, can change, can see), people reached by a shared link or form, a row seen only by its own flat, all as today.
6. **Who talks to the assistant is unchanged** (decision 2026-10-30 "Who talks to the assistant"): whoever has it uses it in every chat and community they're in, as themselves; whoever doesn't, can't.

## Under the hood (nothing big moves)

The server keeps a container per group chat, per community and per person, as today's space objects; a community is today's space with several chats inside (chats-home.md step 3). Data, permissions, privacy, costs and the outbox stay as they are; no data migration. What changes is which screens exist and their words: a space's page becomes the group's (or community's) info screen, and a chat whose home is a space opens that home from its name.

## The screens (incorporating the simplifications proposed the same day)

1. **Chats (home).** Title, then two round buttons: the **bell** and **your face**. (Help and the library move: Help into You, the library goes, see 4.) Pull down to search. One list, newest first: the assistant pinned at the top, then groups, communities and people. A group with lists shows them as small chips under its last message ("Visits · Dues"). Filter chips: **All · Unread** only. The **New** button starts a chat with people or a group (never the assistant: the pinned assistant row and each screen's composer do that).
2. **The bell: one inbox.** **Needs you** (questions and forms waiting on me, with their buttons) on top, **Updates** (what happened) below. The Needs you bar leaves Chats.
3. **Group info** (tap a group's name in its chat): its photo and name, then **Boards** (see below), **Lists** (each with its flows under it: "Visits · 1 flow"), **People** (with roles, Invite), and settings (mute, leave). No separate Flows tab: a flow shows on the list it works on, and opens its own page.
4. **No library.** Everything lives in its group, community or your assistant chat; search finds anything; "show me all my lists" asks the assistant.
5. **Community** (a row on Chats): its chats (each with who's in it), and its info: shared lists with their flows, everyone with roles.
6. **You** (your face): accounts, Help (the tour, ideas), What the assistant remembers, Connections, Recently deleted, Sign out.
7. **The chat** keeps the **Quick / Careful picker** (the owner: "Just don't remove the model picker").
8. **The old site's remaining pages** (songs, shared links, settings) move into the app, so everything works the same way.

## Boards (dashboards)

The owner asked whether a dashboard is still possible; it is, as a **board**: a set of live cards (totals, bars, a short list of what's open) worked out from the chat's lists, so it follows every change. The assistant already answers with these cards (chat-first.md); a board keeps them together.

- **Made by asking** ("make a board of this month's bills: what's left to pay and who owes what"), changed by asking; the screen is for looking and tapping through (decision "Chat makes, screens use"). A list card opens its list.
- **Where it lives:** a group's boards in its info, above its lists, seen by everyone in the group (each sees only what their share allows); a community's boards in its info (a committee board: dues collected, visitors waiting); your own in your assistant chat's info, seen only by you.
- **Pinned to the chat:** one board per chat can be pinned to the top of the chat as a one-line summary (like WhatsApp's pinned message) that opens it. Later, on the iPhone, a pinned board can be a home-screen widget (chat-first.md step 9).
- **Under the hood** each card is close to today's saved views (`save_view`: a list with filters, sort and a card look); a board, a named group of them with totals and bars, is new. It is kept in the container that owns the lists, so permissions and offline reading work as for lists.

## Connectors: any MCP (owner, 2026-10-30)

The owner wants connectors like Claude's and ChatGPT's: not only Calendar and Gmail (decision 2026-10-12 "Connectors start with Google Calendar") but **any MCP server**, for example a food-ordering one ("Zomato MCP or something like that… basically any MCP").

- **You → Connections**: connected services, a short list of ready ones to tap (Calendar, Gmail, food delivery, rides), and **Add by link** for any remote MCP server (a web address with its own sign-in), as Claude's custom connectors do.
- **Per person.** Each person signs in to their own account once (OAuth); the token is kept encrypted in that person's own object, revocable from Connections. Nobody else can use it, in any chat.
- **Used in any chat, as you.** "Order my usual roll" in your assistant chat, or "@assistant let's order lunch" in a group: the assistant uses the asking person's connection.
- **Reading is free; acting is a card.** Anything that spends money, sends something or changes something outside the app (place an order, send an email, book a ride, add an event) comes back as a card the person taps, like our money and delete rules. Payment happens in the service's own way.
- **Private in groups.** What a connector reads from your account shows only to you until you post it ("Only you see this").
- **Group actions.** A group order card: everyone picks on it, the person whose connector it is places it; the total can land in a list (Bills, Expenses) where a flow splits it.
- **Data, not instructions.** What a service returns (menus, emails, event text) is data; it never steers the assistant (as for MCP today).
- **Cost and accuracy.** A connector's tools are offered to the model only when a request needs them, so ordinary requests cost nothing extra and the cheap models stay accurate.
- **Limits.** Only MCP servers reachable on the web with a sign-in; ones that run only on a computer (local MCP) can't be used from the phone. The app becomes an MCP **client** as well as a server: building it needs a recorded decision (outside services, and likely the standard MCP client library as a new dependency).

## Topics (owner, 2026-10-31; built)

The owner wants several boards with the same people, even one-to-one ("for one gig one dashboard, for another gig another"). Instead of several chats with the same people, **any chat has topics**: its own messages for one plan or event, shown as chips under the chat ("General", "Pune show, 14 Nov", "Goa trip, 2 Dec", "+ Topic"). A topic is closed when it's done (folded away under "Closed", still searchable) and can be reopened. The assistant asked from a topic reads only that topic. Each topic will get its own boards (step 3). Chats shows one row per person or group, with "N topics".

## What it removes

The space tiles on Chats, the space page and its tabs, the Spaces filter, the library, the Needs you bar, the help and library buttons on Chats, and the word "space" in what people see.

## Build order (when the owner says build)

1. **Done (2026-10-30).** The bell as one inbox (Needs you + Waiting on others + Updates); Chats with two buttons and All · Unread; Help and the library in You.
2. Group info with Boards, Lists (flows under them) and People; a group's lists as chips on Chats; the space page and tiles retired.
3. Boards: made by asking, in a chat's info (and per topic), one pinnable to the top of its chat or topic.
   - **Done (2026-10-31), before step 2:** topics in any chat; asking about a chat in one tap (Gs takes what was typed; Ask about this); the leaner chat reading.
4. Your assistant chat's info (your own lists); "Personal" retired from what people see.
5. Communities: a row that opens to its chats; its info; making one from a group ("add another chat that uses these lists").
6. The library retired (its jobs: search and the assistant); the old site's pages moved into the app.
7. Connectors: Connections with Add by link (any remote MCP), per-person sign-in, tools offered when needed, action cards, group orders.

## Open questions for the owner

- A community's name on Chats: the community's name ("Green Park Society") with its chats inside, as WhatsApp does? (Proposed: yes.)
- Should a one-to-one chat be allowed to hold lists, or only groups? (Proposed: yes, like a small group.)

## Mock-up

- **The live mock-up** (tap through it, like the chats-home prototype): https://claude.ai/artifact/ByUfLGyhYQ47yJB2u7f82v. Search, the bell (answer a question, then Updates), boards (one pinned in Flatmates; ask for a new one), Connections (connect a food service or add any MCP by link, then order alone or as a group), a group chat with @assistant and the Quick / Careful picker, group info, a list you can tick, a community, New chat and You.
- A visual mock-up of Chats, the bell, a group chat with the Quick / Careful picker and a pinned board, group info, a community, You, a board, Connections and a group order through a connector, with made-up data: https://claude.ai/artifact/LGARg3eYePnTPHXp1VxBZy (private to the owner until shared).
