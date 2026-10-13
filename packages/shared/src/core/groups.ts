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
});
/** My answer to a question in a chat (null takes it back). */
export const VoteInput = GroupRef.extend({
  message_id: z.string().trim().min(1).max(40),
  option: z.string().trim().min(1).max(40).nullable(),
});

/** Sharing one of my assistant's answers into the chat. */
export const ShareAnswerInput = GroupRef.extend({ item_id: z.string().trim().min(1).max(60) });
export const GroupMessageRef = GroupRef.extend({ message_id: z.string().trim().min(1).max(40) });
/** "Saved to Gigs ✓" under a message, for the person who saved it only. */
export const MarkSavedInput = GroupMessageRef.extend({ label: z.string().trim().min(1).max(80) });

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
}

export interface GroupView {
  id: string;
  /** For a chat with one person, the other person's name. */
  name: string;
  direct: boolean;
  owner_id: string;
  members: GroupMember[];
  /** Newest last. */
  messages: GroupMessage[];
  /** Whether the person reading may ask the assistant here. */
  can_ask: boolean;
  /** Messages the reader saved, by message id: where to ("Gigs"). Only theirs. */
  saved: Record<string, string>;
  /** Answers from the reader's own assistant they shared here (item ids), so each is shared once. */
  shared_answers: string[];
  /** Questions asked of everyone (by message id): the answers, who picked what, and mine. */
  polls: Record<string, PollView>;
}

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
  /** Who picked each answer, in the order of `options`. */
  votes: { option: string; people: string[] }[];
  /** My answer, if any. */
  mine: string | null;
}
