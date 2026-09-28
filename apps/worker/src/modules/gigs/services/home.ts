// Home and reports (docs/design/gig-centric.md §7): one call to my own person object, then
// sums over my summary rows. Only my money: my share and what's been paid to me, plus the
// full money of gigs I manage (those rows carry it; players' rows don't).
import {
  formatDateIST,
  formatDateTimeIST,
  isoDateIST,
  money,
  toUtcIso,
  type GigAmount,
  type HomeView,
  type ManagedTotals,
  type MyReportInput,
  type MyReportView,
  type MyTotals,
  type ReportMonth,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpUserCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { personName } from "../objects/names.ts";
import { attachPendingPeople, findTags, tagKey } from "./tags.ts";
import type { PersonGigSummary } from "../objects/types.ts";

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
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
/** Start of an India calendar day, as UTC. */
const dayStart = (d: string) => toUtcIso(`${d}T00:00`);

const personStub = (ctx: OpUserCtx) => ctx.objects.PEOPLE.getByName(personName(ctx.user.id));

function gigAmounts(rows: PersonGigSummary[], amount: (g: PersonGigSummary) => number) {
  const gigs: GigAmount[] = rows
    .map((g) => ({ g, n: amount(g) }))
    .filter((x) => x.n > 0)
    .map(({ g, n }) => ({
      gig_id: g.gig_id,
      gig_title: g.gig_title,
      client_name: g.client_name,
      first_start_at: g.first_start_at,
      first_start_display: formatDateIST(g.first_start_at),
      amount: money(n),
    }));
  return { total: money(sum(gigs.map((x) => x.amount.amount_paise))), gigs };
}

export async function getHome(ctx: OpUserCtx): Promise<HomeView> {
  const nowIso = new Date().toISOString();
  const today = isoDateIST(nowIso);
  const ym = today.slice(0, 7);
  const monthStart = dayStart(`${ym}-01`);
  const nextMonth =
    Number(ym.slice(5)) === 12
      ? `${Number(ym.slice(0, 4)) + 1}-01`
      : `${ym.slice(0, 5)}${String(Number(ym.slice(5)) + 1).padStart(2, "0")}`;
  // Safety net for sign-up: gigs that added my email before I had an account.
  if (ctx.user.email)
    await attachPendingPeople(ctx.d1, ctx.objects, { id: ctx.user.id, email: ctx.user.email });
  const person = personStub(ctx);
  const [events, gigs] = await Promise.all([
    person.events({ from: nowIso, exclude_status: "cancelled", limit: 8 }),
    person.gigs(),
  ]);

  const live = gigs.filter((g) => g.status !== "cancelled");
  const played = live.filter((g) => g.first_start_at <= nowIso);
  const thisMonth = live.filter(
    (g) => g.first_start_at >= monthStart && g.first_start_at < dayStart(`${nextMonth}-01`),
  );
  const managed = played.filter((g) => g.role === "manager");

  return {
    upcoming: events
      .filter((e) => e.status !== "cancelled")
      .slice(0, 8)
      .map(({ share_paise, ...e }) => ({
        ...e,
        start_display: formatDateTimeIST(e.start_at),
        share: money(share_paise),
        collective_name: e.collective_name ?? null,
      })),
    this_month: {
      label: monthLabel(ym),
      gigs: thisMonth.length,
      earned: money(sum(thisMonth.map((g) => g.share_paise))),
      received: money(sum(thisMonth.map((g) => g.paid_paise))),
    },
    owed_to_me: gigAmounts(played, (g) => g.share_paise - g.paid_paise),
    to_collect: gigAmounts(managed, (g) => (g.fee_paise ?? 0) - (g.received_paise ?? 0)),
    to_pay: gigAmounts(managed, (g) => (g.shares_total_paise ?? 0) - (g.payouts_paise ?? 0)),
  };
}

function myTotals(rows: PersonGigSummary[]): MyTotals {
  const share = sum(rows.map((g) => g.share_paise));
  const paid = sum(rows.map((g) => g.paid_paise));
  return { gigs: rows.length, share: money(share), paid: money(paid), owed: money(share - paid) };
}

function managedTotals(rows: PersonGigSummary[]): ManagedTotals | null {
  const m = rows.filter((g) => g.role === "manager");
  if (!m.length) return null;
  const t = (k: keyof PersonGigSummary) => sum(m.map((g) => (g[k] as number | null) ?? 0));
  const fee = t("fee_paise");
  const received = t("received_paise");
  const expenses = t("expenses_paise");
  const shares = t("shares_total_paise");
  return {
    gigs: m.length,
    fee: money(fee),
    received: money(received),
    due: money(fee - received),
    expenses: money(expenses),
    shares: money(shares),
    paid_out: money(t("payouts_paise")),
    net: money(fee - shares - expenses),
  };
}

export async function getMyReport(
  ctx: OpUserCtx,
  input: z.output<typeof MyReportInput>,
): Promise<MyReportView> {
  if (input.to < input.from) throw new AppError("validation_failed", "`to` is before `from`");
  const [collective] = input.collective ? await findTags(ctx.d1, "collective", [input.collective]) : [];
  const tags = input.tags.length ? await findTags(ctx.d1, "custom", input.tags) : [];
  // An unknown collective or tag matches no gigs.
  const unknown = (input.collective && !collective) || tags.length < new Set(input.tags.map(tagKey)).size;
  let rows: PersonGigSummary[] = await personStub(ctx).gigs({
    from: dayStart(input.from),
    to: dayStart(nextDay(input.to)),
    status: input.status,
    role: input.role,
    client: input.client,
    collective_id: collective?.id,
    tag_ids: tags.map((t) => t.id),
    with_tags: true,
  });
  if (unknown) rows = [];
  if (!input.status) rows = rows.filter((g) => g.status !== "cancelled");

  const months = new Map<string, PersonGigSummary[]>();
  for (const g of rows) {
    const ym = isoDateIST(g.first_start_at).slice(0, 7);
    months.set(ym, [...(months.get(ym) ?? []), g]);
  }
  const by_month: ReportMonth[] = [...months.entries()].map(([ym, list]) => ({
    month: ym,
    label: monthLabel(ym),
    mine: myTotals(list),
    managed: managedTotals(list),
  }));

  return {
    from: input.from,
    to: input.to,
    mine: myTotals(rows),
    managed: managedTotals(rows),
    by_month,
    gigs: rows.map((g) => {
      const manager = g.role === "manager";
      return {
        gig_id: g.gig_id,
        gig_title: g.gig_title,
        collective_name: g.collective?.name ?? null,
        tags: (g.tags ?? []).map((t) => t.name),
        client_name: g.client_name,
        event_type: g.event_type,
        status: g.status,
        role: g.role,
        first_start_at: g.first_start_at,
        first_start_display: formatDateIST(g.first_start_at),
        share: money(g.share_paise),
        paid: money(g.paid_paise),
        owed: money(g.share_paise - g.paid_paise),
        fee: manager ? money(g.fee_paise ?? 0) : null,
        received: manager ? money(g.received_paise ?? 0) : null,
        net: manager
          ? money((g.fee_paise ?? 0) - (g.shares_total_paise ?? 0) - (g.expenses_paise ?? 0))
          : null,
      };
    }),
  };
}
