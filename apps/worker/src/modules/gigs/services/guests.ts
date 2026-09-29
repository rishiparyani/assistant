// A gig's guest list (thin services in front of the gig's object) and its venue link: a
// secret link, opened without signing in, that shows the list and (if allowed) lets door
// staff tick arrivals. The token carries the gig's id, so no global lookup is needed; the
// gig keeps only the token's hash, plus the token sealed so managers can see it again.
import type {
  AddGigGuestsInput,
  GuestLinkInput,
  GuestLinkView,
  SetGuestListInput,
  SharedGuestListView,
  UpdateGigGuestInput,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpUserCtx } from "../../../core/operations.ts";
import type { Actor } from "../../../core/objects/storage.ts";
import { AppError } from "../../../core/errors.ts";
import { hashToken, newToken } from "../../../core/tokens.ts";
import { bookingName } from "../objects/names.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const gig = (ctx: OpUserCtx, gigId: string) => ctx.objects.BOOKINGS.getByName(bookingName(gigId));

export const GUEST_LINK_PREFIX = "gl";
const LINK_RE = /^gl_([0-9A-HJKMNP-TV-Z]{26})_[A-Za-z0-9_-]{43}$/;
export const guestLinkUrl = (baseUrl: string, token: string) => `${baseUrl}/guests/${token}`;

export const addGuests = (ctx: OpUserCtx, i: z.output<typeof AddGigGuestsInput>) =>
  gig(ctx, i.gig_id).addGuests(
    i.guests.map((g) => ({ id: g.id ?? null, name: g.name, plus_ones: g.plus_ones, note: g.note ?? null })),
    i.host_person_id ?? null,
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export const updateGuest = (ctx: OpUserCtx, i: z.output<typeof UpdateGigGuestInput>) =>
  gig(ctx, i.gig_id).updateGuest(
    i.guest_id,
    { name: i.name, plus_ones: i.plus_ones, note: i.note, arrived: i.arrived },
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export const removeGuest = (ctx: OpUserCtx, gigId: string, guestId: string) =>
  gig(ctx, gigId).removeGuest(guestId, actorOf(ctx), ctx.idempotencyKey);

export const setGuestList = (ctx: OpUserCtx, i: z.output<typeof SetGuestListInput>) =>
  gig(ctx, i.gig_id).setGuestList(
    { total_limit: i.total_limit, per_person_limit: i.per_person_limit, closes_at: i.closes_at },
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export async function getGuestLink(ctx: OpUserCtx, gigId: string): Promise<GuestLinkView> {
  const link = await gig(ctx, gigId).guestLink(actorOf(ctx));
  return {
    enabled: !!link.sealed,
    url: link.sealed ? guestLinkUrl(ctx.baseUrl, await ctx.sealer.unseal(link.sealed)) : null,
    check_in: link.check_in,
  };
}

/** Turns the link on (keeping the current one unless `reset`), and sets door check-in. */
export async function enableGuestLink(ctx: OpUserCtx, i: z.output<typeof GuestLinkInput>) {
  const current = await gig(ctx, i.gig_id).guestLink(actorOf(ctx));
  let link: { hash: string; sealed: string } | undefined;
  if (!current.sealed || i.reset) {
    const token = `${GUEST_LINK_PREFIX}_${i.gig_id}_${newToken("x").slice(2)}`;
    if (!LINK_RE.test(token)) throw new AppError("validation_failed", "This gig can't have a link");
    link = { hash: await hashToken(token), sealed: await ctx.sealer.seal(token) };
  }
  await gig(ctx, i.gig_id).setGuestLink(link, i.check_in, actorOf(ctx), ctx.idempotencyKey);
  return getGuestLink(ctx, i.gig_id);
}

export async function disableGuestLink(ctx: OpUserCtx, gigId: string): Promise<GuestLinkView> {
  await gig(ctx, gigId).setGuestLink(null, undefined, actorOf(ctx), ctx.idempotencyKey);
  return { enabled: false, url: null, check_in: false };
}

// --- The venue's side (no sign-in; the link is the key) ---------------------------------

const stubFor = (env: Env, token: string) => {
  const m = LINK_RE.exec(token);
  return m ? env.BOOKINGS.getByName(bookingName(m[1]!)) : null;
};

export async function sharedGuestList(env: Env, token: string): Promise<SharedGuestListView | null> {
  const stub = stubFor(env, token);
  return stub ? stub.sharedGuests(await hashToken(token)) : null;
}

export async function sharedGuestAction(
  env: Env,
  token: string,
  action: string,
  body: unknown,
  key: string | null,
): Promise<SharedGuestListView | null> {
  const stub = stubFor(env, token);
  if (!stub) return null;
  if (action !== "arrive") throw new AppError("not_found", "Unknown action");
  const b = body as { guest_id?: unknown; arrived?: unknown };
  if (typeof b?.guest_id !== "string" || b.guest_id.length > 40 || typeof b.arrived !== "boolean")
    throw new AppError("validation_failed", "Give guest_id and arrived (true or false)");
  // Keys from the link live alongside members' keys in the gig; keep them apart.
  return stub.sharedArrive(await hashToken(token), b.guest_id, b.arrived, key ? `link:${key}` : null);
}
