// The chat with the in-app assistant (docs/design/chat-first.md). No logic here.
import type { ChatView } from "@assistant/shared";
import { request } from "../api.ts";
import { publish } from "../query.svelte.ts";
import { confirm, toast } from "../ui/index.ts";

const enc = encodeURIComponent;

export const CHAT_KEY = "chat:view";

export const chatApi = {
  get: () => request<ChatView>("GET", "/api/chat"),
  // online-only: the assistant answers on the server (models, budget, tools).
  send: (text: string, thinkHarder = false) =>
    request<ChatView>("POST", "/api/chat", { text, ...(thinkHarder ? { think_harder: true } : {}) }),
  // online-only: a confirm card runs its action on the server, once.
  confirm: (actionId: string) => request<ChatView>("POST", `/api/chat/actions/${enc(actionId)}/confirm`, {}),
  // online-only: answers a card on the server.
  cancel: (actionId: string) => request<ChatView>("POST", `/api/chat/actions/${enc(actionId)}/cancel`, {}),
  // online-only: starts a new chat on the server.
  clear: () => request<ChatView>("DELETE", "/api/chat"),
};

/** Examples people can tap (also on the Help screen). */
export const SUGGESTIONS = [
  "Spent ₹450 on groceries",
  "Remind me tomorrow at 6 to call the venue",
  "What did I spend this month?",
  "Kal shaam 7 baje rehearsal add karo",
];

/** "New chat" (top bar): the messages go, everything saved stays. */
export async function startNewChat(): Promise<void> {
  const ok = await confirm({
    title: "Start a new chat?",
    message: "The messages go; everything saved stays.",
    confirmLabel: "New chat",
  });
  if (!ok) return;
  try {
    publish(CHAT_KEY, await chatApi.clear());
  } catch (e) {
    toast.error(e);
  }
}
