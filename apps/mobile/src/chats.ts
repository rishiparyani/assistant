// Chats with people (decision 2026-10-13 "Chats with people"): groups and chats for two, kept
// on the phone so they open offline. Messages go through the outbox like any other change,
// show at once as "sending", and are sent in order when there's a connection.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ulid,
  type ChatPerson,
  type ChatView,
  type GroupMessage,
  type GroupSummary,
  type GroupView,
  type SaveProposal,
} from "@assistant/shared";
import { isOffline, request } from "./api.ts";
import { outboxState, send, subscribe, type Change, type FailedChange } from "./outbox.ts";
import { readJson, writeJson } from "./storage.ts";
import { useLive } from "./live-socket.ts";

const LIST = "gigspree:chats";
/**
 * A chat kept on the phone: a copy kept before topics existed has none, so it reads as no topics
 * (Codex on PR 221: an older copy crashed the chat).
 */
const kept = (id: string, topic?: string): GroupView | null => {
  const v = readJson<GroupView>(ONE(id, topic));
  return v ? { ...v, topics: v.topics ?? [], topic: v.topic ?? null } : null;
};
/** The kept copy of a chat (one per topic: each opens offline on its own). */
const ONE = (id: string, topic?: string) => `gigspree:chat:${id}${topic ? `:${topic}` : ""}`;
const enc = encodeURIComponent;
const messagesPath = (id: string) => `/api/groups/${enc(id)}/messages`;
const pollsPath = (id: string) => `/api/groups/${enc(id)}/polls`;

// The space chat being started: the same id and key until it's made (a retry opens that one).
let spaceAttempt: { what: string; id: string; key: string } | null = null;

// online-only: a chat inside a space needs the space to check its people and make it once.
export async function startSpaceChat(
  space: string,
  input: { name: string; people?: string[] },
): Promise<GroupView> {
  const body = { name: input.name.trim(), ...(input.people ? { people: [...input.people].sort() } : {}) };
  const what = JSON.stringify([space, body]);
  if (spaceAttempt?.what !== what) spaceAttempt = { what, id: ulid(), key: ulid() };
  const made = await request<GroupView>(
    "POST",
    `/api/spaces/${enc(space)}/chats`,
    { id: spaceAttempt.id, ...body },
    spaceAttempt.key,
  );
  spaceAttempt = null;
  writeJson(ONE(made.id), made);
  return made;
}

/** My chats, newest first: the kept copy at once, then fresh from the server (and on changes). */
export function useChats() {
  const [chats, setChats] = useState<GroupSummary[] | null>(() => readJson<GroupSummary[]>(LIST));
  const [offline, setOffline] = useState(false);
  const load = useCallback(async () => {
    try {
      const fresh = await request<GroupSummary[]>("GET", "/api/groups");
      writeJson(LIST, fresh);
      setChats(fresh);
      setOffline(false);
    } catch (e) {
      if (isOffline(e)) setOffline(true);
      setChats((c) => c ?? []);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useLive((m) => {
    if (m.type === "group_changed" || m.type === "reconnected") void load();
  });
  return { chats, offline, reload: load };
}

/** A message on its way: waiting in the outbox, or refused (with why). */
export interface Pending {
  id: string;
  text: string;
  at: number;
  failed?: string;
  /** A question for everyone, still on its way. */
  poll?: boolean;
}

function pendingFor(id: string, waiting: Change[], failed: FailedChange[], topic?: string): Pending[] {
  const paths = [messagesPath(id), pollsPath(id)];
  // Shown where it was written: General, or its topic.
  const mine = (c: Change) =>
    paths.includes(c.path) && ((c.body as { topic_id?: string } | null)?.topic_id ?? "") === (topic ?? "");
  const one = (c: Change) => {
    const b = c.body as { text?: string; question?: string } | null;
    return { id: c.id, text: String(b?.text ?? b?.question ?? ""), at: c.at, poll: c.path === pollsPath(id) };
  };
  return [
    ...waiting.filter(mine).map(one),
    ...failed.filter(mine).map((c) => ({ ...one(c), failed: c.reason })),
  ];
}

/** One chat: the kept copy at once, then fresh; refreshes on live pings and after sends. */
export function useChat(id: string, around?: string, topic?: string) {
  const [chat, setChat] = useState<GroupView | null>(() => (around ? null : kept(id, topic)));
  // Another topic opened: its kept copy at once.
  const shownTopic = useRef(topic);
  if (shownTopic.current !== topic) {
    shownTopic.current = topic;
    // A topic not on the phone yet keeps the chat (its topics, to go back) with no messages
    // until it loads (Codex on PR 221: offline, the topic chips vanished).
    setChat((prev) =>
      around ? null : (kept(id, topic) ?? (prev ? { ...prev, messages: [], topic: topic ?? null } : null)),
    );
  }
  const [error, setError] = useState("");
  const box = useSyncExternalStore(subscribe, outboxState, outboxState);
  const pending = pendingFor(id, box.waiting, box.failed, topic);
  const load = useCallback(async () => {
    try {
      const query = [around ? `around=${enc(around)}` : "", topic ? `topic=${enc(topic)}` : ""]
        .filter(Boolean)
        .join("&");
      const fresh = await request<GroupView>("GET", `/api/groups/${enc(id)}${query ? `?${query}` : ""}`);
      // A late answer for the topic left behind doesn't replace the one now shown.
      if (shownTopic.current !== topic) return;
      // The kept copy is the newest part (what opens offline), not a search's window.
      if (!around) writeJson(ONE(id, topic), fresh);
      setChat(fresh);
      setError("");
      // Opening it reads it (a read marker; fine to miss offline).
      void request("POST", `/api/groups/${enc(id)}/read`, {}).catch(() => undefined);
    } catch (e) {
      if (isOffline(e))
        setError(
          readJson(ONE(id, topic))
            ? ""
            : topic
              ? "Offline: this topic isn't on the phone yet."
              : "Offline: this chat isn't on the phone yet.",
        );
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [id, around, topic]);
  useEffect(() => void load(), [load]);
  // "Saved to …" marks still on their way show at once too.
  const prefix = `/api/groups/${enc(id)}/messages/`;
  const savingNow = box.waiting.flatMap((c) =>
    c.path.startsWith(prefix) && c.path.endsWith("/saved")
      ? [
          [
            decodeURIComponent(c.path.slice(prefix.length, -"/saved".length)),
            String((c.body as { label?: string }).label ?? ""),
          ] as const,
        ]
      : [],
  );
  // My answers to questions, still on their way, show as mine at once.
  const votePrefix = `/api/groups/${enc(id)}/polls/`;
  const votingNow = box.waiting.flatMap((c) =>
    c.path.startsWith(votePrefix) && c.path.endsWith("/vote")
      ? [
          [
            decodeURIComponent(c.path.slice(votePrefix.length, -"/vote".length)),
            (c.body as { option?: string | null }).option ?? null,
          ] as const,
        ]
      : [],
  );
  const withSaves =
    chat && savingNow.length ? { ...chat, saved: { ...chat.saved, ...Object.fromEntries(savingNow) } } : chat;
  const shown =
    withSaves && votingNow.length
      ? {
          ...withSaves,
          polls: Object.fromEntries(
            Object.entries(withSaves.polls ?? {}).map(([mid, p]) => {
              const v = votingNow.filter(([m]) => m === mid).at(-1);
              // `was`: my answer as the server has it, so the card can move my name over too.
              return [mid, v ? { ...p, mine: v[1], was: p.mine } : p];
            }),
          ),
        }
      : withSaves;
  // Once a sent message (or a mark) has left the outbox, fetch so it shows as done.
  const waitingHere = pending.filter((p) => !p.failed).length + savingNow.length + votingNow.length;
  useEffect(() => {
    if (!waitingHere) void load();
  }, [waitingHere, load]);
  useLive((m) => {
    if ((m.type === "group_changed" && m.group_id === id) || m.type === "reconnected") void load();
  });
  return { chat: shown, pending, error, reload: load };
}

/** Writes in a chat (or one of its topics); works offline (sent when there's a connection). */
export function sendChatMessage(id: string, text: string, topic?: string) {
  send({
    kind: "chat_message",
    method: "POST",
    path: messagesPath(id),
    body: { text, ...(topic ? { topic_id: topic } : {}) },
    label: text.length > 40 ? text.slice(0, 40) + "…" : text,
  });
}

// online-only: who I can chat with comes from the server (it checks who I know).
export const chatPeople = () => request<ChatPerson[]>("GET", "/api/chat-people");

// The chat being started: the same id and Idempotency-Key until it's made, so trying again
// after a lost reply opens the one already made instead of making a second.
let attempt: { what: string; id: string; key: string } | null = null;

// online-only: starting a chat needs the server to check the people and make the chat once.
export async function startChat(input: { people: string[]; name?: string }): Promise<GroupView> {
  const direct = input.people.length === 1 && !input.name;
  const body = {
    people: [...input.people].sort(),
    ...(direct ? { direct: true } : { name: input.name ?? "" }),
  };
  const what = JSON.stringify(body);
  if (attempt?.what !== what) attempt = { what, id: ulid(), key: ulid() };
  const made = await request<GroupView>("POST", "/api/groups", { id: attempt.id, ...body }, attempt.key);
  attempt = null;
  writeJson(ONE(made.id), made);
  return made;
}

export type { GroupMessage, GroupSummary, GroupView, ChatPerson };

// online-only: the assistant proposes where a message goes; that needs the server and the model.
export const proposeSave = (groupId: string, messageId: string, action?: string) =>
  request<SaveProposal>(
    "POST",
    `/api/groups/${enc(groupId)}/messages/${enc(messageId)}/save`,
    action ? { action } : {},
  );

// online-only: a proposal is confirmed (or dropped) on the server, where it waits.
export const answerProposal = (chatId: string, actionId: string, what: "confirm" | "cancel") =>
  request<ChatView>("POST", `/api/chats/${enc(chatId)}/actions/${enc(actionId)}/${what}`, {});

/** "Saved to Gigs ✓" under a message (only I see it); works offline. */
export function markSaved(groupId: string, messageId: string, label: string) {
  send({
    kind: "chat_saved",
    method: "POST",
    path: `/api/groups/${enc(groupId)}/messages/${enc(messageId)}/saved`,
    body: { label },
    label: `Saved to ${label}`,
  });
}

/** Without the assistant: the message goes to my Inbox as it is (works offline). */
export function saveToInbox(text: string) {
  send({
    kind: "capture",
    method: "POST",
    path: "/api/inbox",
    body: { text, source: "chat" },
    label: text.length > 40 ? text.slice(0, 40) + "…" : text,
  });
}

/** Where a proposal saves to, for the label: "Add to Gigs" → "Gigs". */
export const savedLabel = (title: string) => title.replace(/^Add to\s+/i, "").trim() || "your lists";

/** Asks everyone in the chat (decision 2026-10-14 "Ask everyone"); works offline. */
export function askEveryone(
  groupId: string,
  question: string,
  options: string[],
  /** A question that acts: the pinned record and field the answers fill in; `apply` for a
   *  plain field (the most picked answer sets it as the lead changes, or when I say). */
  about?: { share_id: string; field: string; apply?: "auto" | "ask" },
) {
  send({
    kind: "poll",
    method: "POST",
    path: pollsPath(groupId),
    body: { question, options, ...(about ? { about } : {}) },
    label: question.length > 40 ? question.slice(0, 40) + "…" : question,
  });
}

/** The asker (or an admin) sets the field a question is about to one of its answers. */
export function applyPoll(groupId: string, messageId: string, option: string) {
  send({
    kind: "poll_apply",
    method: "POST",
    path: `/api/groups/${enc(groupId)}/polls/${enc(messageId)}/apply`,
    body: { option },
    label: `Set to ${option}`,
  });
}

/** My answer to a question in a chat (null takes it back); works offline. */
export function votePoll(groupId: string, messageId: string, option: string | null) {
  send({
    kind: "vote",
    method: "POST",
    path: `/api/groups/${enc(groupId)}/polls/${enc(messageId)}/vote`,
    body: { option },
    label: option ? `Answer: ${option}` : "Answer taken back",
  });
}

// online-only: a topic is made by the server (the chat's object checks who may), once per id.
// The topic being started: the same id and key until it's made, so trying again after a lost
// reply opens the one already made instead of making a second.
let topicAttempt: { what: string; id: string; key: string } | null = null;
export async function startTopic(groupId: string, name: string): Promise<GroupView> {
  const what = `${groupId}\n${name.trim().toLowerCase()}`;
  if (topicAttempt?.what !== what) topicAttempt = { what, id: ulid(), key: `topic-${ulid()}` };
  const v = await request<GroupView>(
    "POST",
    `/api/groups/${enc(groupId)}/topics`,
    { id: topicAttempt.id, name: name.trim() },
    topicAttempt.key,
  );
  topicAttempt = null;
  return v;
}

// online-only: closing or reopening a topic is checked by the chat's object (starter or admin).
export async function closeTopic(groupId: string, topicId: string, closed: boolean): Promise<GroupView> {
  return request<GroupView>("POST", `/api/groups/${enc(groupId)}/topics/${enc(topicId)}/closed`, {
    closed,
  });
}
