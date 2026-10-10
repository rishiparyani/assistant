// Group chats (chat-first step 7): people talk to each other; the assistant answers only
// when someone with assistant access writes @assistant, from that person's allowance and with
// that person's own data. One object per group holds its members and messages.
import { z } from "zod";

const groupId = z.string().trim().min(1).max(40);
const people = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .describe("People you know (from list_people): their names or ids");

export const CreateGroupInput = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe("Made on the device (ULID), so a retry makes one group"),
  name: z.string().trim().min(1).max(60).describe("e.g. Band, Family"),
  people: people.default([]),
});
export const GroupRef = z.object({ group_id: groupId });
export const PostGroupMessageInput = GroupRef.extend({
  text: z.string().trim().min(1).max(2000),
});
export const AddGroupPeopleInput = GroupRef.extend({ people: people.min(1) });

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
  name: string;
  members: number;
  last: { author: string; text: string; at: string } | null;
  updated_at: string;
}

export interface GroupView {
  id: string;
  name: string;
  owner_id: string;
  members: GroupMember[];
  /** Newest last. */
  messages: GroupMessage[];
  /** Whether the person reading may ask the assistant here. */
  can_ask: boolean;
}
