// Sharing actions (docs/design/universal.md §11). Making or resetting a link happens in the
// app only (a link is a key to the owner's data; assistants don't hand them out). The
// collaborator's actions see only the cards they joined.
import { z } from "zod";
import {
  AddSharedRecordInput,
  CreateShareInput,
  JoinShareInput,
  ListSharesInput,
  SharePersonRef,
  ShareRef,
  SharedRef,
  UpdateSharedRecordInput,
} from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import { spaceOf } from "./service.ts";
import {
  addSharedRecord,
  createShare,
  joinShare,
  leaveShare,
  openShare,
  removeSharePerson,
  resetShareLink,
  sharedTouchesMoney,
  sharedWithMe,
  updateSharedRecord,
} from "./shares.ts";

export const shareOperations = [
  defineOperation({
    id: "core.create_share",
    tool: "create_share",
    description:
      "Share one record (a card) with others by a join link, with the linked parts you include; view or edit; hide fields.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/shares", status: 201 },
    input: CreateShareInput,
    handler: (ctx, i) => createShare(ctx, i),
  }),
  defineOperation({
    id: "core.list_shares",
    tool: "list_shares",
    description: "The cards I've shared (optionally for one record), with who joined.",
    kind: "read",
    http: { method: "GET", path: "/shares" },
    input: ListSharesInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.listShares(actor, i.record_id);
    },
  }),
  defineOperation({
    id: "core.revoke_share",
    tool: "revoke_share",
    description: "Turn a share off: its link stops working and the people in it lose access.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/shares/:share_id" },
    input: ShareRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.revokeShare(actor, ctx.idempotencyKey, i.share_id);
    },
  }),
  defineOperation({
    id: "core.reset_share_link",
    tool: "reset_share_link",
    description: "A new join link for a share; the old link stops working (people who joined stay).",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/shares/:share_id/reset" },
    input: ShareRef,
    handler: (ctx, i) => resetShareLink(ctx, i.space, i.share_id),
  }),
  defineOperation({
    id: "core.remove_share_person",
    tool: "remove_share_person",
    description: "Take one person out of a share.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/shares/:share_id/people/:user_id" },
    input: SharePersonRef,
    handler: (ctx, i) => removeSharePerson(ctx, i.space, i.share_id, i.user_id),
  }),

  // --- Shared with me ---
  defineOperation({
    id: "core.join_share",
    tool: "join_share",
    description: "Join a card someone shared, with the token from their link.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/cards/join" },
    input: JoinShareInput,
    handler: (ctx, i) => joinShare(ctx, i.token),
  }),
  defineOperation({
    id: "core.shared_with_me",
    tool: "shared_with_me",
    description: "Cards others have shared with me.",
    kind: "read",
    http: { method: "GET", path: "/cards" },
    input: z.object({}),
    handler: (ctx) => sharedWithMe(ctx),
  }),
  defineOperation({
    id: "core.open_shared_card",
    tool: "open_shared_card",
    description: "Open a card shared with me: its fields and the linked parts shared with it.",
    kind: "read",
    http: { method: "GET", path: "/cards/:share_id" },
    input: SharedRef,
    handler: (ctx, i) => openShare(ctx, i.share_id),
  }),
  defineOperation({
    id: "core.update_shared_record",
    tool: "update_shared_record",
    description: "Change values on a card shared with me (edit access; only the fields shared).",
    kind: "write",
    http: { method: "PATCH", path: "/cards/:share_id/records/:record_id" },
    input: UpdateSharedRecordInput,
    confirmWhen: (ctx, i) =>
      sharedTouchesMoney(ctx, i.share_id, { recordId: i.record_id }, Object.keys(i.values)),
    handler: (ctx, i) => updateSharedRecord(ctx, i),
  }),
  defineOperation({
    id: "core.add_shared_record",
    tool: "add_shared_record",
    description: "Add a record to a section of a card shared with me (e.g. a guest), linked to the card.",
    kind: "write",
    http: { method: "POST", path: "/cards/:share_id/records", status: 201 },
    input: AddSharedRecordInput,
    confirmWhen: (ctx, i) =>
      sharedTouchesMoney(ctx, i.share_id, { section: i.section }, Object.keys(i.values)),
    handler: (ctx, i) => addSharedRecord(ctx, i),
  }),
  defineOperation({
    id: "core.leave_share",
    tool: "leave_share",
    description: "Leave a card shared with me.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/cards/:share_id" },
    input: SharedRef,
    handler: (ctx, i) => leaveShare(ctx, i.share_id),
  }),
];
