// Per-collective Gigs settings and what they allow (decision 2026-09-27). Owners can always
// do everything; settings only widen what members can see and do.
import { and, eq } from "drizzle-orm";
import { readGigsSettings, type GigsSettings, type UpdateGigsSettingsInput } from "@assistant/shared";
import type { z } from "zod";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { workspaceModules } from "../../../core/db/schema.ts";
import { nowIso } from "./shared.ts";

export async function getSettings(ctx: Pick<OpCtx, "db" | "workspace">): Promise<GigsSettings> {
  const [row] = await ctx.db
    .select({ json: workspaceModules.settingsJson })
    .from(workspaceModules)
    .where(and(eq(workspaceModules.workspaceId, ctx.workspace.id), eq(workspaceModules.moduleId, "gigs")))
    .limit(1);
  return readGigsSettings(row?.json);
}

export async function updateSettings(
  ctx: OpCtx,
  input: z.output<typeof UpdateGigsSettingsInput>,
): Promise<GigsSettings> {
  const before = await getSettings(ctx);
  const after: GigsSettings = {
    lineup_visible_to_members: input.lineup_visible_to_members ?? before.lineup_visible_to_members,
    lineup_editors: input.lineup_editors ?? before.lineup_editors,
    payout_recorders: input.payout_recorders ?? before.payout_recorders,
  };
  await ctx.commit(
    [
      ctx.d1
        .prepare(
          `update workspace_modules set settings_json = ?, updated_at = ? where workspace_id = ? and module_id = 'gigs'`,
        )
        .bind(JSON.stringify(after), nowIso(), ctx.workspace.id),
    ],
    { entityType: "settings", entityId: ctx.workspace.id, before, after },
  );
  return after;
}

export interface Permissions {
  can_see_lineup: boolean;
  can_see_lineup_amounts: boolean;
  can_edit_lineup: boolean;
  can_record_payouts: boolean;
}

export function permissionsFor(role: string, s: GigsSettings): Permissions {
  if (role === "owner")
    return {
      can_see_lineup: true,
      can_see_lineup_amounts: true,
      can_edit_lineup: true,
      can_record_payouts: true,
    };
  const canEdit = s.lineup_editors === "everyone";
  const canPay = s.payout_recorders === "everyone";
  // Setting shares or paying people needs the amounts, so either permission shows them.
  return {
    can_see_lineup: s.lineup_visible_to_members || canEdit || canPay,
    can_see_lineup_amounts: canEdit || canPay,
    can_edit_lineup: canEdit,
    can_record_payouts: canPay,
  };
}

export async function permissions(ctx: OpCtx): Promise<Permissions> {
  return permissionsFor(ctx.workspace.role, await getSettings(ctx));
}

export async function requirePermission(ctx: OpCtx, what: "can_edit_lineup" | "can_record_payouts") {
  if ((await permissions(ctx))[what]) return;
  throw new AppError(
    "forbidden",
    what === "can_edit_lineup"
      ? "Only owners can set the lineup in this collective (an owner can change this in its settings)"
      : "Only owners can record payouts in this collective (an owner can change this in its settings)",
  );
}
