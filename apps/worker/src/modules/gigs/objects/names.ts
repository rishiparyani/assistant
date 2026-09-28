// How objects are named (the name decides which small database a request reaches).
import { isoDateIST, ulidTime } from "@assistant/shared";

export const bookingName = (gigId: string) => `booking:${gigId}`;
export const personName = (userId: string) => `person:${userId}`;
export const monthName = (ym: string) => `index:${ym}`;

/** A few shards so an outage doesn't funnel every waiting gig into one object. */
export const PENDING_SHARDS = 4;
export const pendingName = (shard: number) => `pending:${shard}`;
export function pendingShard(gigId: string): number {
  let h = 0;
  for (const c of gigId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % PENDING_SHARDS;
}

/** "YYYY-MM" in India time for a UTC ISO time. */
export const monthOf = (utcIso: string) => isoDateIST(utcIso).slice(0, 7);

/** The month a gig was created in, read from its ULID. */
export const createdMonthOf = (gigId: string) => monthOf(new Date(ulidTime(gigId)).toISOString());

/** Months from `from` to `to` inclusive ("YYYY-MM"). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
