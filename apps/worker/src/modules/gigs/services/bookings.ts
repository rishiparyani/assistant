// Gig-centric gigs (docs/design/gig-centric.md): thin services in front of each gig's own
// Durable Object. The Worker validates input, matches people to accounts and picks the
// gig's id; the object checks roles, stores idempotency and audit, and announces changes.
import {
  decodeCursor,
  encodeCursor,
  formatDateTimeIST,
  money,
  resolveMoney,
  splitEqual,
  splitPercent,
  ulid,
  type GigPayoutRef,
  type GigPaymentRef,
  type RecordGigExpenseInput,
  type RecordGigPaymentInput,
  type RecordGigPayoutInput,
  type SetEventLineupInput,
  type AddPersonInput,
  type BookingView,
  type CreateBookingInput,
  type FindMyGigsInput,
  type MyEventView,
  type Page,
  type UpdateBookingInput,
  type UpdateEventInput,
  type UpdatePersonInput,
  type AddEventInput,
  type BookingStatusInput,
  type SetAttendanceInput,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpUserCtx } from "../../../core/operations.ts";
import type { Actor } from "../../../core/objects/storage.ts";
import { AppError } from "../../../core/errors.ts";
import type { PersonInput } from "../objects/booking.ts";
import { bookingName, personName } from "../objects/names.ts";
import { gigTagRefs, recordAwaiting } from "./tags.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const bookingStub = (ctx: OpUserCtx, gigId: string) => ctx.objects.BOOKINGS.getByName(bookingName(gigId));
const personStub = (ctx: OpUserCtx) => ctx.objects.PEOPLE.getByName(personName(ctx.user.id));

/** An amount from `<name>_paise` or `<name>` (rupees), as paise. */
function paiseOf(input: Record<string, unknown>, name: string, required: true): number;
function paiseOf(input: Record<string, unknown>, name: string, required?: false): number | undefined;
function paiseOf(input: Record<string, unknown>, name: string, required = false): number | undefined {
  let value: number | undefined;
  try {
    value = resolveMoney(input, name);
  } catch (e) {
    throw new AppError("validation_failed", (e as Error).message, { field: name });
  }
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw new AppError("validation_failed", `${name} must be a positive amount`, { field: name });
  if (required && !value)
    throw new AppError("validation_failed", `Give the ${name} (more than ₹0)`, { field: name });
  return value;
}

type RawPerson = {
  user_id?: string;
  email?: string;
  name?: string;
  phone?: string | null;
  role: "manager" | "player";
};

/**
 * Turns people as typed into people the gig stores: an account id (matched by id or
 * email) or just a name. Unknown ids are refused; unknown emails stay name-only (they
 * attach to the account on sign-up, in step 5).
 */
async function resolvePeople(ctx: OpUserCtx, people: RawPerson[]): Promise<PersonInput[]> {
  const out: PersonInput[] = [];
  for (const p of people) {
    let account: { id: string; name: string; email: string } | null = null;
    if (p.user_id) {
      account = await ctx.d1
        .prepare(`select id, name, email from "user" where id = ?`)
        .bind(p.user_id)
        .first<{ id: string; name: string; email: string }>();
      if (!account) throw new AppError("validation_failed", "No account with that user_id");
    } else if (p.email) {
      account = await ctx.d1
        .prepare(`select id, name, email from "user" where lower(email) = ?`)
        .bind(p.email.toLowerCase())
        .first<{ id: string; name: string; email: string }>();
    }
    const name = p.name ?? account?.name ?? p.email?.split("@")[0];
    if (!name) throw new AppError("validation_failed", "Give a name for people without an account");
    out.push({
      user_id: account?.id ?? null,
      name,
      email: account ? null : (p.email ?? null),
      phone: p.phone ?? null,
      role: p.role,
    });
  }
  return out;
}

export async function createBooking(
  ctx: OpUserCtx,
  input: z.output<typeof CreateBookingInput>,
): Promise<BookingView> {
  const people = await resolvePeople(ctx, input.people);
  // The creator is always on the gig as a manager.
  const me = people.find((p) => p.user_id === ctx.user.id);
  if (me) me.role = "manager";
  else
    people.unshift({ user_id: ctx.user.id, name: ctx.user.name, email: null, phone: null, role: "manager" });

  // Retries of the same request must reach the same gig, so the id comes from the key.
  const gigId = ctx.idempotencyKey ? await personStub(ctx).gigIdForKey(ctx.idempotencyKey) : ulid();
  const tags = await gigTagRefs(ctx, input);
  const view = await bookingStub(ctx, gigId).create(
    {
      ...tags,
      gig_id: gigId,
      kind: input.kind,
      title: input.title,
      event_type: input.event_type ?? null,
      status: input.status,
      client: input.client ?? null,
      notes: input.notes ?? null,
      fee_paise: paiseOf(input, "fee") ?? 0,
      settings: input.settings,
      events: input.events,
      people,
    },
    actorOf(ctx),
    ctx.idempotencyKey,
  );
  if (people.some((p) => p.email && !p.user_id)) await recordAwaiting(ctx.d1, ctx.objects, gigId);
  return view;
}

export const getBooking = (ctx: OpUserCtx, gigId: string) => bookingStub(ctx, gigId).view(actorOf(ctx));

export const bookingHistory = (ctx: OpUserCtx, gigId: string) =>
  bookingStub(ctx, gigId).history(actorOf(ctx));

/**
 * Tag refs for an edit. New tag names are added to the shared registry, so only after the
 * gig confirms the caller manages it (others get the gig's own 404/403, and nothing is written).
 */
async function managerTagRefs(
  ctx: OpUserCtx,
  gigId: string,
  input: { collective?: string | null; tags?: string[] },
) {
  if (input.collective === undefined && input.tags === undefined) return {};
  const view = await bookingStub(ctx, gigId).view(actorOf(ctx));
  if (view.my_role !== "manager") throw new AppError("forbidden", "Only the gig's managers can do this");
  return gigTagRefs(ctx, input);
}

export async function updateBooking(ctx: OpUserCtx, input: z.output<typeof UpdateBookingInput>) {
  const {
    gig_id,
    fee: _fee,
    fee_paise: _paise,
    collective: _collective,
    tags: _tags,
    ...rest
  } = input as typeof input & { fee?: unknown; fee_paise?: unknown };
  return bookingStub(ctx, gig_id).update(
    { ...rest, ...(await managerTagRefs(ctx, gig_id, input)), fee_paise: paiseOf(input, "fee") },
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export function setBookingStatus(ctx: OpUserCtx, input: z.output<typeof BookingStatusInput>) {
  const refund = paiseOf(input, "refund");
  return bookingStub(ctx, input.gig_id).setStatus(
    input.action,
    input.reason ?? null,
    actorOf(ctx),
    ctx.idempotencyKey,
    refund ? { amount_paise: refund, method: input.refund_method } : null,
  );
}

export const deleteBooking = (ctx: OpUserCtx, gigId: string) =>
  bookingStub(ctx, gigId).remove(actorOf(ctx), ctx.idempotencyKey);

export function addBookingEvent(ctx: OpUserCtx, input: z.output<typeof AddEventInput>) {
  const { gig_id, ...event } = input;
  return bookingStub(ctx, gig_id).addEvent(event, actorOf(ctx), ctx.idempotencyKey);
}

export function updateBookingEvent(ctx: OpUserCtx, input: z.output<typeof UpdateEventInput>) {
  const { gig_id, event_id, ...rest } = input;
  return bookingStub(ctx, gig_id).updateEvent(event_id, rest, actorOf(ctx), ctx.idempotencyKey);
}

export function setAttendance(ctx: OpUserCtx, input: z.output<typeof SetAttendanceInput>) {
  return bookingStub(ctx, input.gig_id).setAttendance(
    input.event_id,
    input.person_id ?? null,
    input.going,
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export const removeBookingEvent = (ctx: OpUserCtx, gigId: string, eventId: string) =>
  bookingStub(ctx, gigId).removeEvent(eventId, actorOf(ctx), ctx.idempotencyKey);

export async function addBookingPerson(ctx: OpUserCtx, input: z.output<typeof AddPersonInput>) {
  const [person] = await resolvePeople(ctx, [input]);
  const view = await bookingStub(ctx, input.gig_id).addPerson(person!, actorOf(ctx), ctx.idempotencyKey);
  if (person!.email && !person!.user_id) await recordAwaiting(ctx.d1, ctx.objects, input.gig_id);
  return view;
}

export function updateBookingPerson(ctx: OpUserCtx, input: z.output<typeof UpdatePersonInput>) {
  const { gig_id, person_id, ...rest } = input;
  return bookingStub(ctx, gig_id).updatePerson(person_id, rest, actorOf(ctx), ctx.idempotencyKey);
}

/** Returns the updated gig, or `{ removed: true }` when you removed yourself. */
export async function removeBookingPerson(
  ctx: OpUserCtx,
  gigId: string,
  personId: string,
): Promise<BookingView | { removed: true }> {
  return (await bookingStub(ctx, gigId).removePerson(personId, actorOf(ctx), ctx.idempotencyKey)) as
    BookingView | { removed: true };
}

/** My gigs' events from my own summaries (may lag a few seconds behind a change). */
export async function findMyGigs(
  ctx: OpUserCtx,
  input: z.output<typeof FindMyGigsInput>,
): Promise<Page<MyEventView>> {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && (!after || after.length !== 2))
    throw new AppError("validation_failed", "Invalid cursor");
  const rows = await personStub(ctx).events({
    from: input.from,
    to: input.to,
    q: input.q,
    status: input.status,
    kind: input.kind,
    order: input.order,
    limit: input.limit + 1,
    after: after as [string, string] | null,
  });
  const more = rows.length > input.limit;
  const items = rows.slice(0, input.limit).map(({ share_paise, ...r }) => ({
    ...r,
    kind: r.kind ?? "show",
    going: r.going ?? null,
    start_display: formatDateTimeIST(r.start_at),
    share: money(share_paise),
    collective_name: r.collective_name ?? null,
  }));
  const last = items.at(-1);
  return { items, next_cursor: more && last ? encodeCursor([last.start_at, last.event_id]) : null };
}

// --- Money (step 3) -------------------------------------------------------------------

export function recordGigPayment(ctx: OpUserCtx, input: z.output<typeof RecordGigPaymentInput>) {
  return bookingStub(ctx, input.gig_id).recordPayment(
    {
      amount_paise: paiseOf(input, "amount", true),
      paid_on: input.paid_on,
      method: input.method,
      note: input.note ?? null,
    },
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export const reverseGigPayment = (ctx: OpUserCtx, input: z.output<typeof GigPaymentRef>) =>
  bookingStub(ctx, input.gig_id).reversePayment(
    input.payment_id,
    input.note ?? null,
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export function recordGigExpense(ctx: OpUserCtx, input: z.output<typeof RecordGigExpenseInput>) {
  return bookingStub(ctx, input.gig_id).recordExpense(
    {
      event_id: input.event_id ?? null,
      category: input.category,
      amount_paise: paiseOf(input, "amount", true),
      spent_on: input.spent_on,
      note: input.note ?? null,
    },
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export const removeGigExpense = (ctx: OpUserCtx, gigId: string, expenseId: string) =>
  bookingStub(ctx, gigId).removeExpense(expenseId, actorOf(ctx), ctx.idempotencyKey);

/**
 * Works out each lineup entry's share: split equally, by percentages of split_total, or
 * as given per person (missing shares are 0). The gig checks who the people are.
 */
export function lineupShares(input: z.output<typeof SetEventLineupInput>): number[] {
  const entries = input.lineup;
  const total = paiseOf(input, "split_total");
  const percents = entries.map((e) => e.percent);
  try {
    if (input.split === "equal") {
      if (total === undefined)
        throw new AppError("validation_failed", "Give split_total to split equally", {
          field: "split_total",
        });
      return entries.length ? splitEqual(total, entries.length) : [];
    }
    if (percents.some((p) => p !== undefined)) {
      if (total === undefined)
        throw new AppError("validation_failed", "Give split_total to split by percent", {
          field: "split_total",
        });
      if (percents.some((p) => p === undefined))
        throw new AppError("validation_failed", "Give a percent for everyone, or amounts for everyone");
      return splitPercent(total, percents as number[]);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("validation_failed", (e as Error).message);
  }
  return entries.map((e) => paiseOf(e, "share") ?? 0);
}

export function setEventLineup(ctx: OpUserCtx, input: z.output<typeof SetEventLineupInput>) {
  const shares = lineupShares(input);
  return bookingStub(ctx, input.gig_id).setLineup(
    input.event_id,
    input.version,
    input.lineup.map((e, i) => ({
      person_id: e.person_id,
      person_name: e.person_name,
      part: e.part ?? null,
      share_paise: shares[i]!,
    })),
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export function recordGigPayout(ctx: OpUserCtx, input: z.output<typeof RecordGigPayoutInput>) {
  if (!input.person_id && !input.person_name)
    throw new AppError("validation_failed", "Give a person_id or person_name", { field: "person_id" });
  return bookingStub(ctx, input.gig_id).recordPayout(
    {
      person_id: input.person_id,
      person_name: input.person_name,
      event_id: input.event_id ?? null,
      amount_paise: paiseOf(input, "amount", true),
      paid_on: input.paid_on,
      method: input.method,
      note: input.note ?? null,
    },
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export const reverseGigPayout = (ctx: OpUserCtx, input: z.output<typeof GigPayoutRef>) =>
  bookingStub(ctx, input.gig_id).reversePayout(
    input.payout_id,
    input.note ?? null,
    actorOf(ctx),
    ctx.idempotencyKey,
  );
