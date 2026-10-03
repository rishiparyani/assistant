// Short spoken answers for Siri Shortcuts (T09): built from Home and my gigs, so they add
// up only what I'm allowed to see. The text is meant to be read out as-is.
import {
  formatDateIST,
  formatDateTimeIST,
  formatINR,
  type BriefInput,
  type BriefView,
  type PickInput,
  type PickView,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpUserCtx } from "../../../core/operations.ts";
import { getBooking } from "./bookings.ts";
import { personName } from "../objects/names.ts";

const personStub = (ctx: OpUserCtx) => ctx.objects.PEOPLE.getByName(personName(ctx.user.id));
import { getHome } from "./home.ts";

/** "Sat, 12 Dec 2026, 7:00 pm IST" → "Sat, 12 Dec, 7:00 pm" */
const spoken = (iso: string) =>
  formatDateTimeIST(iso)
    .replace(/ \d{4},/, ",")
    .replace(/ IST$/, "");
const list = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join("; ")}; and ${parts.at(-1)}`;

export async function getBrief(ctx: OpUserCtx, input: z.output<typeof BriefInput>): Promise<BriefView> {
  if (input.what === "next" || input.what === "week") {
    const now = new Date();
    // Cancelled gigs are left out in the query, so they never use up the limit.
    const events = await personStub(ctx).events({
      from: now.toISOString(),
      to: input.what === "week" ? new Date(now.getTime() + 7 * 86400_000).toISOString() : undefined,
      exclude_status: "cancelled",
      // "Next gig" means the next show; the week's list includes rehearsals.
      kind: input.what === "next" ? "show" : undefined,
      order: "asc",
      limit: input.what === "next" ? 1 : 100,
    });
    // One item per gig (its first event in the period), so a two-day wedding is one gig;
    // a gig's rehearsals are their own items.
    const firsts = [
      ...new Map(events.map((e) => [e.kind === "rehearsal" ? e.event_id : e.gig_id, e])).values(),
    ].sort((a, b) => a.start_at.localeCompare(b.start_at));
    const items = firsts.map((e) => ({
      gig_id: e.gig_id,
      title:
        e.kind === "rehearsal"
          ? `Rehearsal for ${e.gig_title}`
          : e.hold
            ? `${e.gig_title} (on hold, not picked yet)`
            : e.event_title && e.event_title !== e.gig_title
              ? `${e.gig_title}: ${e.event_title}`
              : e.gig_title,
      when: spoken(e.start_at),
      venue: e.venue_name,
    }));
    const say = (i: (typeof items)[number]) => `${i.title}, ${i.when}${i.venue ? `, at ${i.venue}` : ""}`;
    if (input.what === "next") {
      const next = items[0];
      return next
        ? { text: `Your next gig is ${say(next)}.`, items: [next] }
        : { text: "You have no upcoming gigs.", items: [] };
    }
    if (!items.length) return { text: "No gigs in the next 7 days.", items };
    return {
      text: `${items.length === 1 ? "One gig" : `${items.length} gigs`} in the next 7 days: ${list(items.map(say))}.`,
      items,
    };
  }

  const home = await getHome(ctx);
  const group =
    input.what === "owed_to_me"
      ? home.owed_to_me
      : input.what === "to_collect"
        ? home.to_collect
        : home.to_pay;
  const items = group.gigs.map((g) => ({
    gig_id: g.gig_id,
    title: g.gig_title,
    when: g.first_start_display,
    amount: g.amount,
  }));
  const parts = group.gigs.map((g) => `${formatINR(g.amount.amount_paise)} for ${g.gig_title}`);
  const total = group.total.amount_display;
  if (!items.length)
    return {
      text:
        input.what === "owed_to_me"
          ? "Nobody owes you anything for gigs you've played."
          : input.what === "to_collect"
            ? "No client owes money on gigs you manage."
            : "You've paid everyone on gigs you manage.",
      items,
    };
  const lead =
    input.what === "owed_to_me"
      ? `You're owed ${total}`
      : input.what === "to_collect"
        ? `Clients still owe ${total}`
        : `You still have to pay ${total} to the people playing`;
  return { text: `${lead}: ${list(parts)}.`, items };
}

/**
 * Labels to choose from in a Shortcut: my gigs (latest first, not cancelled) matching `q`,
 * or the other people on one gig. Labels are unique so they can be looked up again.
 */
export async function pick(ctx: OpUserCtx, input: z.output<typeof PickInput>): Promise<PickView> {
  const choices: Record<string, string> = {};
  const add = (label: string, id: string) => {
    let l = label;
    for (let n = 2; l in choices; n++) l = `${label} (${n})`;
    choices[l] = id;
  };
  if (input.gig_id) {
    const gig = await getBooking(ctx, input.gig_id);
    for (const p of gig.people) if (!p.is_me) add(p.name, p.id);
    return { choices };
  }
  // Distinct gigs (not events), not cancelled, latest first: straight from my gig rows.
  for (const g of await personStub(ctx).pickGigs(input.q ?? null, 10))
    add(`${g.gig_title} · ${formatDateIST(g.first_start_at).replace(/ \d{4}$/, "")}`, g.gig_id);
  return { choices };
}
