// The roster, gig lineups with shares, payouts to musicians, and the combined money
// picture for a gig. Members see the fee side, who plays, and their own share only.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  formatDateIST,
  formatDateTimeIST,
  isoDateIST,
  money,
  paymentStatus,
  resolveMoney,
  splitEqual,
  splitPercent,
  ulid,
  type CreateMusicianInput,
  type FindMusiciansInput,
  type GigMoneyView,
  type LineupEntryView,
  type MusicianView,
  type Page,
  type PayoutView,
  type RecordPayoutInput,
  type SetLineupInput,
  type UpdateMusicianInput,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { member } from "../../../core/db/schema.ts";
import { gigLineup, musicians, payouts } from "../schema.ts";
import { resolveRef } from "./resolve.ts";
import { afterCursor, changedFields, contains, nowIso, toPage, updateStatement } from "./shared.ts";
import { gigExpenses, gigPayments, loadGigForMoney, positiveAmount } from "./payments.ts";
import { permissions, requirePermission } from "./settings.ts";

type MusicianRow = typeof musicians.$inferSelect;
type PayoutRow = typeof payouts.$inferSelect;

// --- Roster ---------------------------------------------------------------------------

export function toMusicianView(m: MusicianRow): MusicianView {
  return {
    id: m.id,
    name: m.name,
    instrument: m.instrument,
    phone: m.phone,
    email: m.email,
    notes: m.notes,
    user_id: m.userId,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

async function loadMusician(ctx: OpCtx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(musicians)
    .where(
      and(eq(musicians.id, id), eq(musicians.workspaceId, ctx.workspace.id), isNull(musicians.deletedAt)),
    )
    .limit(1);
  if (!row) throw new AppError("not_found", "Musician not found");
  return row;
}

/** A linked account must be a member of this workspace and not already on its roster. */
async function assertMember(ctx: OpCtx, userId: string | null | undefined, musicianId?: string) {
  if (!userId) return;
  const [m] = await ctx.db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.workspace.id), eq(member.userId, userId)))
    .limit(1);
  if (!m) throw new AppError("validation_failed", "user_id must be a member of this workspace");
  const [linked] = await ctx.db
    .select({ id: musicians.id, name: musicians.name })
    .from(musicians)
    .where(
      and(
        eq(musicians.workspaceId, ctx.workspace.id),
        eq(musicians.userId, userId),
        isNull(musicians.deletedAt),
      ),
    )
    .limit(1);
  if (linked && linked.id !== musicianId) {
    throw new AppError("conflict", `That member is already on the roster as ${linked.name}`, {
      musician_id: linked.id,
    });
  }
}

export async function createMusician(
  ctx: OpCtx,
  input: z.output<typeof CreateMusicianInput>,
): Promise<MusicianView> {
  // Members who may set lineups can add people while doing it; linking accounts stays with owners.
  if (ctx.workspace.role !== "owner") {
    await requirePermission(ctx, "can_edit_lineup");
    if (input.user_id) throw new AppError("forbidden", "Only owners can link roster entries to accounts");
  }
  await assertMember(ctx, input.user_id);
  const ts = nowIso();
  const row: MusicianRow = {
    id: ulid(),
    workspaceId: ctx.workspace.id,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    instrument: input.instrument ?? null,
    userId: input.user_id ?? null,
    notes: input.notes ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await ctx.commit(
    [
      ctx.d1
        .prepare(
          `insert into musicians (id, workspace_id, name, phone, email, instrument, user_id, notes, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.workspaceId,
          row.name,
          row.phone,
          row.email,
          row.instrument,
          row.userId,
          row.notes,
          ts,
          ts,
        ),
    ],
    { entityType: "musician", entityId: row.id, after: toMusicianView(row) },
  );
  return toMusicianView(row);
}

export async function findMusicians(
  ctx: OpCtx,
  input: z.output<typeof FindMusiciansInput>,
): Promise<Page<MusicianView>> {
  const nameKey = sql`lower(${musicians.name})`;
  const rows = await ctx.db
    .select()
    .from(musicians)
    .where(
      and(
        eq(musicians.workspaceId, ctx.workspace.id),
        isNull(musicians.deletedAt),
        input.q ? contains(musicians.name, input.q) : undefined,
        afterCursor(nameKey, musicians.id, input.cursor),
      ),
    )
    .orderBy(asc(nameKey), asc(musicians.id))
    .limit(input.limit + 1);
  return toPage(rows, input.limit, (r) => [r.name.toLowerCase(), r.id], toMusicianView);
}

export async function updateMusician(
  ctx: OpCtx,
  input: z.output<typeof UpdateMusicianInput>,
): Promise<MusicianView> {
  const before = await loadMusician(ctx, input.musician_id);
  await assertMember(ctx, input.user_id, before.id);
  const fields = changedFields(input, {
    name: "name",
    phone: "phone",
    email: "email",
    instrument: "instrument",
    notes: "notes",
    user_id: "user_id",
  });
  if (!fields.length) return toMusicianView(before);
  await ctx.commit([updateStatement(ctx.d1, "musicians", fields, before.id, ctx.workspace.id)], {
    entityType: "musician",
    entityId: before.id,
    before: toMusicianView(before),
    after: Object.fromEntries(fields),
  });
  return toMusicianView(await loadMusician(ctx, before.id));
}

/** Soft delete: past lineups and payouts keep their history. */
export async function deleteMusician(ctx: OpCtx, musicianId: string) {
  const before = await loadMusician(ctx, musicianId);
  const ts = nowIso();
  await ctx.commit(
    [
      ctx.d1
        .prepare(`update musicians set deleted_at = ?, updated_at = ? where id = ? and workspace_id = ?`)
        .bind(ts, ts, before.id, ctx.workspace.id),
    ],
    { entityType: "musician", entityId: before.id, before: toMusicianView(before) },
  );
  return { deleted: true, musician: { id: before.id, name: before.name } };
}

// --- Lineup ---------------------------------------------------------------------------

async function lineupRows(ctx: OpCtx, gigId: string) {
  return ctx.db
    .select({ entry: gigLineup, musician: musicians })
    .from(gigLineup)
    .innerJoin(musicians, eq(musicians.id, gigLineup.musicianId))
    .where(and(eq(gigLineup.workspaceId, ctx.workspace.id), eq(gigLineup.gigId, gigId)))
    .orderBy(asc(gigLineup.createdAt), asc(gigLineup.id));
}

async function payoutRows(ctx: OpCtx, gigId: string) {
  return ctx.db
    .select({ payout: payouts, musicianName: musicians.name })
    .from(payouts)
    .innerJoin(musicians, eq(musicians.id, payouts.musicianId))
    .where(and(eq(payouts.workspaceId, ctx.workspace.id), eq(payouts.gigId, gigId)))
    .orderBy(asc(payouts.paidOn), asc(payouts.id));
}

function toPayoutView(p: PayoutRow, musicianName: string, reversedBy: string | null): PayoutView {
  return {
    id: p.id,
    gig_id: p.gigId,
    musician: { id: p.musicianId, name: musicianName },
    amount: money(p.amountPaise),
    paid_on: p.paidOn,
    paid_on_display: formatDateIST(p.paidOn),
    method: p.method,
    note: p.note,
    reverses_payout_id: p.reversesPayoutId,
    reversed_by_payout_id: reversedBy,
    created_at: p.createdAt,
  };
}

export async function setLineup(ctx: OpCtx, input: z.output<typeof SetLineupInput>): Promise<GigMoneyView> {
  await requirePermission(ctx, "can_edit_lineup");
  const gig = await loadGigForMoney(ctx, input.gig_id);
  const musicianIds: string[] = [];
  for (const entry of input.lineup) {
    const id = await resolveRef(ctx, "musician", entry.musician_id, entry.musician_name);
    if (!id) throw new AppError("validation_failed", "Each lineup entry needs musician_id or musician_name");
    if (musicianIds.includes(id))
      throw new AppError("validation_failed", "A musician appears twice in the lineup");
    musicianIds.push(id);
  }

  // Work out each share in paise.
  const splitTotal = resolveMoney(input, "split_total") ?? gig.feePaise;
  let shares: number[];
  if (input.split === "equal") {
    shares = input.lineup.length ? splitEqual(splitTotal, input.lineup.length) : [];
  } else {
    const percentIdx = input.lineup.flatMap((e, i) => (e.percent !== undefined ? [i] : []));
    const percentShares = splitPercent(
      splitTotal,
      percentIdx.map((i) => input.lineup[i]!.percent!),
    );
    shares = input.lineup.map((e, i) => {
      const p = percentIdx.indexOf(i);
      const explicit = resolveMoney(e, "share");
      if (p >= 0 && explicit !== undefined)
        throw new AppError("validation_failed", "Give a share or a percent, not both");
      if (p >= 0) return percentShares[p]!;
      if (explicit === undefined) {
        throw new AppError("validation_failed", 'Give each person a share or percent, or use split: "equal"');
      }
      if (explicit < 0) throw new AppError("validation_failed", "Shares can't be negative");
      return explicit;
    });
  }

  const current = await lineupRows(ctx, gig.id);
  const paidByMusician = new Map<string, number>();
  for (const { payout } of await payoutRows(ctx, gig.id)) {
    paidByMusician.set(payout.musicianId, (paidByMusician.get(payout.musicianId) ?? 0) + payout.amountPaise);
  }
  const removed = current.filter((c) => !musicianIds.includes(c.entry.musicianId));
  const blocked = removed.filter((r) => paidByMusician.has(r.entry.musicianId));
  if (blocked.length) {
    throw new AppError(
      "conflict",
      `${blocked.map((b) => b.musician.name).join(", ")} already got payouts for this gig and can't be removed from the lineup`,
    );
  }

  const ts = nowIso();
  const statements: D1PreparedStatement[] = removed.map((r) =>
    ctx.d1
      .prepare(`delete from gig_lineup where id = ? and workspace_id = ?`)
      .bind(r.entry.id, ctx.workspace.id),
  );
  input.lineup.forEach((entry, i) => {
    const musicianId = musicianIds[i]!;
    const existing = current.find((c) => c.entry.musicianId === musicianId);
    const role = entry.role === undefined ? (existing?.entry.role ?? null) : entry.role;
    if (existing) {
      statements.push(
        ctx.d1
          .prepare(
            `update gig_lineup set role = ?, share_paise = ?, updated_at = ? where id = ? and workspace_id = ?`,
          )
          .bind(role, shares[i]!, ts, existing.entry.id, ctx.workspace.id),
      );
    } else {
      statements.push(
        ctx.d1
          .prepare(
            `insert into gig_lineup (id, workspace_id, gig_id, musician_id, role, share_paise, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          // +i ms keeps the lineup in the order it was given (rows are listed by created_at).
          .bind(
            ulid(),
            ctx.workspace.id,
            gig.id,
            musicianId,
            role,
            shares[i]!,
            new Date(Date.parse(ts) + i).toISOString(),
            ts,
          ),
      );
    }
  });
  await ctx.commit(statements, {
    entityType: "gig_lineup",
    entityId: gig.id,
    before: current.map((c) => ({
      musician_id: c.entry.musicianId,
      role: c.entry.role,
      share_paise: c.entry.sharePaise,
    })),
    after: musicianIds.map((m, i) => ({ musician_id: m, share_paise: shares[i] })),
  });
  return getGigMoney(ctx, gig.id);
}

// --- Payouts --------------------------------------------------------------------------

function insertPayout(ctx: OpCtx, r: PayoutRow) {
  return ctx.d1
    .prepare(
      `insert into payouts (id, workspace_id, gig_id, musician_id, amount_paise, paid_on, method, reverses_payout_id, note, created_by, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      r.id,
      r.workspaceId,
      r.gigId,
      r.musicianId,
      r.amountPaise,
      r.paidOn,
      r.method,
      r.reversesPayoutId,
      r.note,
      r.createdBy,
      r.createdAt,
    );
}

export async function recordPayout(
  ctx: OpCtx,
  input: z.output<typeof RecordPayoutInput>,
): Promise<PayoutView> {
  await requirePermission(ctx, "can_record_payouts");
  const gig = await loadGigForMoney(ctx, input.gig_id);
  const musicianId = await resolveRef(ctx, "musician", input.musician_id, input.musician_name);
  if (!musicianId) throw new AppError("validation_failed", "Give musician_id or musician_name");
  const lineup = await lineupRows(ctx, gig.id);
  const entry = lineup.find((l) => l.entry.musicianId === musicianId);
  if (!entry) throw new AppError("conflict", "Add this musician to the gig's lineup before paying them");
  const amount = positiveAmount(input);
  const row: PayoutRow = {
    id: ulid(),
    workspaceId: ctx.workspace.id,
    gigId: gig.id,
    musicianId,
    amountPaise: amount,
    paidOn: input.paid_on,
    method: input.method,
    reversesPayoutId: null,
    note: input.note ?? null,
    createdBy: ctx.user.id,
    createdAt: nowIso(),
  };
  await ctx.commit([insertPayout(ctx, row)], {
    entityType: "payout",
    entityId: row.id,
    after: {
      gig_id: gig.id,
      musician_id: musicianId,
      amount_paise: amount,
      paid_on: row.paidOn,
      method: row.method,
    },
  });
  return toPayoutView(row, entry.musician.name, null);
}

export async function reversePayout(
  ctx: OpCtx,
  payoutId: string,
  note: string | null | undefined,
): Promise<PayoutView> {
  await requirePermission(ctx, "can_record_payouts");
  const [found] = await ctx.db
    .select({ payout: payouts, musicianName: musicians.name })
    .from(payouts)
    .innerJoin(musicians, eq(musicians.id, payouts.musicianId))
    .where(and(eq(payouts.id, payoutId), eq(payouts.workspaceId, ctx.workspace.id)))
    .limit(1);
  if (!found) throw new AppError("not_found", "Payout not found");
  const original = found.payout;
  if (original.reversesPayoutId)
    throw new AppError("conflict", "This entry is itself a correction; it can't be reversed");
  const [existing] = await ctx.db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.workspaceId, ctx.workspace.id), eq(payouts.reversesPayoutId, original.id)))
    .limit(1);
  if (existing)
    throw new AppError("conflict", "This payout has already been reversed", { reversed_by: existing.id });
  const row: PayoutRow = {
    ...original,
    id: ulid(),
    amountPaise: -original.amountPaise,
    paidOn: isoDateIST(nowIso()),
    reversesPayoutId: original.id,
    note: note ?? `Reverses the ${formatDateIST(original.paidOn)} payout`,
    createdBy: ctx.user.id,
    createdAt: nowIso(),
  };
  await ctx.commit([insertPayout(ctx, row)], {
    entityType: "payout",
    entityId: row.id,
    before: toPayoutView(original, found.musicianName, null),
    after: { reverses_payout_id: original.id, amount_paise: row.amountPaise },
  });
  return toPayoutView(row, found.musicianName, null);
}

// --- The whole picture ------------------------------------------------------------------

export async function getGigMoney(ctx: OpCtx, gigId: string): Promise<GigMoneyView> {
  const gig = await loadGigForMoney(ctx, gigId);
  const full = ctx.workspace.role === "owner";
  const perms = await permissions(ctx);
  const [paymentList, lineup, payoutList] = await Promise.all([
    gigPayments(ctx, gig.id),
    lineupRows(ctx, gig.id),
    payoutRows(ctx, gig.id),
  ]);
  const received = paymentList.reduce((sum, p) => sum + p.amount.amount_paise, 0);

  const reversedBy = new Map(
    payoutList.filter((p) => p.payout.reversesPayoutId).map((p) => [p.payout.reversesPayoutId!, p.payout.id]),
  );
  const visible = perms.can_see_lineup ? lineup : lineup.filter((l) => l.musician.userId === ctx.user.id);
  const entries: LineupEntryView[] = visible.map((l) => {
    const isMe = l.musician.userId === ctx.user.id;
    if (!perms.can_see_lineup_amounts && !isMe) {
      // Members see who plays, not what others earn.
      return {
        id: l.entry.id,
        musician: {
          id: l.musician.id,
          name: l.musician.name,
          instrument: l.musician.instrument,
          is_me: false,
        },
        role: l.entry.role,
        share: null,
        paid: null,
        owed: null,
        payout_status: null,
        payouts: [],
      };
    }
    const mine = payoutList
      .filter((p) => p.payout.musicianId === l.entry.musicianId)
      .map((p) => toPayoutView(p.payout, p.musicianName, reversedBy.get(p.payout.id) ?? null));
    const paid = mine.reduce((sum, p) => sum + p.amount.amount_paise, 0);
    return {
      id: l.entry.id,
      musician: {
        id: l.musician.id,
        name: l.musician.name,
        instrument: l.musician.instrument,
        is_me: l.musician.userId === ctx.user.id,
      },
      role: l.entry.role,
      share: money(l.entry.sharePaise),
      paid: money(paid),
      owed: money(l.entry.sharePaise - paid),
      payout_status: paymentStatus(l.entry.sharePaise, paid),
      payouts: mine,
    };
  });

  let ownerOnly: Pick<GigMoneyView, "expenses" | "expenses_total" | "shares_total" | "unallocated" | "net"> =
    {
      expenses: null,
      expenses_total: null,
      shares_total: null,
      unallocated: null,
      net: null,
    };
  if (full) {
    const expenseList = await gigExpenses(ctx, gig.id);
    const expensesTotal = expenseList.reduce((sum, e) => sum + e.amount.amount_paise, 0);
    const sharesTotal = lineup.reduce((sum, l) => sum + l.entry.sharePaise, 0);
    ownerOnly = {
      expenses: expenseList,
      expenses_total: money(expensesTotal),
      shares_total: money(sharesTotal),
      unallocated: money(gig.feePaise - sharesTotal),
      net: money(gig.feePaise - sharesTotal - expensesTotal),
    };
  }

  return {
    gig: { id: gig.id, title: gig.title, status: gig.status, start_display: formatDateTimeIST(gig.startAt) },
    visibility: full ? "full" : "own_share",
    permissions: perms,
    fee: money(gig.feePaise),
    received: money(received),
    balance: money(gig.feePaise - received),
    payment_status: paymentStatus(gig.feePaise, received),
    payments: paymentList,
    lineup: entries,
    ...ownerOnly,
  };
}
