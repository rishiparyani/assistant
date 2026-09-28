// The gigs module's part of nightly backups: every gig's own database, found through
// the month registries (each gig registers in the month it was created), and everyone's
// address book (the rest of a person object is rebuilt from the gigs).
import { isoDateIST } from "@assistant/shared";
import type { AdminCtx } from "../../core/module.ts";
import type { ObjectDump } from "../../core/objects/storage.ts";
import { bookingName, monthName, monthsBetween, personName } from "./objects/names.ts";

/** The first month the gig-centric app stored gigs. */
const FIRST_MONTH = "2026-09";

export interface GigsBackup {
  gigs: Record<string, ObjectDump>;
  /** user id → address book rows */
  contacts?: Record<string, Record<string, SqlStorageValue>[]>;
}

export async function exportGigs(ctx: AdminCtx, now = new Date()): Promise<GigsBackup> {
  const gigs: GigsBackup["gigs"] = {};
  for (const ym of monthsBetween(FIRST_MONTH, isoDateIST(now.toISOString()).slice(0, 7))) {
    for (const id of await ctx.objects.MONTHS.getByName(monthName(ym)).createdGigs()) {
      const dump = await ctx.objects.BOOKINGS.getByName(bookingName(id)).exportData();
      if (dump) gigs[id] = dump;
    }
  }
  const contacts: NonNullable<GigsBackup["contacts"]> = {};
  const { results } = await ctx.d1.prepare(`select id from user`).all<{ id: string }>();
  for (const { id } of results) {
    const rows = await ctx.objects.PEOPLE.getByName(personName(id)).exportContacts();
    if (rows.length) contacts[id] = rows;
  }
  return { gigs, contacts };
}

/** Restores gigs and contacts that don't exist; existing ones are left alone. */
export async function importGigs(ctx: AdminCtx, data: unknown): Promise<number> {
  const backup = data as GigsBackup | null;
  let restored = 0;
  for (const [id, dump] of Object.entries(backup?.gigs ?? {})) {
    if (await ctx.objects.BOOKINGS.getByName(bookingName(id)).importData(dump)) restored++;
  }
  for (const [userId, rows] of Object.entries(backup?.contacts ?? {}))
    restored += await ctx.objects.PEOPLE.getByName(personName(userId)).importContacts(rows);
  return restored;
}
