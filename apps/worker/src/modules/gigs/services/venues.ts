import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { ulid, type Page, type VenueView } from "@assistant/shared";
import type { z } from "zod";
import type { CreateVenueInput, FindVenuesInput, UpdateVenueInput } from "@assistant/shared";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { venues } from "../schema.ts";
import { afterCursor, changedFields, contains, nowIso, toPage, updateStatement } from "./shared.ts";

type VenueRow = typeof venues.$inferSelect;

export function toVenueView(r: VenueRow): VenueView {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    address: r.address,
    notes: r.notes,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export async function loadVenue(ctx: OpCtx, id: string): Promise<VenueRow> {
  const [row] = await ctx.db
    .select()
    .from(venues)
    .where(and(eq(venues.id, id), eq(venues.workspaceId, ctx.workspace.id), isNull(venues.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Venue not found");
  return row;
}

export async function createVenue(ctx: OpCtx, input: z.output<typeof CreateVenueInput>): Promise<VenueView> {
  const id = ulid();
  const ts = nowIso();
  const row: VenueRow = {
    id,
    workspaceId: ctx.workspace.id,
    name: input.name,
    city: input.city ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await ctx.commit(
    [
      ctx.d1
        .prepare(
          `insert into venues (id, workspace_id, name, city, address, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, row.workspaceId, row.name, row.city, row.address, row.notes, ts, ts),
    ],
    { entityType: "venue", entityId: id, after: toVenueView(row) },
  );
  return toVenueView(row);
}

export async function findVenues(
  ctx: OpCtx,
  input: z.output<typeof FindVenuesInput>,
): Promise<Page<VenueView>> {
  const nameKey = sql`lower(${venues.name})`;
  const rows = await ctx.db
    .select()
    .from(venues)
    .where(
      and(
        eq(venues.workspaceId, ctx.workspace.id),
        isNull(venues.deletedAt),
        input.q ? or(contains(venues.name, input.q), contains(venues.city, input.q)) : undefined,
        afterCursor(nameKey, venues.id, input.cursor),
      ),
    )
    .orderBy(asc(nameKey), asc(venues.id))
    .limit(input.limit + 1);
  return toPage(rows, input.limit, (r) => [r.name.toLowerCase(), r.id], toVenueView);
}

export async function updateVenue(ctx: OpCtx, input: z.output<typeof UpdateVenueInput>): Promise<VenueView> {
  const before = await loadVenue(ctx, input.venue_id);
  const fields = changedFields(input, { name: "name", city: "city", address: "address", notes: "notes" });
  if (!fields.length) return toVenueView(before);
  await ctx.commit([updateStatement(ctx.d1, "venues", fields, before.id, ctx.workspace.id)], {
    entityType: "venue",
    entityId: before.id,
    before: toVenueView(before),
    after: Object.fromEntries(fields),
  });
  return toVenueView(await loadVenue(ctx, before.id));
}

export async function deleteVenue(ctx: OpCtx, venueId: string) {
  const before = await loadVenue(ctx, venueId);
  const ts = nowIso();
  await ctx.commit(
    [
      ctx.d1
        .prepare(`update venues set deleted_at = ?, updated_at = ? where id = ? and workspace_id = ?`)
        .bind(ts, ts, before.id, ctx.workspace.id),
    ],
    { entityType: "venue", entityId: before.id, before: toVenueView(before) },
  );
  return { deleted: true, venue: { id: before.id, name: before.name } };
}
