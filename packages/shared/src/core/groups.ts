// Group chats (chat-first step 7): people talk to each other; the assistant answers only
// when someone with assistant access writes @assistant, from that person's allowance and with
// that person's own data. One object per group holds its members and messages.
import { z } from "zod";
import type { ChatItem } from "./spaces.ts";

const groupId = z.string().trim().min(1).max(40);
const people = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .describe("People you know (from list_people): their names or ids");

export const CreateGroupInput = z
  .object({
    id: z.string().trim().min(1).max(40).describe("Made on the device (ULID), so a retry makes one group"),
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
export const PostGroupMessageInput = GroupRef.extend({
  text: z.string().trim().min(1).max(2000),
});
export const AddGroupPeopleInput = GroupRef.extend({ people: people.min(1) });
export const GroupMessageRef = GroupRef.extend({ message_id: z.string().trim().min(1).max(40) });
/** "Saved to Gigs ✓" under a message, for the person who saved it only. */
export const MarkSavedInput = GroupMessageRef.extend({ label: z.string().trim().min(1).max(80) });

/** How a group message is written to ask the assistant (a fixed word, like a command). */
export const ASSISTANT_MENTION = "@assistant";
export const mentionsAssistant = (text: string) => text.toLowerCase().includes(ASSISTANT_MENTION);

export interface GroupMember {
  user_id: string;
  name: string;
  role: "owner" | "member";
}

export interface GroupMessage {
  id: string;
  kind: "person" | "assistant" | "note";
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
