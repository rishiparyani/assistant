// Puts people on a collective's roster when they join it (decision 2026-09-27), so their
// shares reach their Me Home without the owner linking them by hand.
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { ulid } from "@assistant/shared";
import type { UserCtx } from "../../../core/context.ts";
import type { HookResult } from "../../../core/module.ts";
import { musicians } from "../schema.ts";
import { toMusicianView } from "./band.ts";
import { nowIso } from "./shared.ts";

export async function memberJoined(
  ctx: UserCtx,
  { workspaceId }: { workspaceId: string },
): Promise<HookResult> {
  const candidates = await ctx.db
    .select()
    .from(musicians)
    .where(
      and(
        eq(musicians.workspaceId, workspaceId),
        isNull(musicians.deletedAt),
        or(
          eq(musicians.userId, ctx.user.id),
          and(isNull(musicians.userId), sql`lower(${musicians.email}) = ${ctx.user.email.toLowerCase()}`),
        ),
      ),
    )
    .limit(5);
  if (candidates.some((m) => m.userId === ctx.user.id)) return { statements: [], changes: [] };

  const ts = nowIso();
  const byEmail = candidates[0];
  if (byEmail) {
    // The owner already added this person (same email): link that entry.
    const after = { ...byEmail, userId: ctx.user.id, updatedAt: ts };
    return {
      statements: [
        ctx.d1
          .prepare(`update musicians set user_id = ?, updated_at = ? where id = ? and user_id is null`)
          .bind(ctx.user.id, ts, byEmail.id),
      ],
      changes: [
        {
          entityType: "musician",
          entityId: byEmail.id,
          module: "gigs",
          action: "link_musician",
          workspaceId,
          before: toMusicianView(byEmail),
          after: toMusicianView(after),
        },
      ],
    };
  }

  const row: typeof musicians.$inferSelect = {
    id: ulid(),
    workspaceId,
    name: ctx.user.name || ctx.user.email.split("@")[0]!,
    phone: null,
    email: ctx.user.email,
    instrument: null,
    userId: ctx.user.id,
    notes: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  return {
    statements: [
      ctx.d1
        .prepare(
          `insert into musicians (id, workspace_id, name, email, user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(row.id, workspaceId, row.name, row.email, row.userId, ts, ts),
    ],
    changes: [
      {
        entityType: "musician",
        entityId: row.id,
        module: "gigs",
        action: "create_musician",
        workspaceId,
        after: toMusicianView(row),
      },
    ],
  };
}
