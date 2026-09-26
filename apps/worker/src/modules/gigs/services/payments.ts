// Client payments and expenses. Payments are append-only: a correction is a negative
// entry that points at the payment it cancels (architecture rule 6).
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  formatDateIST,
  isoDateIST,
  money,
  resolveMoney,
  ulid,
  type ExpenseView,
  type FindExpensesInput,
  type Page,
  type PaymentView,
  type RecordExpenseInput,
  type RecordPaymentInput,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { expenses, gigs, payments } from "../schema.ts";
import { afterCursor, nowIso, toPage } from "./shared.ts";

type PaymentRow = typeof payments.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;

export function toPaymentView(p: PaymentRow, reversedBy: string | null): PaymentView {
  return {
    id: p.id,
    gig_id: p.gigId,
    amount: money(p.amountPaise),
    paid_on: p.paidOn,
    paid_on_display: formatDateIST(p.paidOn),
    method: p.method,
    note: p.note,
    reverses_payment_id: p.reversesPaymentId,
    reversed_by_payment_id: reversedBy,
    created_at: p.createdAt,
  };
}

export function toExpenseView(e: ExpenseRow): ExpenseView {
  return {
    id: e.id,
    gig_id: e.gigId,
    category: e.category,
    amount: money(e.amountPaise),
    spent_on: e.spentOn,
    spent_on_display: formatDateIST(e.spentOn),
    note: e.note,
    created_at: e.createdAt,
  };
}

/** A positive amount in paise from `<name>_paise` or `<name>`, required. */
export function positiveAmount(input: Record<string, unknown>, name = "amount"): number {
  const paise = resolveMoney(input, name);
  if (paise === undefined)
    throw new AppError("validation_failed", `Give ${name} (e.g. "5000") or ${name}_paise`);
  if (paise <= 0) throw new AppError("validation_failed", `The ${name} must be more than zero`);
  return paise;
}

export async function loadGigForMoney(ctx: OpCtx, gigId: string) {
  const [gig] = await ctx.db
    .select()
    .from(gigs)
    .where(and(eq(gigs.id, gigId), eq(gigs.workspaceId, ctx.workspace.id), isNull(gigs.deletedAt)))
    .limit(1);
  if (!gig) throw new AppError("not_found", "Gig not found");
  return gig;
}

export async function gigPayments(ctx: OpCtx, gigId: string): Promise<PaymentView[]> {
  const rows = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.workspaceId, ctx.workspace.id), eq(payments.gigId, gigId)))
    .orderBy(asc(payments.paidOn), asc(payments.id));
  const reversedBy = new Map(
    rows.filter((r) => r.reversesPaymentId).map((r) => [r.reversesPaymentId!, r.id]),
  );
  return rows.map((r) => toPaymentView(r, reversedBy.get(r.id) ?? null));
}

/** Only owners, or whoever recorded an entry, may correct it. */
function assertCanCorrect(ctx: OpCtx, createdBy: string) {
  if (ctx.workspace.role !== "owner" && createdBy !== ctx.user.id) {
    throw new AppError("forbidden", "Only workspace owners or the person who recorded it can correct this");
  }
}

export async function recordPayment(ctx: OpCtx, input: z.output<typeof RecordPaymentInput>) {
  const gig = await loadGigForMoney(ctx, input.gig_id);
  const amount = positiveAmount(input);
  const id = ulid();
  const row: PaymentRow = {
    id,
    workspaceId: ctx.workspace.id,
    gigId: gig.id,
    amountPaise: amount,
    paidOn: input.paid_on,
    method: input.method,
    reversesPaymentId: null,
    note: input.note ?? null,
    createdBy: ctx.user.id,
    createdAt: nowIso(),
  };
  await ctx.commit([insertPayment(ctx, row)], {
    entityType: "payment",
    entityId: id,
    after: { gig_id: gig.id, amount_paise: amount, paid_on: row.paidOn, method: row.method },
  });
  return toPaymentView(row, null);
}

function insertPayment(ctx: OpCtx, r: PaymentRow) {
  return ctx.d1
    .prepare(
      `insert into payments (id, workspace_id, gig_id, amount_paise, paid_on, method, reverses_payment_id, note, created_by, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      r.id,
      r.workspaceId,
      r.gigId,
      r.amountPaise,
      r.paidOn,
      r.method,
      r.reversesPaymentId,
      r.note,
      r.createdBy,
      r.createdAt,
    );
}

export async function reversePayment(ctx: OpCtx, paymentId: string, note: string | null | undefined) {
  const [original] = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.workspaceId, ctx.workspace.id)))
    .limit(1);
  if (!original) throw new AppError("not_found", "Payment not found");
  assertCanCorrect(ctx, original.createdBy);
  if (original.reversesPaymentId)
    throw new AppError("conflict", "This entry is itself a correction; it can't be reversed");
  const [existing] = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.workspaceId, ctx.workspace.id), eq(payments.reversesPaymentId, original.id)))
    .limit(1);
  if (existing)
    throw new AppError("conflict", "This payment has already been reversed", { reversed_by: existing.id });

  const row: PaymentRow = {
    ...original,
    id: ulid(),
    amountPaise: -original.amountPaise,
    paidOn: isoDateIST(nowIso()),
    reversesPaymentId: original.id,
    note: note ?? `Reverses the ${formatDateIST(original.paidOn)} payment`,
    createdBy: ctx.user.id,
    createdAt: nowIso(),
  };
  await ctx.commit([insertPayment(ctx, row)], {
    entityType: "payment",
    entityId: row.id,
    before: toPaymentView(original, null),
    after: { reverses_payment_id: original.id, amount_paise: row.amountPaise },
  });
  return toPaymentView(row, null);
}

// --- Expenses -------------------------------------------------------------------------

export async function recordExpense(
  ctx: OpCtx,
  input: z.output<typeof RecordExpenseInput>,
): Promise<ExpenseView> {
  if (input.gig_id) await loadGigForMoney(ctx, input.gig_id);
  const amount = positiveAmount(input);
  const row: ExpenseRow = {
    id: ulid(),
    workspaceId: ctx.workspace.id,
    gigId: input.gig_id ?? null,
    category: input.category,
    amountPaise: amount,
    spentOn: input.spent_on,
    note: input.note ?? null,
    createdBy: ctx.user.id,
    createdAt: nowIso(),
  };
  await ctx.commit(
    [
      ctx.d1
        .prepare(
          `insert into expenses (id, workspace_id, gig_id, category, amount_paise, spent_on, note, created_by, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.workspaceId,
          row.gigId,
          row.category,
          amount,
          row.spentOn,
          row.note,
          row.createdBy,
          row.createdAt,
        ),
    ],
    { entityType: "expense", entityId: row.id, after: toExpenseView(row) },
  );
  return toExpenseView(row);
}

export async function gigExpenses(ctx: OpCtx, gigId: string): Promise<ExpenseView[]> {
  const rows = await ctx.db
    .select()
    .from(expenses)
    .where(and(eq(expenses.workspaceId, ctx.workspace.id), eq(expenses.gigId, gigId)))
    .orderBy(asc(expenses.spentOn), asc(expenses.id));
  return rows.map(toExpenseView);
}

export async function findExpenses(
  ctx: OpCtx,
  input: z.output<typeof FindExpensesInput>,
): Promise<Page<ExpenseView>> {
  const rows = await ctx.db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.workspaceId, ctx.workspace.id),
        input.from ? gte(expenses.spentOn, input.from) : undefined,
        input.to ? lte(expenses.spentOn, input.to) : undefined,
        input.gig_id ? eq(expenses.gigId, input.gig_id) : undefined,
        afterCursor(expenses.spentOn, expenses.id, input.cursor, "desc"),
      ),
    )
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
    .limit(input.limit + 1);
  return toPage(rows, input.limit, (r) => [r.spentOn, r.id], toExpenseView);
}

/** Expenses aren't money owed to anyone, so a mistaken one is removed (and audited). */
export async function deleteExpense(ctx: OpCtx, expenseId: string) {
  const [row] = await ctx.db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.workspaceId, ctx.workspace.id)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Expense not found");
  assertCanCorrect(ctx, row.createdBy);
  await ctx.commit(
    [ctx.d1.prepare(`delete from expenses where id = ? and workspace_id = ?`).bind(row.id, ctx.workspace.id)],
    { entityType: "expense", entityId: row.id, before: toExpenseView(row) },
  );
  return { deleted: true, expense: toExpenseView(row) };
}
