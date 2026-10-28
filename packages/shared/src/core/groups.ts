// Chats with people (decision 2026-10-13 "Chats with people"): groups and chats for two. The
// assistant is asked privately (only the asker sees it); an answer they share shows in the chat.
// One object per chat holds its members and messages.
import { z } from "zod";
import type { ChatItem } from "./spaces.ts";

const groupId = z.string().trim().min(1).max(40);
const people = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .describe("People you know (from list_people): their names or ids");

export const CreateGroupInput = z
  .object({
    // A ULID: the group's id is also the id of each member's own assistant chat about it, so it
    // can't be anything else (never "main", the person's own first chat).
    id: z
      .string()
      .trim()
      .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Not a chat id")
      .describe("Made on the device (ULID), so a retry makes one group"),
    name: z
      .string()
      .trim()
      .max(60)
      .default("")
      .describe("e.g. Band, Family (none for a chat with one person)"),
    people: people.default([]),
    /** A chat with one person (decision 2026-10-13 "Chats with people"): one per pair. */
    direct: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.direct && v.people.length !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["people"],
        message: "A chat with one person names exactly one person",
      });
    if (!v.direct && !v.name)
      ctx.addIssue({ code: "custom", path: ["name"], message: "A group needs a name" });
  });
/** A chat started inside a space (chats-home.md 6): for everyone in it, or some of its people. */
export const StartSpaceChatInput = z.object({
  space: z.string().trim().min(1).max(80).describe("The space's id or name"),
  id: z
    .string()
    .trim()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Not a chat id")
    .describe("Made on the device (ULID), so a retry makes one chat"),
  name: z.string().trim().min(1, "A chat needs a name").max(60).describe("e.g. Committee, Repairs"),
  people: people
    .optional()
    .describe("Some of the space's people (names or ids); leave out for everyone in the space"),
});
export const GroupRef = z.object({ group_id: groupId });
/** A chat, optionally around one message (opened from a search hit) instead of the newest. */
export const GetGroupInput = GroupRef.extend({ around: z.string().trim().min(1).max(40).optional() });
export const PostGroupMessageInput = GroupRef.extend({
  text: z.string().trim().min(1).max(2000),
});
export const AddGroupPeopleInput = GroupRef.extend({ people: people.min(1) });
/** How a Save turn starts in my assistant chat (the app shows it as a short note instead). */
export const SAVE_TURN_PREFIX = "Save this chat message to my lists.";

/** Asking my own assistant about a chat (only I see it). */
export const AskInGroupInput = GroupRef.extend({
  text: z.string().trim().min(1).max(2000),
  think_harder: z.boolean().optional(),
});
/** Asking everyone in a chat (decision 2026-10-14 "Ask everyone"): a question with a few answers. */
export const CreatePollInput = GroupRef.extend({
  question: z.string().trim().min(1).max(300),
  options: z
    .array(z.string().trim().min(1).max(40))
    .min(2)
    .max(6)
    .default(["Yes", "No", "Maybe"])
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, "Answers must differ"),
  /** A question that acts (decision 2026-10-15): a record pinned to the chat and one of its
   *  personal fields; each person's answer fills in their own answer on the record. */
  about: z
    .object({
      share_id: z.string().trim().min(1).max(40),
      field: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe(
          "A personal yes/no or choice field (each answer fills in that person's own), or a plain choice, text, date or date-and-time field (the most picked answer sets it); name or id",
        ),
      /** A plain field only: set it as the lead changes (auto), or when the asker taps (ask; the default). */
      apply: z.enum(["auto", "ask"]).optional(),
    })
    .optional(),
});
/** My answer to a question in a chat (null takes it back). */
/** The asker (or an admin) sets a plain field to one of the answers (decision 2026-10-15 "Questions that act, second part"). */
export const ApplyPollInput = GroupRef.extend({
  message_id: z.string().trim().min(1).max(40),
  option: z.string().trim().min(1).max(40),
});
export const VoteInput = GroupRef.extend({
  message_id: z.string().trim().min(1).max(40),
  option: z.string().trim().min(1).max(40).nullable(),
});

/** Sharing one of my assistant's answers into the chat. */
/** An admin makes someone an admin, or a member again (decision 2026-10-14 "A home for each chat"). */
export const SetGroupRoleInput = GroupRef.extend({
  user_id: z.string().trim().min(1).max(64),
  role: z.enum(["admin", "member"]),
});
export const ShareAnswerInput = GroupRef.extend({ item_id: z.string().trim().min(1).max(60) });
export const GroupMessageRef = GroupRef.extend({ message_id: z.string().trim().min(1).max(40) });
/** "Saved to Gigs ✓" under a message, for the person who saved it only. */
export const MarkSavedInput = GroupMessageRef.extend({ label: z.string().trim().min(1).max(80) });
/** Saving a message, with the action the person tapped on a suggestion ("Remind me", "Add to Bills"). */
export const SaveMessageInput = GroupMessageRef.extend({
  action: z.string().trim().min(1).max(80).optional(),
});
/** Suggested actions on new messages in this chat, for me (backlog DF4). */
export const SuggestInput = GroupRef.extend({ on: z.boolean() });

export interface GroupMember {
  user_id: string;
  name: string;
  role: "owner" | "member";
}

export interface GroupMessage {
  id: string;
  kind: "person" | "assistant" | "note" | "poll";
  author_id: string | null;
  /** The person who wrote it, or "Assistant (asked by Dev)". */
  author: string;
  text: string;
  created_at: string;
}

export interface GroupSummary {
  id: string;
  /** For a chat with one person, the other person's name. */
  name: string;
  direct: boolean;
  members: number;
  /** Messages from others since I last opened it. */
  unread: number;
  last: { author: string; text: string; at: string } | null;
  updated_at: string;
  /** The chat's home (a shared space), once an admin has started it: the chat is that space's. */
  space_id: string | null;
  /** Started inside that space (one of its several chats), not the chat the space was made from. */
  in_space?: boolean;
}

export interface GroupView {
  id: string;
  /** For a chat with one person, the other person's name. */
  name: string;
  direct: boolean;
  owner_id: string;
  /** The chat's home (a shared space), once an admin has started it. */
  space_id: string | null;
  /** Started inside that space (one of its several chats), not the chat the space was made from. */
  in_space?: boolean;
  /** role "owner" is an admin (a chat can have several). */
  members: GroupMember[];
  /** Newest last. */
  messages: GroupMessage[];
  /** Whether the person reading may ask the assistant here. */
  can_ask: boolean;
  /** Messages the reader saved, by message id: where to ("Gigs"). Only theirs. */
  saved: Record<string, string>;
  /** Suggested actions on new messages are on for the reader in this chat. */
  suggest: boolean;
  /** The one action suggested to the reader per message ("Remind me"), only when sure; theirs only. */
  suggested: Record<string, string>;
  /** Answers from the reader's own assistant they shared here (item ids), so each is shared once. */
  shared_answers: string[];
  /** Questions asked of everyone (by message id): the answers, who picked what, and mine. */
  polls: Record<string, PollView>;
  /** Records pinned to this chat (decision 2026-10-14 "Chat about this"): each is the owner's
   *  record seen through a share whose people follow the chat's; oldest first. */
  cards: ChatCard[];
}

/** One record pinned to a chat: its owner's share (open it at /api/cards/:share_id). */
export interface ChatCard {
  share_id: string;
  /** The record's title when it was pinned (the share has the live one). */
  title: string;
  owner_id: string;
  owner: string;
  added_at: string;
}

/** Taking a record off a chat (an admin, or the person whose record it is). */
export const ChatCardRef = GroupRef.extend({ share_id: z.string().trim().min(1).max(40) });

/** What the assistant proposes for a message someone wants to save (nothing is saved yet). */
export interface SaveProposal {
  /** The reader's own assistant chat about this group, where the cards wait for a tap. */
  chat_id: string;
  /** This turn's cards (waiting for a tap) and words. */
  items: ChatItem[];
}

/** Someone I can start a chat with: people I share with, who share with me, or share a group. */
export interface ChatPerson {
  user_id: string;
  name: string;
}

export interface PollView {
  question: string;
  options: string[];
  /** A question that acts: which pinned record and field the answers fill in. Personal: each
   *  answer is that person's own. Plain: the most picked answer sets the field, as the lead
   *  changes (`apply: auto`) or when the asker sets it (`ask`); `applied` is the last answer
   *  sent to the record and how it went; `can_apply`: I may set it (I asked, or I'm an admin). */
  about?: {
    share_id: string;
    record: string;
    field: string;
    personal: boolean;
    apply?: "auto" | "ask" | null;
    applied?: { option: string; status: "sending" | "done" | "failed" } | null;
    can_apply?: boolean;
  } | null;
  /** Who picked each answer, in the order of `options`. */
  votes: { option: string; people: string[] }[];
  /** My answer, if any. */
  mine: string | null;
}
