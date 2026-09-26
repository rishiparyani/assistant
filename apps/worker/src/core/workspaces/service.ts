// Workspaces, memberships and invitations. All writes go through here (Better Auth's
// own /auth/organization endpoints are blocked), in one D1 batch with their audit entry.
import { and, asc, eq, gt } from "drizzle-orm";
import {
  type CreateWorkspaceInput,
  type InviteMemberInput,
  ulid,
  type InvitationView,
  type MemberView,
  type Role,
  type WorkspaceDetail,
  type WorkspaceKind,
  type WorkspaceSummary,
} from "@assistant/shared";
import { invitation, member, organization, user, workspaceModules } from "../db/schema.ts";
import { auditStatement } from "../audit.ts";
import { AppError } from "../errors.ts";
import type { UserCtx } from "../context.ts";
import type { OpCtx, OpUserCtx } from "../operations.ts";

const INVITATION_DAYS = 7;
const nowIso = () => new Date().toISOString();

function slugFor(name: string, id: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "workspace"}-${id.slice(-6).toLowerCase()}`;
}

function createWorkspaceStatements(
  d1: D1Database,
  ws: { id: string; name: string; kind: WorkspaceKind },
  ownerUserId: string,
  moduleIds: readonly string[],
) {
  const ts = nowIso();
  return [
    d1
      .prepare(`insert into organization (id, name, slug, createdAt, kind) values (?, ?, ?, ?, ?)`)
      .bind(ws.id, ws.name, slugFor(ws.name, ws.id), ts, ws.kind),
    d1
      .prepare(
        `insert into member (id, organizationId, userId, role, createdAt) values (?, ?, ?, 'owner', ?)`,
      )
      .bind(ulid(), ws.id, ownerUserId, ts),
    ...moduleIds.map((m) =>
      d1
        .prepare(`insert into workspace_modules (workspace_id, module_id, enabled) values (?, ?, 1)`)
        .bind(ws.id, m),
    ),
  ];
}

/** Called once per new user (Better Auth hook). */
export async function createPersonalWorkspace(
  d1: D1Database,
  owner: { id: string; name: string },
  moduleIds: readonly string[],
) {
  const ws = {
    id: ulid(),
    name: owner.name ? `${owner.name} (personal)` : "Personal",
    kind: "personal" as const,
  };
  await d1.batch([
    ...createWorkspaceStatements(d1, ws, owner.id, moduleIds),
    auditStatement(d1, {
      workspaceId: ws.id,
      actorUserId: owner.id,
      source: "system",
      module: "core",
      action: "create_workspace",
      entityType: "workspace",
      entityId: ws.id,
      after: ws,
    }),
  ]);
  return ws;
}

export async function listWorkspaces(ctx: UserCtx): Promise<WorkspaceSummary[]> {
  const rows = await ctx.db
    .select({ id: organization.id, name: organization.name, kind: organization.kind, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, ctx.user.id))
    .orderBy(asc(organization.name));
  // Personal workspace first, then bands by name.
  return rows
    .map((r) => ({ id: r.id, name: r.name, kind: (r.kind ?? "band") as WorkspaceKind, role: r.role as Role }))
    .sort((a, b) => Number(b.kind === "personal") - Number(a.kind === "personal"));
}

export async function createBandWorkspace(
  ctx: OpUserCtx,
  input: CreateWorkspaceInput,
  moduleIds: readonly string[],
): Promise<WorkspaceSummary> {
  const ws = { id: ulid(), name: input.name, kind: "band" as const };
  await ctx.commit(createWorkspaceStatements(ctx.d1, ws, ctx.user.id, moduleIds), {
    entityType: "workspace",
    entityId: ws.id,
    workspaceId: ws.id,
    after: ws,
  });
  return { ...ws, role: "owner" };
}

function invitationView(
  ctx: UserCtx,
  row: {
    id: string;
    organizationId: string;
    email: string;
    role: string | null;
    status: string;
    expiresAt: string;
  },
  workspaceName: string,
): InvitationView {
  const expired = row.status === "pending" && row.expiresAt < nowIso();
  return {
    id: row.id,
    workspace_id: row.organizationId,
    workspace_name: workspaceName,
    email: row.email,
    role: (row.role ?? "member") as Role,
    status: (expired ? "expired" : row.status) as InvitationView["status"],
    expires_at: row.expiresAt,
    url: new URL(`/invite/${row.id}`, ctx.baseUrl).toString(),
  };
}

export async function getWorkspaceDetail(ctx: OpCtx): Promise<WorkspaceDetail> {
  const ws = ctx.workspace;
  const members: MemberView[] = (
    await ctx.db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ws.id))
      .orderBy(asc(user.name))
  ).map((m) => ({
    id: m.id,
    user_id: m.userId,
    name: m.name,
    email: m.email,
    role: m.role as Role,
    joined_at: m.createdAt,
  }));
  const invitations =
    ws.role === "owner"
      ? (
          await ctx.db
            .select()
            .from(invitation)
            .where(
              and(
                eq(invitation.organizationId, ws.id),
                eq(invitation.status, "pending"),
                gt(invitation.expiresAt, nowIso()),
              ),
            )
        ).map((i) => invitationView(ctx, i, ws.name))
      : [];
  const modules = (
    await ctx.db
      .select({ moduleId: workspaceModules.moduleId })
      .from(workspaceModules)
      .where(and(eq(workspaceModules.workspaceId, ws.id), eq(workspaceModules.enabled, true)))
  ).map((m) => m.moduleId);
  return { id: ws.id, name: ws.name, kind: ws.kind, role: ws.role, members, invitations, modules };
}

export async function inviteMember(ctx: OpCtx, input: InviteMemberInput): Promise<InvitationView> {
  const ws = ctx.workspace;
  if (ws.kind === "personal")
    throw new AppError("validation_failed", "Personal workspaces can't have other members");
  const [existing] = await ctx.db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ws.id), eq(user.email, input.email)))
    .limit(1);
  if (existing) throw new AppError("conflict", `${input.email} is already a member`);

  const id = ulid();
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000).toISOString();
  const row = {
    id,
    organizationId: ws.id,
    email: input.email,
    role: input.role,
    status: "pending",
    expiresAt,
  };
  await ctx.commit(
    [
      // Re-inviting replaces any earlier pending invitation for the same email.
      ctx.d1
        .prepare(
          `update invitation set status = 'canceled' where organizationId = ? and lower(email) = ? and status = 'pending'`,
        )
        .bind(ws.id, input.email),
      ctx.d1
        .prepare(
          `insert into invitation (id, organizationId, email, role, status, expiresAt, createdAt, inviterId) values (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(id, ws.id, input.email, input.role, expiresAt, ts, ctx.user.id),
    ],
    { entityType: "invitation", entityId: id, after: { email: input.email, role: input.role, expiresAt } },
  );
  return invitationView(ctx, row, ws.name);
}

async function loadInvitationForUser(ctx: UserCtx, invitationId: string) {
  const [row] = await ctx.db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      workspaceName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, invitationId))
    .limit(1);
  // Only the invited email can see an invitation; anyone else gets "not found".
  if (!row || row.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
    throw new AppError(
      "not_found",
      "Invitation not found. Make sure you're signed in with the email address it was sent to.",
    );
  }
  return row;
}

export async function getInvitation(ctx: UserCtx, invitationId: string): Promise<InvitationView> {
  const row = await loadInvitationForUser(ctx, invitationId);
  return invitationView(ctx, row, row.workspaceName);
}

export async function acceptInvitation(ctx: OpUserCtx, invitationId: string): Promise<WorkspaceSummary> {
  const row = await loadInvitationForUser(ctx, invitationId);
  const view = invitationView(ctx, row, row.workspaceName);
  if (view.status !== "pending") throw new AppError("conflict", `This invitation is ${view.status}`);
  const summary = { id: row.organizationId, name: row.workspaceName, kind: "band" as const, role: view.role };
  const [already] = await ctx.db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, row.organizationId), eq(member.userId, ctx.user.id)))
    .limit(1);
  const memberId = ulid();
  await ctx.commit(
    [
      ...(already
        ? []
        : [
            ctx.d1
              .prepare(
                `insert into member (id, organizationId, userId, role, createdAt) values (?, ?, ?, ?, ?)`,
              )
              .bind(memberId, row.organizationId, ctx.user.id, view.role, nowIso()),
          ]),
      ctx.d1.prepare(`update invitation set status = 'accepted' where id = ?`).bind(row.id),
    ],
    {
      entityType: "member",
      entityId: already?.id ?? memberId,
      workspaceId: row.organizationId,
      after: { userId: ctx.user.id, role: view.role, invitationId: row.id },
    },
  );
  return summary;
}

export async function cancelInvitation(ctx: OpCtx, invitationId: string) {
  const [row] = await ctx.db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, ctx.workspace.id)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Invitation not found");
  if (row.status !== "pending") return;
  await ctx.commit([ctx.d1.prepare(`update invitation set status = 'canceled' where id = ?`).bind(row.id)], {
    entityType: "invitation",
    entityId: row.id,
    before: { email: row.email, status: row.status },
  });
}

export async function removeMember(ctx: OpCtx, memberId: string) {
  const ws = ctx.workspace;
  const members = await ctx.db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, ws.id));
  const target = members.find((m) => m.id === memberId);
  if (!target) throw new AppError("not_found", "Member not found");
  if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) {
    throw new AppError("conflict", "A workspace needs at least one owner");
  }
  await ctx.commit(
    [ctx.d1.prepare(`delete from member where id = ? and organizationId = ?`).bind(target.id, ws.id)],
    { entityType: "member", entityId: target.id, before: target },
  );
}
