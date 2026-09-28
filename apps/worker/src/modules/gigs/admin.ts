// The gigs module's part of the owner-only admin panel: counts and delivery health, plus
// the safety-net tools (docs/design/gig-centric.md §6, §10b). Counts only.
import { isoDateIST } from "@assistant/shared";
import type { AdminCtx, ModuleAdmin } from "../../core/module.ts";
import { AppError } from "../../core/errors.ts";
import { flushOutboxes, rebuildSummaries, retryDeadLetters } from "./objects/delivery.ts";
import { monthName, pendingName, PENDING_SHARDS } from "./objects/names.ts";

const thisMonth = () => isoDateIST(new Date().toISOString()).slice(0, 7);
function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

async function waiting(ctx: AdminCtx) {
  const lists = await Promise.all(
    Array.from({ length: PENDING_SHARDS }, (_, i) => ctx.objects.PENDING.getByName(pendingName(i)).list()),
  );
  const all = lists.flat();
  const oldest = all.map((w) => w.since).sort()[0] ?? null;
  return { count: all.length, oldest };
}

export const gigsAdmin: ModuleAdmin = {
  async sections(ctx) {
    const now = thisMonth();
    const [created, createdPrev, pending] = await Promise.all([
      ctx.objects.MONTHS.getByName(monthName(now)).createdCount(),
      ctx.objects.MONTHS.getByName(monthName(prevMonth(now))).createdCount(),
      waiting(ctx),
    ]);
    const ageMin = pending.oldest ? Math.round((Date.now() - Date.parse(pending.oldest)) / 60_000) : 0;
    return [
      {
        title: "Gigs",
        stats: [
          { label: "Created this month", value: created },
          { label: "Created last month", value: createdPrev },
        ],
      },
      {
        title: "Delivery (outbox → queue)",
        stats: [
          {
            label: "Gigs with waiting updates",
            value: pending.count,
            tone: pending.count === 0 ? "ok" : "warn",
            hint: "Their notes couldn't be handed to the queue yet; they retry by themselves.",
          },
          {
            label: "Oldest waiting",
            value: pending.oldest ? `${ageMin} min` : "—",
            tone: !pending.oldest ? "ok" : ageMin >= 5 ? "bad" : "warn",
          },
        ],
      },
    ];
  },
  async checks(ctx) {
    const pending = await waiting(ctx);
    const ageMin = pending.oldest ? Math.round((Date.now() - Date.parse(pending.oldest)) / 60_000) : 0;
    const dead = await ctx.d1
      .prepare(`select count(distinct gig_id) as n from dead_letters`)
      .first<{ n: number }>();
    return [
      {
        id: "gigs.delivery_stuck",
        label: "Updates stuck",
        ok: ageMin < 5,
        detail: `${pending.count} gig${pending.count === 1 ? "" : "s"} waiting, oldest ${ageMin} min`,
        fix: "Admin panel → Flush outboxes. If it keeps happening, the queue may be down (Cloudflare status).",
      },
      {
        id: "gigs.dead_letters",
        label: "Failed deliveries",
        ok: (dead?.n ?? 0) === 0,
        detail: `${dead?.n ?? 0} gig${dead?.n === 1 ? "" : "s"} couldn't update people's Homes after every retry`,
        fix: "Admin panel → Retry failed deliveries.",
      },
    ];
  },
  tools: [
    {
      id: "retry_dead",
      label: "Retry failed deliveries",
      description:
        "Send the gigs whose updates failed every retry to people's Homes again, straight from each gig.",
      async run(ctx) {
        const { gigs } = await retryDeadLetters(ctx.objects, ctx.d1);
        return `Re-sent ${gigs} gig${gigs === 1 ? "" : "s"}.`;
      },
    },
    {
      id: "flush",
      label: "Flush outboxes",
      description: "Ask every gig with waiting updates to send them to the queue now.",
      async run(ctx) {
        const { gigs } = await flushOutboxes(ctx.objects);
        return `Asked ${gigs} gig${gigs === 1 ? "" : "s"} to send their updates.`;
      },
    },
    {
      id: "rebuild",
      label: "Rebuild summaries",
      description:
        "Recompute people's Homes and the month indexes straight from the gigs created in a month range. Safe to run any time.",
      fields: [
        { name: "from", label: "From month", placeholder: "2026-09" },
        { name: "to", label: "To month", placeholder: "2026-09" },
      ],
      async run(ctx, input) {
        const from = input.from?.trim() || thisMonth();
        const to = input.to?.trim() || from;
        if (!YM.test(from) || !YM.test(to) || from > to)
          throw new AppError("validation_failed", "Use months like 2026-09, with from ≤ to");
        const { gigs } = await rebuildSummaries(ctx.objects, from, to);
        return `Rebuilt summaries for ${gigs} gig${gigs === 1 ? "" : "s"} created ${from === to ? `in ${from}` : `from ${from} to ${to}`}.`;
      },
    },
  ],
};
