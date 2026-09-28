// Gig-centric gigs (docs/design/gig-centric.md): thin services in front of each gig's own
// Durable Object. The Worker validates input, matches people to accounts and picks the
// gig's id; the object checks roles, stores idempotency and audit, and announces changes.
import {
  decodeCursor,
  encodeCursor,
  formatDateTimeIST,
  ulid,
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
} from "@assistant/shared";
import type { z } from "zod";
import type { OpUserCtx } from "../../../core/operations.ts";
import type { Actor } from "../../../core/objects/storage.ts";
import { AppError } from "../../../core/errors.ts";
import type { PersonInput } from "../objects/booking.ts";
import { bookingName, personName } from "../objects/names.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const bookingStub = (ctx: OpUserCtx, gigId: string) => ctx.objects.BOOKINGS.getByName(bookingName(gigId));
const personStub = (ctx: OpUserCtx) => ctx.objects.PEOPLE.getByName(personName(ctx.user.id));

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
  return bookingStub(ctx, gigId).create(
    {
      gig_id: gigId,
      title: input.title,
      event_type: input.event_type ?? null,
      status: input.status,
      client: input.client ?? null,
      notes: input.notes ?? null,
      events: input.events,
      people,
    },
    actorOf(ctx),
    ctx.idempotencyKey,
  );
}

export const getBooking = (ctx: OpUserCtx, gigId: string) => bookingStub(ctx, gigId).view(actorOf(ctx));

export const bookingHistory = (ctx: OpUserCtx, gigId: string) =>
  bookingStub(ctx, gigId).history(actorOf(ctx));

export function updateBooking(ctx: OpUserCtx, input: z.output<typeof UpdateBookingInput>) {
  const { gig_id, ...rest } = input;
  return bookingStub(ctx, gig_id).update(rest, actorOf(ctx), ctx.idempotencyKey);
}

export function setBookingStatus(
  ctx: OpUserCtx,
  input: { gig_id: string; action: "confirm" | "complete" | "cancel"; reason?: string | null },
) {
  return bookingStub(ctx, input.gig_id).setStatus(
    input.action,
    input.reason ?? null,
    actorOf(ctx),
    ctx.idempotencyKey,
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

export const removeBookingEvent = (ctx: OpUserCtx, gigId: string, eventId: string) =>
  bookingStub(ctx, gigId).removeEvent(eventId, actorOf(ctx), ctx.idempotencyKey);

export async function addBookingPerson(ctx: OpUserCtx, input: z.output<typeof AddPersonInput>) {
  const [person] = await resolvePeople(ctx, [input]);
  return bookingStub(ctx, input.gig_id).addPerson(person!, actorOf(ctx), ctx.idempotencyKey);
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
    order: input.order,
    limit: input.limit + 1,
    after: after as [string, string] | null,
  });
  const more = rows.length > input.limit;
  const items = rows
    .slice(0, input.limit)
    .map((r) => ({ ...r, start_display: formatDateTimeIST(r.start_at) }));
  const last = items.at(-1);
  return { items, next_cursor: more && last ? encodeCursor([last.start_at, last.event_id]) : null };
}
