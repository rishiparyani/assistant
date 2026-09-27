import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  formatDateTimeIST,
  isoDateIST,
  money,
  resolveMoney,
  ulid,
  type CancelGigInput,
  type CreateGigInput,
  type FindGigsInput,
  type GigStatus,
  type GigView,
  type Page,
  type UpdateGigInput,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { clients, gigs, payments, venues } from "../schema.ts";
import { resolveRef } from "./resolve.ts";
import { afterCursor, changedFields, contains, nowIso, toPage, updateStatement } from "./shared.ts";

/** Gig rows joined with their client and venue names. */
export function gigViewQuery(ctx: Pick<OpCtx, "db">) {
  return ctx.db
    .select({
      gig: gigs,
      clientName: clients.name,
      venueName: venues.name,
      venueCity: venues.city,
    })
    .from(gigs)
    .leftJoin(clients, eq(clients.id, gigs.clientId))
    .leftJoin(venues, eq(venues.id, gigs.venueId));
}

type GigViewRow = Awaited<ReturnType<ReturnType<typeof gigViewQuery>["limit"]>>[number];

export function toGigView({ gig: g, clientName, venueName, venueCity }: GigViewRow): GigView {
  return {
    id: g.id,
    title: g.title,
    event_type: g.eventType,
    status: g.status,
    start_at: g.startAt,
    start_display: formatDateTimeIST(g.startAt),
    date: isoDateIST(g.startAt),
    end_at: g.endAt,
    end_display: g.endAt ? formatDateTimeIST(g.endAt) : null,
    client: g.clientId ? { id: g.clientId, name: clientName ?? "(deleted client)" } : null,
    venue: g.venueId
      ? { id: g.venueId, name: venueName ?? "(deleted venue)", city: venueCity ?? null }
      : null,
    fee: money(g.feePaise),
    notes: g.notes,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
  };
}

export async function getGig(ctx: OpCtx, gigId: string): Promise<GigView> {
  const [row] = await gigViewQuery(ctx)
    .where(and(eq(gigs.id, gigId), eq(gigs.workspaceId, ctx.workspace.id), isNull(gigs.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Gig not found");
  return toGigView(row);
}

function feeOf(input: Record<string, unknown>): number | undefined {
  const fee = resolveMoney(input, "fee");
  if (fee !== undefined && fee < 0) throw new AppError("validation_failed", "The fee can't be negative");
  return fee;
}

function checkTimes(startAt: string, endAt: string | null | undefined) {
  if (endAt && endAt < startAt)
    throw new AppError("validation_failed", "The end time is before the start time");
}

export async function createGig(ctx: OpCtx, input: z.output<typeof CreateGigInput>): Promise<GigView> {
  const [clientId, venueId] = await Promise.all([
    resolveRef(ctx, "client", input.client_id, input.client_name),
    resolveRef(ctx, "venue", input.venue_id, input.venue_name),
  ]);
  checkTimes(input.start_at, input.end_at);
  const id = ulid();
  const ts = nowIso();
  const fee = feeOf(input) ?? 0;
  const after = {
    title: input.title,
    event_type: input.event_type ?? null,
    start_at: input.start_at,
    end_at: input.end_at ?? null,
    status: input.status,
    fee_paise: fee,
    client_id: clientId ?? null,
    venue_id: venueId ?? null,
    notes: input.notes ?? null,
  };
  await ctx.commit(
    [
      ctx.d1
        .prepare(
          `insert into gigs (id, workspace_id, client_id, venue_id, title, event_type, start_at, end_at, status, fee_paise, notes, created_by, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          ctx.workspace.id,
          after.client_id,
          after.venue_id,
          after.title,
          after.event_type,
          after.start_at,
          after.end_at,
          after.status,
          fee,
          after.notes,
          ctx.user.id,
          ts,
          ts,
        ),
    ],
    { entityType: "gig", entityId: id, after },
  );
  return getGig(ctx, id);
}

export async function findGigs(ctx: OpCtx, input: z.output<typeof FindGigsInput>): Promise<Page<GigView>> {
  const rows = await gigViewQuery(ctx)
    .where(
      and(
        eq(gigs.workspaceId, ctx.workspace.id),
        isNull(gigs.deletedAt),
        input.from ? gte(gigs.startAt, input.from) : undefined,
        input.to ? lt(gigs.startAt, input.to) : undefined,
        input.status ? eq(gigs.status, input.status) : undefined,
        input.client_id ? eq(gigs.clientId, input.client_id) : undefined,
        input.venue_id ? eq(gigs.venueId, input.venue_id) : undefined,
        input.q ? contains(gigs.title, input.q) : undefined,
        afterCursor(gigs.startAt, gigs.id, input.cursor, input.order),
      ),
    )
    .orderBy(
      ...(input.order === "asc" ? [asc(gigs.startAt), asc(gigs.id)] : [desc(gigs.startAt), desc(gigs.id)]),
    )
    .limit(input.limit + 1);
  return toPage(rows, input.limit, (r) => [r.gig.startAt, r.gig.id], toGigView);
}

async function loadGigRow(ctx: OpCtx, gigId: string) {
  const [row] = await ctx.db
    .select()
    .from(gigs)
    .where(and(eq(gigs.id, gigId), eq(gigs.workspaceId, ctx.workspace.id), isNull(gigs.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Gig not found");
  return row;
}

export async function updateGig(ctx: OpCtx, input: z.output<typeof UpdateGigInput>): Promise<GigView> {
  const before = await loadGigRow(ctx, input.gig_id);
  const [clientId, venueId] = await Promise.all([
    resolveRef(ctx, "client", input.client_id, input.client_name),
    resolveRef(ctx, "venue", input.venue_id, input.venue_name),
  ]);
  const values = { ...input, fee_paise: feeOf(input), client_id: clientId, venue_id: venueId };
  const fields = changedFields(values, {
    title: "title",
    event_type: "event_type",
    start_at: "start_at",
    end_at: "end_at",
    fee_paise: "fee_paise",
    client_id: "client_id",
    venue_id: "venue_id",
    notes: "notes",
  });
  checkTimes(input.start_at ?? before.startAt, input.end_at === undefined ? before.endAt : input.end_at);
  if (!fields.length) return getGig(ctx, before.id);
  await ctx.commit([updateStatement(ctx.d1, "gigs", fields, before.id, ctx.workspace.id)], {
    entityType: "gig",
    entityId: before.id,
    before,
    after: Object.fromEntries(fields),
  });
  return getGig(ctx, before.id);
}

// Allowed status changes. Completing an enquiry is allowed (gigs sometimes happen
// without a formal confirmation); finished or cancelled gigs don't change.
const TRANSITIONS: Record<"confirmed" | "completed" | "cancelled", GigStatus[]> = {
  confirmed: ["enquiry"],
  completed: ["enquiry", "confirmed"],
  cancelled: ["enquiry", "confirmed"],
};

export async function setGigStatus(
  ctx: OpCtx,
  gigId: string,
  to: "confirmed" | "completed" | "cancelled",
  reason?: string | null,
): Promise<GigView> {
  const before = await loadGigRow(ctx, gigId);
  // Asking for the status it already has is a no-op, not an error (safe to retry).
  if (before.status === to) return getGig(ctx, before.id);
  if (!TRANSITIONS[to].includes(before.status)) {
    throw new AppError("conflict", `A ${before.status} gig can't be marked ${to}`, { status: before.status });
  }
  const fields: [string, unknown][] = [["status", to]];
  if (to === "cancelled" && reason) {
    fields.push(["notes", before.notes ? `${before.notes}\n\nCancelled: ${reason}` : `Cancelled: ${reason}`]);
  }
  await ctx.commit([updateStatement(ctx.d1, "gigs", fields, before.id, ctx.workspace.id)], {
    entityType: "gig",
    entityId: before.id,
    before: { status: before.status },
    after: { status: to, ...(reason ? { reason } : {}) },
  });
  return getGig(ctx, before.id);
}

export const cancelGig = (ctx: OpCtx, input: z.output<typeof CancelGigInput>) =>
  setGigStatus(ctx, input.gig_id, "cancelled", input.reason);

/** Soft delete, for gigs entered by mistake. Gigs with payments must be cancelled instead. */
export async function deleteGig(ctx: OpCtx, gigId: string) {
  const before = await loadGigRow(ctx, gigId);
  const [paid] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(payments)
    .where(and(eq(payments.workspaceId, ctx.workspace.id), eq(payments.gigId, before.id)));
  if ((paid?.n ?? 0) > 0) {
    throw new AppError("conflict", "This gig has payments recorded; cancel it instead of deleting it");
  }
  const ts = nowIso();
  await ctx.commit(
    [
      ctx.d1
        .prepare(`update gigs set deleted_at = ?, updated_at = ? where id = ? and workspace_id = ?`)
        .bind(ts, ts, before.id, ctx.workspace.id),
    ],
    { entityType: "gig", entityId: before.id, before },
  );
  return { deleted: true, gig: { id: before.id, title: before.title } };
}
