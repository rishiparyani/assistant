// The chats with the in-app assistant and what it remembers (docs/design/chat-first.md).
// No logic here. "main" is the person's first chat.
import { ulid, type ChatSummary, type ChatView, type LiveRef, type Memory } from "@assistant/shared";
import { request } from "../api.ts";
import { publish } from "../query.svelte.ts";
import { navigate } from "../router.svelte.ts";
import { toast } from "../ui/index.ts";

const enc = encodeURIComponent;

export const MAIN_CHAT = "main";
export const chatKey = (id: string) => `chat:view:${id}`;
export const CHATS_KEY = "chat:list";
export const MEMORIES_KEY = "chat:memories";
/** Where a chat opens: the main chat is the home page. */
export const chatPath = (id: string) => (id === MAIN_CHAT ? "/" : `/chat/${enc(id)}`);

export const chatApi = {
  get: (id: string) => request<ChatView>("GET", `/api/chats/${enc(id)}`),
  list: () => request<ChatSummary[]>("GET", "/api/chats"),
  // online-only: the assistant answers on the server (models, budget, tools).
  send: (id: string, text: string, thinkHarder = false) =>
    request<ChatView>("POST", `/api/chats/${enc(id)}`, {
      text,
      ...(thinkHarder ? { think_harder: true } : {}),
    }),
  // online-only: a confirm card runs its action on the server, once.
  confirm: (id: string, actionId: string) =>
    request<ChatView>("POST", `/api/chats/${enc(id)}/actions/${enc(actionId)}/confirm`, {}),
  // online-only: answers a card on the server.
  cancel: (id: string, actionId: string) =>
    request<ChatView>("POST", `/api/chats/${enc(id)}/actions/${enc(actionId)}/cancel`, {}),
  // online-only: a chat lives on the server (the assistant answers there).
  create: (id: string) => request<ChatView>("POST", "/api/chats", { id }),
  // online-only: a chat lives on the server; this puts a card in it (a question from +).
  show: (chatId: string, live: LiveRef) =>
    request<ChatView>("POST", `/api/chats/${enc(chatId)}/live`, { live }),
  // online-only: deletes the chat on the server.
  remove: (id: string) => request<{ deleted: string }>("DELETE", `/api/chats/${enc(id)}`),
  memories: () => request<Memory[]>("GET", "/api/memories"),
  // online-only: memory lives with the assistant on the server.
  forget: (id: string) => request<Memory>("DELETE", `/api/memories/${enc(id)}`),
};

/** "New chat": a fresh chat, opened at once (the old ones stay in the menu). */
export async function startNewChat(): Promise<void> {
  try {
    const view = await chatApi.create(ulid());
    publish(chatKey(view.id), view);
    navigate(chatPath(view.id));
    publish(CHATS_KEY, await chatApi.list());
  } catch (e) {
    toast.error(e);
  }
}

/** Examples people can tap (also on the Help screen). */
export const SUGGESTIONS = [
  "Spent ₹450 on groceries",
  "Remind me tomorrow at 6 to call the venue",
  "What did I spend this month?",
  "Remember: weddings are ₹25,000 for the band",
];
