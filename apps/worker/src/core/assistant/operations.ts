// The chat with the in-app assistant (design §10): session-only actions (never API tokens
// or MCP; outside assistants call the tools directly). They need every other operation,
// because the assistant's tools are those operations.
import { z } from "zod";
import {
  CaptureInput,
  type RecordView,
  ChatActionIn,
  ChatActionRef,
  ChatFeedbackInput,
  ChatRef,
  ShowInChatInput,
  AssistantAccessInput,
  ChatSendInput,
  ChatSendTo,
  MemoryRef,
  NewChatInput,
  RememberInput,
  SpaceRef,
} from "@assistant/shared";
import { defineOperation, type AnyOperation } from "../operations.ts";
import { assistantAllowed, assistantPeople, setAssistantAccess } from "./access.ts";
import {
  cancelAction,
  chatView,
  clearChat,
  confirmAction,
  rateAnswer,
  deleteChat,
  showInChat,
  forgetMemory,
  listChats,
  currentChat,
  listMemories,
  newChat,
  remember,
  sendMessage,
} from "./service.ts";

import { spaceOf } from "../spaces/service.ts";

export function assistantOperations(all: () => readonly AnyOperation[]) {
  return [
    defineOperation({
      id: "core.chat",
      tool: "chat",
      description: "My chat with the assistant.",
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/chat" },
      input: z.object({}),
      handler: (ctx) => chatView(ctx),
    }),
    defineOperation({
      id: "core.chat_send",
      tool: "chat_send",
      description: "Send the assistant a message.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chat" },
      input: ChatSendInput,
      handler: (ctx, i) => sendMessage(ctx, all(), i),
    }),
    // The Inbox (home-first.md §2 point 12): something captured from Siri, the share sheet,
    // a chat or a screenshot's text goes in the Inbox list (a card on the home) and, for a
    // person with the assistant, into the chat, where the assistant proposes where it goes
    // (a card to tap); its one-line answer is kept on the item as the guess. Sorting is a
    // sentence in the chat ("put it in Expenses"); ticking Sorted on the card puts it away.
    defineOperation({
      id: "core.capture",
      tool: "capture",
      description:
        "Put something captured (from Siri, the share sheet, a chat, a screenshot's text) in the Inbox and ask where it goes.",
      kind: "write",
      http: { method: "POST", path: "/inbox", status: 201 },
      input: CaptureInput,
      handler: async (ctx, i): Promise<{ record: RecordView; guess: string | null }> => {
        const { stub, actor } = await spaceOf(ctx, i.space);
        const inbox = await stub.startList(
          actor,
          ctx.idempotencyKey && `${ctx.idempotencyKey}:list`,
          "inbox",
        );
        const source = {
          siri: "Siri",
          share: "Share sheet",
          chat: "Chat",
          whatsapp: "WhatsApp",
          other: "Other",
        }[i.source];
        let record = await stub.addRecord(actor, ctx.idempotencyKey, inbox.id, {
          values: { Text: i.text, Source: source, Sorted: false },
        });
        let guess: string | null = null;
        if (await assistantAllowed(ctx)) {
          // Proposals only: whatever the model would file becomes a card the person taps.
          const chat = await sendMessage(
            ctx,
            all(),
            {
              text: `Captured from ${source}: ${i.text}\n(Where should this go? Propose the add; I'll tap.)`,
            },
            undefined,
            { proposeOnly: true },
          );
          const reply = [...chat.items].reverse().find((x) => x.role === "assistant" || x.role === "card");
          guess = reply?.text?.slice(0, 500) ?? null;
          if (guess)
            record = await stub.updateRecord(
              actor,
              ctx.idempotencyKey && `${ctx.idempotencyKey}:guess`,
              record.id,
              {
                values: { Guess: guess },
              },
            );
        }
        return { record, guess };
      },
    }),
    defineOperation({
      id: "core.chat_confirm",
      tool: "chat_confirm",
      description: "Confirm what a card shows.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chat/actions/:action_id/confirm" },
      input: ChatActionRef,
      handler: (ctx, i) => confirmAction(ctx, all(), i.action_id, undefined, i.args),
    }),
    defineOperation({
      id: "core.chat_cancel",
      tool: "chat_cancel",
      description: "Cancel what a card shows.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chat/actions/:action_id/cancel" },
      input: ChatActionRef,
      handler: (ctx, i) => cancelAction(ctx, i.action_id),
    }),
    defineOperation({
      id: "core.chat_feedback",
      tool: "chat_feedback",
      description: "Rate an answer 👍 or 👎 (only the rating is kept).",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chat/feedback" },
      input: ChatFeedbackInput,
      handler: (ctx, i) => rateAnswer(ctx, i.rating),
    }),
    defineOperation({
      id: "core.chat_clear",
      tool: "chat_clear",
      description: "Start a new chat.",
      kind: "write",
      sessionOnly: true,
      http: { method: "DELETE", path: "/chat" },
      input: z.object({}),
      handler: (ctx) => clearChat(ctx),
    }),

    // Several chats (docs/design/chat-first.md step 3). "main" is the person's first chat.
    defineOperation({
      id: "core.chats",
      tool: "list_chats",
      description: "My chats with the assistant, newest first.",
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/chats" },
      input: z.object({}),
      handler: (ctx) => listChats(ctx),
    }),
    defineOperation({
      id: "core.chat_new",
      tool: "new_chat",
      description: "Start a new chat (the old ones stay in the list).",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chats", status: 201 },
      input: NewChatInput,
      handler: (ctx, i) => newChat(ctx, i.id, i.space),
    }),
    defineOperation({
      id: "core.chat_current",
      tool: "current_chat",
      description: "The chat to open: the latest if used in the last two hours, else a new one.",
      // A read for the caller (no key: opening the app must never need one); the chat it
      // may start is the one a later send would start anyway.
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/chats/current" },
      input: SpaceRef,
      handler: (ctx, i) => currentChat(ctx, i.space),
    }),
    defineOperation({
      id: "core.chat_open",
      tool: "open_chat",
      description: "One of my chats.",
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/chats/:chat_id" },
      input: ChatRef,
      handler: (ctx, i) => chatView(ctx, i.chat_id),
    }),
    defineOperation({
      id: "core.chat_send_to",
      tool: "chat_send_to",
      description: "Send a message in one of my chats.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chats/:chat_id" },
      input: ChatSendTo,
      handler: (ctx, i) => sendMessage(ctx, all(), i, i.chat_id),
    }),
    defineOperation({
      id: "core.chat_confirm_in",
      tool: "chat_confirm_in",
      description: "Confirm what a card in one of my chats shows.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chats/:chat_id/actions/:action_id/confirm" },
      input: ChatActionIn,
      handler: (ctx, i) => confirmAction(ctx, all(), i.action_id, i.chat_id, i.args),
    }),
    defineOperation({
      id: "core.chat_cancel_in",
      tool: "chat_cancel_in",
      description: "Cancel what a card in one of my chats shows.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chats/:chat_id/actions/:action_id/cancel" },
      input: ChatActionIn,
      handler: (ctx, i) => cancelAction(ctx, i.action_id, i.chat_id),
    }),
    // Who else may use the assistant (owners and admins switch it per person; it costs them).
    defineOperation({
      id: "core.assistant_people",
      tool: "assistant_people",
      description: "People I know, with whether the assistant is on for them (owners only).",
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/assistant/people" },
      input: z.object({}),
      handler: (ctx) => assistantPeople(ctx),
    }),
    defineOperation({
      id: "core.assistant_access",
      tool: "set_assistant_access",
      description: "Switch the assistant on or off for someone I know (owners only).",
      kind: "write",
      sessionOnly: true,
      http: { method: "PUT", path: "/assistant/people/:user_id" },
      input: AssistantAccessInput,
      handler: (ctx, i) => setAssistantAccess(ctx, i.user_id, i.on),
    }),
    defineOperation({
      id: "core.chat_show",
      tool: "show_in_chat",
      description: "Put a live card (a record, a saved view or a question) in one of my chats.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chats/:chat_id/live" },
      input: ShowInChatInput,
      handler: (ctx, i) => showInChat(ctx, i.chat_id, i.live),
    }),
    defineOperation({
      id: "core.chat_delete",
      tool: "delete_chat",
      description: "Delete one of my chats (the main chat is cleared instead).",
      kind: "write",
      sessionOnly: true,
      http: { method: "DELETE", path: "/chats/:chat_id" },
      input: ChatRef,
      handler: (ctx, i) => deleteChat(ctx, i.chat_id),
    }),

    // Memory: what the assistant keeps for the person. Also tools for the assistant itself.
    defineOperation({
      id: "core.memories",
      tool: "list_memories",
      description: "What the assistant remembers for me.",
      kind: "read",
      http: { method: "GET", path: "/memories" },
      input: z.object({}),
      handler: (ctx) => listMemories(ctx),
    }),
    defineOperation({
      id: "core.remember",
      tool: "remember",
      description:
        "Remember a fact or preference the person asked you to keep (one short sentence), so every chat can use it.",
      kind: "write",
      http: { method: "POST", path: "/memories", status: 201 },
      input: RememberInput,
      handler: (ctx, i) => remember(ctx, i.text, i.space),
    }),
    defineOperation({
      id: "core.forget_memory",
      tool: "forget_memory",
      description: "Forget something remembered earlier (by its id from list_memories). Needs confirmation.",
      kind: "write",
      // A delete: outside assistants get a preview to confirm (rule 9); the in-app one a card.
      confirm: true,
      http: { method: "DELETE", path: "/memories/:memory_id" },
      input: MemoryRef,
      handler: (ctx, i) => forgetMemory(ctx, i.memory_id),
    }),
  ];
}
