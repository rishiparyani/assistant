// Sharing actions (docs/design/universal.md §11). Making or resetting a link happens in the
// app only (a link is a key to the owner's data; assistants don't hand them out). The
// collaborator's actions see only the cards they joined.
import { z } from "zod";
import {
  AddSharedCommentInput,
  AddSharedRecordInput,
  SharedCommentRef,
  SharedRecordRef,
  CreateShareInput,
  JoinShareInput,
  ListSharesInput,
  OpenSharedInput,
  SharePersonRef,
  ShareRef,
  SharedRef,
  UpdateSharedRecordInput,
} from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import { spaceOf } from "./service.ts";
import {
  addSharedComment,
  addSharedRecord,
  deleteSharedComment,
  sharedComments,
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
      "Share by a join link: one record as a card (with linked parts you include), a saved view (live), or a collection as a form people fill in; view or edit; hide fields; views and forms can be link-only.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/shares", status: 201 },
    input: CreateShareInput,
    handler: (ctx, i) => createShare(ctx, i),
  }),
  defineOperation({
    id: "core.list_shares",
    tool: "list_shares",
    description:
      "What I've shared (cards, views, forms; optionally for one record, view or collection), with who joined.",
    kind: "read",
    http: { method: "GET", path: "/shares" },
    input: ListSharesInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.listShares(actor, i.target_id ?? i.record_id);
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
    description:
      "Open something shared with me: a card (fields and linked parts), a view (its records) or a form (fields to fill in and what I sent).",
    kind: "read",
    http: { method: "GET", path: "/cards/:share_id" },
    input: OpenSharedInput,
    handler: (ctx, i) => openShare(ctx, i.share_id, i.cursor),
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
    description:
      'Add a record to something shared with me: a card\'s section (e.g. a guest, linked to the card), a view ("view", edit access) or a form ("form").',
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
  defineOperation({
    id: "core.shared_comments",
    tool: "list_shared_comments",
    description: "Comments on a record shared with me.",
    kind: "read",
    http: { method: "GET", path: "/cards/:share_id/records/:record_id/comments" },
    input: SharedRecordRef,
    handler: (ctx, i) => sharedComments(ctx, i.share_id, i.record_id),
  }),
  defineOperation({
    id: "core.add_shared_comment",
    tool: "add_shared_comment",
    description: "Comment on a record shared with me (the owner and others in the share see it).",
    kind: "write",
    http: { method: "POST", path: "/cards/:share_id/records/:record_id/comments", status: 201 },
    input: AddSharedCommentInput,
    handler: (ctx, i) => addSharedComment(ctx, i),
  }),
  defineOperation({
    id: "core.delete_shared_comment",
    tool: "delete_shared_comment",
    description: "Delete my own comment on something shared with me.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/cards/:share_id/comments/:comment_id" },
    input: SharedCommentRef,
    handler: (ctx, i) => deleteSharedComment(ctx, i.share_id, i.comment_id),
  }),
];
