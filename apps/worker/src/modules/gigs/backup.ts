// The gigs module's part of nightly backups: every gig's own database, found through
// the month registries (each gig registers in the month it was created).
import { isoDateIST } from "@assistant/shared";
import type { AdminCtx } from "../../core/module.ts";
import type { ObjectDump } from "../../core/objects/storage.ts";
import { bookingName, monthName, monthsBetween } from "./objects/names.ts";

/** The first month the gig-centric app stored gigs. */
const FIRST_MONTH = "2026-09";

export interface GigsBackup {
  gigs: Record<string, ObjectDump>;
}

export async function exportGigs(ctx: AdminCtx, now = new Date()): Promise<GigsBackup> {
  const gigs: GigsBackup["gigs"] = {};
  for (const ym of monthsBetween(FIRST_MONTH, isoDateIST(now.toISOString()).slice(0, 7))) {
    for (const id of await ctx.objects.MONTHS.getByName(monthName(ym)).createdGigs()) {
      const dump = await ctx.objects.BOOKINGS.getByName(bookingName(id)).exportData();
      if (dump) gigs[id] = dump;
    }
  }
  return { gigs };
}

/** Restores gigs that don't exist; existing gigs are left alone. */
export async function importGigs(ctx: AdminCtx, data: unknown): Promise<number> {
  const gigs = (data as GigsBackup | null)?.gigs ?? {};
  let restored = 0;
  for (const [id, dump] of Object.entries(gigs)) {
    if (await ctx.objects.BOOKINGS.getByName(bookingName(id)).importData(dump)) restored++;
  }
  return restored;
}
