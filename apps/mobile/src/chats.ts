// Chats with people (decision 2026-10-13 "Chats with people"): groups and chats for two, kept
// on the phone so they open offline. Messages go through the outbox like any other change,
// show at once as "sending", and are sent in order when there's a connection.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
const ONE = (id: string) => `gigspree:chat:${id}`;
const enc = encodeURIComponent;
const messagesPath = (id: string) => `/api/groups/${enc(id)}/messages`;

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
}

function pendingFor(id: string, waiting: Change[], failed: FailedChange[]): Pending[] {
  const path = messagesPath(id);
  const text = (c: Change) => String((c.body as { text?: string } | null)?.text ?? "");
  return [
    ...waiting.filter((c) => c.path === path).map((c) => ({ id: c.id, text: text(c), at: c.at })),
    ...failed
      .filter((c) => c.path === path)
      .map((c) => ({ id: c.id, text: text(c), at: c.at, failed: c.reason })),
  ];
}

/** One chat: the kept copy at once, then fresh; refreshes on live pings and after sends. */
export function useChat(id: string) {
  const [chat, setChat] = useState<GroupView | null>(() => readJson<GroupView>(ONE(id)));
  const [error, setError] = useState("");
  const box = useSyncExternalStore(subscribe, outboxState, outboxState);
  const pending = pendingFor(id, box.waiting, box.failed);
  const load = useCallback(async () => {
    try {
      const fresh = await request<GroupView>("GET", `/api/groups/${enc(id)}`);
      writeJson(ONE(id), fresh);
      setChat(fresh);
      setError("");
      // Opening it reads it (a read marker; fine to miss offline).
      void request("POST", `/api/groups/${enc(id)}/read`, {}).catch(() => undefined);
    } catch (e) {
      if (isOffline(e)) setError(readJson(ONE(id)) ? "" : "Offline: this chat isn't on the phone yet.");
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
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
  const shown =
    chat && savingNow.length ? { ...chat, saved: { ...chat.saved, ...Object.fromEntries(savingNow) } } : chat;
  // Once a sent message (or a mark) has left the outbox, fetch so it shows as done.
  const waitingHere = pending.filter((p) => !p.failed).length + savingNow.length;
  useEffect(() => {
    if (!waitingHere) void load();
  }, [waitingHere, load]);
  useLive((m) => {
    if ((m.type === "group_changed" && m.group_id === id) || m.type === "reconnected") void load();
  });
  return { chat: shown, pending, error, reload: load };
}

/** Writes in a chat; works offline (sent when there's a connection). */
export function sendChatMessage(id: string, text: string) {
  send({
    kind: "chat_message",
    method: "POST",
    path: messagesPath(id),
    body: { text },
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
export const proposeSave = (groupId: string, messageId: string) =>
  request<SaveProposal>("POST", `/api/groups/${enc(groupId)}/messages/${enc(messageId)}/save`, {});

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
