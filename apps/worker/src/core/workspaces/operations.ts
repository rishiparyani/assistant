// Core workspace operations (docs/api.md). Thin: validation and routing come from the
// registry, logic from ./service.ts.
import { z } from "zod";
import { CreateWorkspaceInput, InviteMemberInput, type MeResponse } from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import * as workspaces from "./service.ts";

const invitationId = z.object({ invitation_id: z.string().min(1).max(40) });

export function workspaceOperations(moduleIds: readonly string[]) {
  return [
    defineOperation({
      id: "core.get_me",
      tool: "get_me",
      description: "The signed-in user and the workspaces (personal and collectives) they belong to.",
      scope: "user",
      kind: "read",
      http: { method: "GET", path: "/me" },
      input: z.object({}),
      handler: async (ctx): Promise<MeResponse> => ({
        user: ctx.user,
        workspaces: await workspaces.listWorkspaces(ctx),
      }),
    }),
    defineOperation({
      id: "core.create_band_workspace",
      tool: "create_band_workspace",
      description: "Create a collective (shared workspace); the caller becomes its owner.",
      scope: "user",
      kind: "write",
      http: { method: "POST", path: "/workspaces", status: 201 },
      input: CreateWorkspaceInput,
      handler: (ctx, input) => workspaces.createBandWorkspace(ctx, input, moduleIds),
    }),
    defineOperation({
      id: "core.get_workspace",
      tool: "get_workspace",
      description: "A workspace's members, enabled modules and (for owners) pending invitations.",
      scope: "workspace",
      kind: "read",
      http: { method: "GET", path: "" },
      input: z.object({}),
      handler: (ctx) => workspaces.getWorkspaceDetail(ctx),
    }),
    defineOperation({
      id: "core.invite_member",
      tool: "invite_member",
      description: "Invite someone to a collective by email. Returns a link to send them (no email is sent).",
      scope: "workspace",
      kind: "write",
      role: "owner",
      http: { method: "POST", path: "/invitations", status: 201 },
      input: InviteMemberInput,
      handler: (ctx, input) => workspaces.inviteMember(ctx, input),
    }),
    defineOperation({
      id: "core.cancel_invitation",
      tool: "cancel_invitation",
      description: "Cancel a pending invitation.",
      scope: "workspace",
      kind: "write",
      role: "owner",
      http: { method: "DELETE", path: "/invitations/:invitation_id" },
      input: invitationId,
      handler: async (ctx, input) => {
        await workspaces.cancelInvitation(ctx, input.invitation_id);
        return { canceled: true };
      },
    }),
    defineOperation({
      id: "core.remove_member",
      tool: "remove_member",
      description: "Remove a member from a collective (not the last owner).",
      scope: "workspace",
      kind: "write",
      role: "owner",
      confirm: true,
      http: { method: "DELETE", path: "/members/:member_id" },
      input: z.object({ member_id: z.string().min(1).max(40) }),
      handler: async (ctx, input) => {
        await workspaces.removeMember(ctx, input.member_id);
        return { removed: true };
      },
    }),
    defineOperation({
      id: "core.get_invitation",
      tool: "get_invitation",
      description: "An invitation addressed to the signed-in user's email.",
      scope: "user",
      kind: "read",
      http: { method: "GET", path: "/invitations/:invitation_id" },
      input: invitationId,
      handler: (ctx, input) => workspaces.getInvitation(ctx, input.invitation_id),
    }),
    defineOperation({
      id: "core.accept_invitation",
      tool: "accept_invitation",
      description: "Accept an invitation addressed to the signed-in user's email.",
      scope: "user",
      kind: "write",
      http: { method: "POST", path: "/invitations/:invitation_id/accept" },
      input: invitationId,
      handler: (ctx, input) => workspaces.acceptInvitation(ctx, input.invitation_id),
    }),
  ];
}
