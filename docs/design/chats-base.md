# Chats are the base (design, 2026-10-30)

**Status: proposed, mock-up made for the owner; not built.** The owner asked whether "spaces" earn their place or the app should be "just chats and build over it", and said: "write it up and make the mockup. Incorporate your previous suggestions also. Just don't remove the model picker." This file is the proposal. It changes the screens and words of [chats-home.md](chats-home.md) (Chats as home, spaces with tabs) and keeps everything under the hood.

## The idea in one line

What people see is **chats**, like WhatsApp: a group chat holds its own lists, flows and people; your chat with the assistant holds your own things; when several chats must share the same lists they form a **community** (WhatsApp's own word). "Space" stops being something people see.

## Why

- Everyone already knows chats and groups. "Space" is one more idea to learn.
- A group's people already are the chat's members. Today a space and its group chat each have people, which can drift apart.
- The same thing showed twice on Chats (a space tile and its chat).
- It fits what was built: a group chat already becomes a space once it has a list.

## The model

1. **A group chat is the container.** Its lists, flows and people live in its info screen (tap the group's name), like WhatsApp's group info: **Lists · Flows · People**, plus the group's settings. The assistant, asked from the group, works on the group's lists.
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
3. **Group info** (tap a group's name in its chat): its photo and name, then **Lists** (each with its flows under it: "Visits · 1 flow"), **People** (with roles, Invite), and settings (mute, leave). No separate Flows tab: a flow shows on the list it works on, and opens its own page.
4. **No library.** Everything lives in its group, community or your assistant chat; search finds anything; "show me all my lists" asks the assistant.
5. **Community** (a row on Chats): its chats (each with who's in it), and its info: shared lists with their flows, everyone with roles.
6. **You** (your face): accounts, Help (the tour, ideas), What the assistant remembers, Connections, Recently deleted, Sign out.
7. **The chat** keeps the **Quick / Careful picker** (the owner: "Just don't remove the model picker").
8. **The old site's remaining pages** (songs, shared links, settings) move into the app, so everything works the same way.

## What it removes

The space tiles on Chats, the space page and its tabs, the Spaces filter, the library, the Needs you bar, the help and library buttons on Chats, and the word "space" in what people see.

## Build order (when the owner says build)

1. The bell as one inbox (Needs you + Updates); Chats with two buttons and All · Unread.
2. Group info with Lists (flows under them) and People; a group's lists as chips on Chats; the space page and tiles retired.
3. Your assistant chat's info (your own lists); "Personal" retired from what people see.
4. Communities: a row that opens to its chats; its info; making one from a group ("add another chat that uses these lists").
5. The library retired (its jobs: search and the assistant); the old site's pages moved into the app.

## Open questions for the owner

- A community's name on Chats: the community's name ("Green Park Society") with its chats inside, as WhatsApp does? (Proposed: yes.)
- Should a one-to-one chat be allowed to hold lists, or only groups? (Proposed: yes, like a small group.)

## Mock-up

- **The live mock-up** (tap through it, like the chats-home prototype): https://claude.ai/artifact/ByUfLGyhYQ47yJB2u7f82v. Search, the bell (answer a question, then Updates), a group chat with @assistant and the Quick / Careful picker, group info, a list you can tick, a community, New chat and You.
- A visual mock-up of Chats, the bell, a group chat with the Quick / Careful picker, group info, a community and You, with made-up data: https://claude.ai/artifact/LGARg3eYePnTPHXp1VxBZy (private to the owner until shared).
