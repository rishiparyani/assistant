// Group chats (chat-first step 7): in the app only (never API tokens or MCP).
import { z } from "zod";
import { AddGroupPeopleInput, CreateGroupInput, GroupRef, PostGroupMessageInput } from "@assistant/shared";
import { defineOperation, type AnyOperation } from "../operations.ts";
import { addGroupPeople, createGroup, groupView, leaveGroup, myGroups, postGroupMessage } from "./service.ts";

export function groupOperations(all: () => readonly AnyOperation[]) {
  return [
    defineOperation({
      id: "core.list_groups",
      tool: "list_groups",
      description: "My group chats.",
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/groups" },
      input: z.object({}),
      handler: (ctx) => myGroups(ctx),
    }),
    defineOperation({
      id: "core.create_group",
      tool: "create_group",
      description: "Make a group chat with people I know.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/groups", status: 201 },
      input: CreateGroupInput,
      handler: (ctx, i) => createGroup(ctx, i),
    }),
    defineOperation({
      id: "core.get_group",
      tool: "get_group",
      description: "A group chat and its newest messages.",
      kind: "read",
      sessionOnly: true,
      http: { method: "GET", path: "/groups/:group_id" },
      input: GroupRef,
      handler: (ctx, i) => groupView(ctx, i.group_id),
    }),
    defineOperation({
      id: "core.post_group_message",
      tool: "post_group_message",
      description: "Write in a group chat; @assistant asks the assistant (if it's on for me).",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/groups/:group_id/messages" },
      input: PostGroupMessageInput,
      handler: (ctx, i) => postGroupMessage(ctx, all(), i.group_id, i.text),
    }),
    defineOperation({
      id: "core.add_group_people",
      tool: "add_group_people",
      description: "Add people I know to my group chat.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/groups/:group_id/people" },
      input: AddGroupPeopleInput,
      handler: (ctx, i) => addGroupPeople(ctx, i.group_id, i.people),
    }),
    defineOperation({
      id: "core.leave_group",
      tool: "leave_group",
      description: "Leave a group chat.",
      kind: "write",
      sessionOnly: true,
      http: { method: "POST", path: "/groups/:group_id/leave" },
      input: GroupRef,
      handler: (ctx, i) => leaveGroup(ctx, i.group_id),
    }),
  ];
}
