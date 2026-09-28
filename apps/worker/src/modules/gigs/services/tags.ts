// Tags, autofill, people added before they had an account, and duplicate warnings
// (docs/design/gig-centric.md §2 rules 3, 5, 6, 8). The tag registry and the pending
// people list are the only D1 tables gigs write to, and only rarely.
import {
  formatDateIST,
  isoDateIST,
  toUtcIso,
  ulid,
  type AutofillView,
  type DuplicateWarning,
  type MyTagView,
} from "@assistant/shared";
import type { OpUserCtx } from "../../../core/operations.ts";
import type { ObjectBindings } from "../../../core/context.ts";
import { AppError } from "../../../core/errors.ts";
import { bookingName, monthName, personName } from "../objects/names.ts";
import type { TagRef } from "../objects/booking.ts";

type Kind = "collective" | "custom";

/** "  Monsoon   project " → "monsoon project": one tag however it's typed. */
export const tagKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Existing tags with these names (read only; unknown names are left out). */
export async function findTags(d1: D1Database, kind: Kind, names: string[]): Promise<TagRef[]> {
  const keys = [...new Set(names.map(tagKey))].filter(Boolean);
  if (!keys.length) return [];
  const { results } = await d1
    .prepare(
      `select id, name, name_key from tags where kind = ? and name_key in (${keys.map(() => "?").join(", ")})`,
    )
    .bind(kind, ...keys)
    .all<{ id: string; name: string; name_key: string }>();
  return keys.flatMap((k) =>
    results.filter((r) => r.name_key === k).map((r) => ({ id: r.id, name: r.name })),
  );
}

/** Tags with these names, creating the ones nobody has used yet (in the order given). */
export async function resolveTags(ctx: OpUserCtx, kind: Kind, names: string[]): Promise<TagRef[]> {
  const unique = [...new Map(names.map((n) => [tagKey(n), n.trim().replace(/\s+/g, " ")])).entries()];
  if (!unique.length) return [];
  const existing = await findTags(
    ctx.d1,
    kind,
    unique.map(([, n]) => n),
  );
  const missing = unique.filter(([k]) => !existing.some((t) => tagKey(t.name) === k));
  if (missing.length) {
    await ctx.d1.batch(
      missing.map(([k, n]) =>
        ctx.d1
          .prepare(
            `insert into tags (id, kind, name, name_key, created_by) values (?, ?, ?, ?, ?)
             on conflict (kind, name_key) do nothing`,
          )
          .bind(ulid(), kind, n, k, ctx.user.id),
      ),
    );
  }
  return findTags(
    ctx.d1,
    kind,
    unique.map(([, n]) => n),
  );
}

/** The gig's tag inputs as registry refs; undefined fields stay unchanged. */
export async function gigTagRefs(
  ctx: OpUserCtx,
  input: { collective?: string | null; tags?: string[] },
): Promise<{ collective?: TagRef | null; tags?: TagRef[] }> {
  return {
    collective:
      input.collective === undefined
        ? undefined
        : input.collective === null
          ? null
          : ((await resolveTags(ctx, "collective", [input.collective]))[0] ?? null),
    tags: input.tags === undefined ? undefined : await resolveTags(ctx, "custom", input.tags),
  };
}

export async function findMyTags(ctx: OpUserCtx, input: { kind?: Kind; q?: string }): Promise<MyTagView[]> {
  return ctx.objects.PEOPLE.getByName(personName(ctx.user.id)).tags({ kind: input.kind, search: input.q });
}

/**
 * "Use the people from the last Monsoon Project gig?": people only (no roles or amounts),
 * from my latest gig with that collective whose lineup I could see.
 */
export async function autofill(ctx: OpUserCtx, input: { collective: string }): Promise<AutofillView> {
  const [tag] = await findTags(ctx.d1, "collective", [input.collective]);
  if (!tag) return { from_gig: null, people: [] };
  const gigId = await ctx.objects.PEOPLE.getByName(personName(ctx.user.id)).latestWithCollective(tag.id);
  if (!gigId) return { from_gig: null, people: [] };
  const view = await ctx.objects.BOOKINGS.getByName(bookingName(gigId)).view({
    userId: ctx.user.id,
    source: ctx.source,
  });
  return {
    from_gig: { id: view.id, title: view.title },
    people: view.people.filter((p) => !p.is_me).map((p) => ({ user_id: p.user_id, name: p.name })),
  };
}

/**
 * Warns when someone I've been on gigs with already has a gig that day at this venue or
 * for this client. Never blocks or merges; shows only their name, the date and the venue.
 */
export async function checkDuplicates(
  ctx: OpUserCtx,
  input: { start_at: string; venue_name?: string; client_name?: string },
): Promise<DuplicateWarning[]> {
  let startAt: string;
  try {
    startAt = toUtcIso(input.start_at);
  } catch (e) {
    throw new AppError("validation_failed", (e as Error).message, { field: "start_at" });
  }
  const venue = input.venue_name ? tagKey(input.venue_name) : null;
  const client = input.client_name ? tagKey(input.client_name) : null;
  if (!venue && !client) return [];
  const date = isoDateIST(startAt);
  const cards = (await ctx.objects.MONTHS.getByName(monthName(date.slice(0, 7))).onDate(date)).filter(
    (c) =>
      c.status !== "cancelled" && ((venue && c.venue_key === venue) || (client && c.client_key === client)),
  );
  if (!cards.length) return [];
  const me = ctx.objects.PEOPLE.getByName(personName(ctx.user.id));
  const mine = new Set(await me.onGigs([...new Set(cards.map((c) => c.gig_id))]));
  const others = cards.filter((c) => !mine.has(c.gig_id));
  const known = new Set(await me.knownAmong([...new Set(others.flatMap((c) => c.manager_user_ids))]));
  const names = await userNames(ctx.d1, [...known]);

  const seen = new Set<string>();
  const out: DuplicateWarning[] = [];
  for (const c of others) {
    const who = c.manager_user_ids.find((u) => known.has(u));
    if (!who || seen.has(c.gig_id)) continue;
    seen.add(c.gig_id);
    const byVenue = !!venue && c.venue_key === venue;
    const byClient = !!client && c.client_key === client;
    const name = names.get(who) ?? "Someone you know";
    const where = byVenue && c.venue_name ? ` at ${c.venue_name}` : byClient ? " for this client" : "";
    out.push({
      manager_name: name,
      date_display: formatDateIST(date),
      venue_name: byVenue ? (c.venue_name ?? null) : null,
      match: byVenue && byClient ? "venue_and_client" : byVenue ? "venue" : "client",
      message: `${name} has a gig on ${formatDateIST(date)}${where}. Is this the same one? Ask to be added instead.`,
    });
  }
  return out;
}

async function userNames(d1: D1Database, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { results } = await d1
    .prepare(`select id, name from "user" where id in (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: string; name: string }>();
  return new Map(results.map((r) => [r.id, r.name]));
}

// --- People added before they had an account ---------------------------------------------

/** Records the gig's people who are waiting for an account (by email) so sign-up finds them. */
export async function recordAwaiting(d1: D1Database, objects: ObjectBindings, gigId: string) {
  const waiting = await objects.BOOKINGS.getByName(bookingName(gigId)).awaitingAccounts();
  if (!waiting.length) return;
  await d1.batch(
    waiting.map((w) =>
      d1
        .prepare(`insert or ignore into pending_people (email, gig_id, person_id) values (?, ?, ?)`)
        .bind(w.email, gigId, w.person_id),
    ),
  );
}

/** Attaches a (new) account to every gig that added its email before it existed. */
export async function attachPendingPeople(
  d1: D1Database,
  objects: ObjectBindings,
  user: { id: string; email: string },
): Promise<number> {
  const email = user.email.toLowerCase();
  const { results } = await d1
    .prepare(`select gig_id, person_id from pending_people where email = ?`)
    .bind(email)
    .all<{ gig_id: string; person_id: string }>();
  let attached = 0;
  for (const r of results) {
    if (await objects.BOOKINGS.getByName(bookingName(r.gig_id)).attachAccount(r.person_id, user.id, email))
      attached++;
    await d1
      .prepare(`delete from pending_people where email = ? and gig_id = ? and person_id = ?`)
      .bind(email, r.gig_id, r.person_id)
      .run();
  }
  return attached;
}
