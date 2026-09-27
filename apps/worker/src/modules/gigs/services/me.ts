// The Me Home (decision 2026-09-27): what concerns the signed-in person across every
// workspace they belong to that has Gigs enabled. Only their own amounts: shares come from
// roster entries linked to their account, never from other people's rows.
import { and, asc, gte, inArray, isNull, ne } from "drizzle-orm";
import {
  isoDateIST,
  money,
  toUtcIso,
  type MyGig,
  type MyHomeView,
  type MyWorkspaceMoney,
  type WorkspaceKind,
} from "@assistant/shared";
import type { OpUserCtx } from "../../../core/operations.ts";
import { gigs } from "../schema.ts";
import { gigViewQuery, toGigView } from "./gigs.ts";
import { nowIso } from "./shared.ts";

type Ws = { id: string; name: string; kind: WorkspaceKind; role: "owner" | "member" };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** Gigs whose money is due: they happened (or are happening) and weren't just an enquiry. */
const DUE = new Set(["confirmed", "completed"]);
const UPCOMING_LIMIT = 8;

function monthBounds(now: string) {
  const ym = isoDateIST(now).slice(0, 7);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return {
    label: `${MONTHS[m - 1]} ${y}`,
    firstDay: `${ym}-01`,
    nextFirstDay: `${next}-01`,
    startUtc: toUtcIso(`${ym}-01`),
    endUtc: toUtcIso(`${next}-01`),
  };
}

async function all<T>(stmt: D1PreparedStatement): Promise<T[]> {
  return (await stmt.all<T>()).results;
}

const ref = (w: Ws) => ({ id: w.id, name: w.name, kind: w.kind });

export async function getMyHome(ctx: OpUserCtx): Promise<MyHomeView> {
  const d1 = ctx.d1;
  const me = ctx.user.id;
  const now = nowIso();
  const month = monthBounds(now);
  const inMonth = (iso: string) => iso >= month.startUtc && iso < month.endUtc;

  // Workspaces I belong to with Gigs enabled (member_userId_idx, then primary keys).
  const workspaces = await all<Ws>(
    d1
      .prepare(
        `select o.id, o.name, coalesce(o.kind, 'band') as kind, m.role
         from member m
         join organization o on o.id = m.organizationId
         join workspace_modules wm on wm.workspace_id = o.id and wm.module_id = 'gigs' and wm.enabled = 1
         where m.userId = ?`,
      )
      .bind(me),
  );
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const personal = workspaces.filter((w) => w.kind === "personal" && w.role === "owner");
  const collectives = workspaces.filter((w) => w.kind !== "personal");

  // My roster entries, only in workspaces I still belong to (musicians_user_idx).
  const mine = (
    await all<{ id: string; workspace_id: string }>(
      d1.prepare(`select id, workspace_id from musicians where user_id = ? and deleted_at is null`).bind(me),
    )
  ).filter((m) => wsById.get(m.workspace_id)?.kind !== "personal" && wsById.has(m.workspace_id));
  const myMusicianIds = new Set(mine.map((m) => m.id));

  // --- My shares in collectives --------------------------------------------------------
  type Entry = {
    gig_id: string;
    share_paise: number;
    start_at: string;
    status: string;
    workspace_id: string;
  };
  type Payout = { gig_id: string; amount_paise: number; paid_on: string };
  const perMusician = await Promise.all(
    mine.map(async (m) => {
      const [entries, paid] = await Promise.all([
        all<Entry>(
          d1
            .prepare(
              `select l.gig_id, l.share_paise, g.start_at, g.status, g.workspace_id
               from gig_lineup l join gigs g on g.id = l.gig_id
               where l.workspace_id = ? and l.musician_id = ? and g.deleted_at is null`,
            )
            .bind(m.workspace_id, m.id),
        ),
        all<Payout>(
          d1
            .prepare(
              `select gig_id, amount_paise, paid_on from payouts where workspace_id = ? and musician_id = ?`,
            )
            .bind(m.workspace_id, m.id),
        ),
      ]);
      return { musician: m, entries, paid };
    }),
  );

  let earned = 0;
  let received = 0;
  const monthGigs = new Set<string>();
  const owedToMe = new Map<string, { amount: number; count: number }>();
  const bump = (map: Map<string, { amount: number; count: number }>, wsId: string, amount: number) => {
    if (amount <= 0) return;
    const cur = map.get(wsId) ?? { amount: 0, count: 0 };
    map.set(wsId, { amount: cur.amount + amount, count: cur.count + 1 });
  };

  for (const { musician, entries, paid } of perMusician) {
    const paidByGig = new Map<string, number>();
    for (const p of paid) {
      paidByGig.set(p.gig_id, (paidByGig.get(p.gig_id) ?? 0) + p.amount_paise);
      if (p.paid_on >= month.firstDay && p.paid_on < month.nextFirstDay) received += p.amount_paise;
    }
    for (const e of entries) {
      if (!DUE.has(e.status)) continue;
      if (inMonth(e.start_at) && e.start_at <= now) {
        earned += e.share_paise;
        monthGigs.add(e.gig_id);
      }
      if (e.start_at <= now)
        bump(owedToMe, musician.workspace_id, e.share_paise - (paidByGig.get(e.gig_id) ?? 0));
    }
  }

  // --- My personal workspace: I keep the fee minus what I pay others ------------------------
  for (const w of personal) {
    const [rows, othersShares, paymentsByGig, paidThisMonth] = await Promise.all([
      all<{ id: string; fee_paise: number; start_at: string; status: string }>(
        d1
          .prepare(
            `select id, fee_paise, start_at, status from gigs
             where workspace_id = ? and start_at < ? and deleted_at is null and status in ('confirmed', 'completed')`,
          )
          .bind(w.id, now),
      ),
      all<{ gig_id: string; total: number }>(
        d1
          .prepare(
            `select l.gig_id, sum(l.share_paise) as total from gig_lineup l join musicians mu on mu.id = l.musician_id
             where l.workspace_id = ? and (mu.user_id is null or mu.user_id <> ?) group by l.gig_id`,
          )
          .bind(w.id, me),
      ),
      all<{ gig_id: string; total: number }>(
        d1
          .prepare(
            `select gig_id, sum(amount_paise) as total from payments where workspace_id = ? group by gig_id`,
          )
          .bind(w.id),
      ),
      d1
        .prepare(
          `select coalesce(sum(amount_paise), 0) as total from payments where workspace_id = ? and paid_on >= ? and paid_on < ?`,
        )
        .bind(w.id, month.firstDay, month.nextFirstDay)
        .first<{ total: number }>(),
    ]);
    const others = new Map(othersShares.map((r) => [r.gig_id, r.total]));
    const got = new Map(paymentsByGig.map((r) => [r.gig_id, r.total]));
    received += paidThisMonth?.total ?? 0;
    for (const g of rows) {
      if (inMonth(g.start_at) && g.start_at <= now) {
        earned += g.fee_paise - (others.get(g.id) ?? 0);
        monthGigs.add(g.id);
      }
      if (g.start_at <= now) bump(owedToMe, w.id, g.fee_paise - (got.get(g.id) ?? 0));
    }
  }

  // --- What I owe others in collectives I own ------------------------------------------------
  const iOwe = new Map<string, { amount: number; count: number }>();
  for (const w of collectives.filter((c) => c.role === "owner")) {
    const [shares, paid] = await Promise.all([
      all<{ gig_id: string; musician_id: string; share_paise: number }>(
        d1
          .prepare(
            `select l.gig_id, l.musician_id, l.share_paise
             from gig_lineup l
             join gigs g on g.id = l.gig_id
             join musicians mu on mu.id = l.musician_id
             where l.workspace_id = ? and g.deleted_at is null and g.status in ('confirmed', 'completed')
               and g.start_at <= ? and (mu.user_id is null or mu.user_id <> ?)`,
          )
          .bind(w.id, now, me),
      ),
      all<{ gig_id: string; musician_id: string; total: number }>(
        d1
          .prepare(
            `select gig_id, musician_id, sum(amount_paise) as total from payouts where workspace_id = ? group by gig_id, musician_id`,
          )
          .bind(w.id),
      ),
    ]);
    const paidMap = new Map(paid.map((p) => [`${p.gig_id}:${p.musician_id}`, p.total]));
    const owedPerPerson = new Map<string, number>();
    for (const s of shares) {
      const due = s.share_paise - (paidMap.get(`${s.gig_id}:${s.musician_id}`) ?? 0);
      if (due > 0) owedPerPerson.set(s.musician_id, (owedPerPerson.get(s.musician_id) ?? 0) + due);
    }
    const total = [...owedPerPerson.values()].reduce((a, b) => a + b, 0);
    if (total > 0) iOwe.set(w.id, { amount: total, count: owedPerPerson.size });
  }

  // --- Upcoming gigs I'm involved in ------------------------------------------------------------
  const upcoming: MyGig[] = [];
  if (workspaces.length) {
    const rows = await gigViewQuery(ctx)
      .where(
        and(
          inArray(
            gigs.workspaceId,
            workspaces.map((w) => w.id),
          ),
          gte(gigs.startAt, now),
          isNull(gigs.deletedAt),
          ne(gigs.status, "cancelled"),
        ),
      )
      .orderBy(asc(gigs.startAt), asc(gigs.id))
      .limit(40);
    const lineups = rows.length
      ? await all<{
          gig_id: string;
          musician_id: string;
          share_paise: number;
          role: string | null;
          user_id: string | null;
        }>(
          d1
            .prepare(
              `select l.gig_id, l.musician_id, l.share_paise, l.role, mu.user_id
               from gig_lineup l join musicians mu on mu.id = l.musician_id
               where l.gig_id in (${rows.map(() => "?").join(", ")})`,
            )
            .bind(...rows.map((r) => r.gig.id)),
        )
      : [];
    for (const row of rows) {
      if (upcoming.length >= UPCOMING_LIMIT) break;
      const w = wsById.get(row.gig.workspaceId)!;
      const lineup = lineups.filter((l) => l.gig_id === row.gig.id);
      const gig = toGigView(row);
      if (w.kind === "personal") {
        const others = lineup.filter((l) => l.user_id !== me).reduce((s, l) => s + l.share_paise, 0);
        upcoming.push({
          gig,
          workspace: ref(w),
          involvement: "own",
          my_amount: money(gig.fee.amount_paise - others),
          my_role: null,
        });
        continue;
      }
      const mineHere = lineup.find((l) => myMusicianIds.has(l.musician_id));
      if (mineHere) {
        upcoming.push({
          gig,
          workspace: ref(w),
          involvement: "playing",
          my_amount: money(mineHere.share_paise),
          my_role: mineHere.role,
        });
      } else if (lineup.length === 0) {
        upcoming.push({
          gig,
          workspace: ref(w),
          involvement: "lineup_not_set",
          my_amount: null,
          my_role: null,
        });
      }
    }
  }

  const byWorkspace = (map: Map<string, { amount: number; count: number }>): MyWorkspaceMoney[] =>
    [...map.entries()]
      .map(([id, v]) => ({ workspace: ref(wsById.get(id)!), amount: money(v.amount), count: v.count }))
      .sort((a, b) => b.amount.amount_paise - a.amount.amount_paise);
  const sum = (map: Map<string, { amount: number }>) => [...map.values()].reduce((s, v) => s + v.amount, 0);

  const onRoster = new Set(mine.map((m) => m.workspace_id));
  return {
    upcoming,
    this_month: {
      label: month.label,
      earned: money(earned),
      received: money(received),
      gigs: monthGigs.size,
    },
    owed_to_me: { total: money(sum(owedToMe)), by_workspace: byWorkspace(owedToMe) },
    i_owe: { total: money(sum(iOwe)), by_workspace: byWorkspace(iOwe) },
    not_on_roster: collectives
      .filter((w) => !onRoster.has(w.id))
      .map((w) => ({ ...ref(w), can_fix: w.role === "owner" })),
  };
}
