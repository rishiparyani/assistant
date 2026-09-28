// The summaries queue consumer and the safety-net tools (docs/design/gig-centric.md §6).
//
// Consumer: messages say "gig X changed up to sequence N". Delivery is at-least-once and
// unordered, so per batch we combine messages per gig, read each gig's current summaries
// once, and hand them to people and month indexes, which ignore anything older than what
// they have. Each message is acknowledged on its own; failures are retried and end up in
// the dead letter queue after the retries run out.
import { bookingName, monthName, monthsBetween, pendingName, personName, PENDING_SHARDS } from "./names.ts";
import type { GigSummaries, SummaryMessage } from "./types.ts";

/** The object namespaces delivery needs (a Worker env or a service's ctx.objects). */
type Objects = Pick<Env, "BOOKINGS" | "PEOPLE" | "MONTHS" | "PENDING">;

export async function deliverSummaries(env: Objects, summaries: GigSummaries): Promise<void> {
  const { gig_id, seq } = summaries;
  await Promise.all([
    ...Object.entries(summaries.people).map(([userId, rows]) =>
      env.PEOPLE.getByName(personName(userId)).apply(gig_id, seq, rows),
    ),
    ...Object.entries(summaries.months).map(([ym, cards]) =>
      env.MONTHS.getByName(monthName(ym)).apply(gig_id, seq, cards),
    ),
  ]);
}

export async function consumeSummaries(batch: MessageBatch<SummaryMessage>, env: Objects): Promise<void> {
  const byGig = new Map<string, Message<SummaryMessage>[]>();
  for (const msg of batch.messages) {
    const list = byGig.get(msg.body.gig_id) ?? [];
    list.push(msg);
    byGig.set(msg.body.gig_id, list);
  }
  await Promise.all(
    [...byGig.entries()].map(async ([gigId, messages]) => {
      try {
        const summaries = await env.BOOKINGS.getByName(bookingName(gigId)).summaries();
        if (summaries) await deliverSummaries(env, summaries);
        for (const m of messages) m.ack();
      } catch (err) {
        console.error("summaries: delivery failed for a gig; will retry", err);
        for (const m of messages) m.retry({ delaySeconds: Math.min(60, 2 ** m.attempts) });
      }
    }),
  );
}

// --- Safety-net tools (admin page buttons from step 1's admin work; runnable any time) --

/** Asks every gig on the pending lists to hand its waiting note to the queue now. */
export async function flushOutboxes(env: Objects): Promise<{ gigs: number }> {
  let gigs = 0;
  for (let shard = 0; shard < PENDING_SHARDS; shard++) {
    const waiting = await env.PENDING.getByName(pendingName(shard)).list();
    await Promise.all(
      waiting.map(async ({ gig_id }) => {
        if (await env.BOOKINGS.getByName(bookingName(gig_id)).flush()) gigs++;
      }),
    );
  }
  return { gigs };
}

/**
 * Recomputes summaries straight from the gigs created between two months ("YYYY-MM"),
 * delivering them directly (not through the queue), so it works even when the queue
 * doesn't. Safe to run any time: receivers keep whichever state is newest.
 */
export async function rebuildSummaries(env: Objects, from: string, to: string): Promise<{ gigs: number }> {
  let gigs = 0;
  for (const ym of monthsBetween(from, to)) {
    const ids = await env.MONTHS.getByName(monthName(ym)).createdGigs();
    for (const gigId of ids) {
      const summaries = await env.BOOKINGS.getByName(bookingName(gigId)).summaries();
      if (summaries) {
        await deliverSummaries(env, summaries);
        gigs++;
      }
    }
  }
  return { gigs };
}
