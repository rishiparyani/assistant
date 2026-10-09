// The chat with the in-app assistant (design §10): session-only actions (never API tokens
// or MCP; outside assistants call the tools directly). They need every other operation,
// because the assistant's tools are those operations.
import { z } from "zod";
import { ChatActionRef, ChatSendInput } from "@assistant/shared";
import { defineOperation, type AnyOperation } from "../operations.ts";
import { cancelAction, chatView, clearChat, confirmAction, sendMessage } from "./service.ts";

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
    defineOperation({
      id: "core.chat_confirm",
      tool: "chat_confirm",
      description: "Confirm what a card shows.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/chat/actions/:action_id/confirm" },
      input: ChatActionRef,
      handler: (ctx, i) => confirmAction(ctx, all(), i.action_id),
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
      id: "core.chat_clear",
      tool: "chat_clear",
      description: "Start a new chat.",
      kind: "write",
      sessionOnly: true,
      http: { method: "DELETE", path: "/chat" },
      input: z.object({}),
      handler: (ctx) => clearChat(ctx),
    }),
  ];
}
