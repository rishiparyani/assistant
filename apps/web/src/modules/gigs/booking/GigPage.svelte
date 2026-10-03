<script lang="ts">
  import type {
    BookingEventView,
    BookingPersonView,
    BookingView,
    GigSettings,
    PayeeView,
    PaymentStatus,
  } from "@assistant/shared";
  import { formatDateIST, formatINR } from "@assistant/shared";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import User from "@lucide/svelte/icons/user";
  import Plus from "@lucide/svelte/icons/plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Check from "@lucide/svelte/icons/check";
  import Ban from "@lucide/svelte/icons/ban";
  import Undo from "@lucide/svelte/icons/undo-2";
  import Trash from "@lucide/svelte/icons/trash-2";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Wallet from "@lucide/svelte/icons/wallet";
  import Phone from "@lucide/svelte/icons/phone";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Users from "@lucide/svelte/icons/users";
  import {
    ActionSheet,
    Avatar,
    Button,
    Card,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Segmented,
    NotSaved,
    Skeleton,
    Stat,
    confirm,
    toast,
  } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { nextTab, revealTabs, slide, swipeTabs } from "../../../core/ui/swipe.ts";
  import { tick } from "svelte";
  import NotFound from "../../../core/pages/NotFound.svelte";
  import { ApiError } from "../../../core/api.ts";
  import { isOfflineError } from "../../../core/offline.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { createQuery, dropCache } from "../../../core/query.svelte.ts";
  import PaymentSheet from "../PaymentSheet.svelte";
  import { methodLabel } from "../options.ts";
  import { paymentLabel, paymentTone, statusLabel, statusTone } from "../status.ts";
  import { timeRange } from "../time.ts";
  import EventSheet from "./EventSheet.svelte";
  import ExpenseSheet from "./ExpenseSheet.svelte";
  import GigEditor from "./GigEditor.svelte";
  import LineupSheet from "./LineupSheet.svelte";
  import PersonSheet from "./PersonSheet.svelte";
  import CancelSheet from "./CancelSheet.svelte";
  import { withDefaults } from "./gig-defaults.ts";
  import { waitingMoney } from "../offline-changes.ts";
  import GigTogether from "./GigTogetherCard.svelte";
  import GigRehearsals from "./GigRehearsals.svelte";
  import RehearsalSheet from "./RehearsalSheet.svelte";
  import PickDateSheet from "./PickDateSheet.svelte";
  import GigDate from "../GigDate.svelte";
  import { HOLD_PILL } from "../status.ts";
  import Drum from "@lucide/svelte/icons/drum";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Receipt from "@lucide/svelte/icons/receipt";
  import History from "@lucide/svelte/icons/history";
  import IndianRupee from "@lucide/svelte/icons/indian-rupee";

  // One gig: always exact (read from the gig itself), showing only what I may see.
  let { gigId }: { gigId: string } = $props();

  // Shows the last known gig at once, then refreshes from the gig itself.
  const q = createQuery<BookingView>(
    () => `gig:${gigId}`,
    () => bookingsApi.get(gigId),
  );
  // A copy saved on this device before an app update may lack newer parts.
  const gig = $derived(q.data ? withDefaults(q.data) : null);

  const missing = $derived(q.error instanceof ApiError && q.error.status === 404);
  $effect(() => {
    if (missing) dropCache(`gig:${gigId}`);
  });
  let busy = $state("");

  let editOpen = $state(false);
  let payOpen = $state(false);
  let expenseOpen = $state(false);
  let eventOpen = $state(false);
  let eventFor = $state<BookingEventView | null>(null);
  let eventKind = $state<"show" | "rehearsal">("show");
  let eventHold = $state(false);
  let pickOpen = $state(false);
  let lineupOpen = $state(false);
  let lineupFor = $state<BookingEventView | null>(null);
  let personOpen = $state(false);
  let personFor = $state<BookingPersonView | null>(null);
  let payoutOpen = $state(false);
  let payoutFor = $state<PayeeView | null>(null);
  let cancelOpen = $state(false);
  let moreOpen = $state(false);
  let addOpen = $state(false);
  // Lineups are folded to one line per event; a one-event gig shows its lineup open.
  let unfolded = $state<Record<string, boolean>>({});
  const lineupOpenFor = (e: BookingEventView) => unfolded[e.id] ?? fixedShows.length === 1;
  // A gig's shows and its rehearsals (docs/design/rehearsals.md). A rehearsal that isn't
  // for a gig (kind "rehearsal") has only rehearsals, and no money.
  const rehearsalOnly = $derived(gig?.kind === "rehearsal");
  const noun = $derived(rehearsalOnly ? "rehearsal" : "gig");
  const shows = $derived(
    gig ? (rehearsalOnly ? gig.events : gig.events.filter((e) => e.kind === "show")) : [],
  );
  // Date options on an enquiry (soft blocks) until the client picks; the rest are fixed shows.
  const holds = $derived(shows.filter((e) => e.hold));
  const fixedShows = $derived(shows.filter((e) => !e.hold));
  const nextRehearsal = $derived(
    rehearsalOnly
      ? null
      : (gig?.events.find((e) => e.kind === "rehearsal" && Date.parse(e.start_at) > Date.now()) ?? null),
  );

  // Tabs keep the page short: what and when, the money, and who's on it. Guests, lists
  // and notes live on their own "Together" page (the card above the tabs).
  type Tab = "details" | "money" | "people";
  let tab = $state<Tab>("details");
  // Swipe sideways between the tabs; the new one slides in from the side it came from.
  const TABS = $derived<readonly Tab[]>(
    gig?.kind === "rehearsal" ? ["details", "people"] : ["details", "money", "people"],
  );
  let dir = $state<1 | -1>(1);
  let lastTab: Tab = "details";
  $effect.pre(() => {
    dir = TABS.indexOf(tab) >= TABS.indexOf(lastTab) ? 1 : -1;
    lastTab = tab;
  });
  const swipeTo = async (d: 1 | -1) => {
    const next = nextTab(TABS, tab, d);
    if (!next) return;
    tab = next;
    await tick();
    revealTabs("Sections");
  };

  const set = (g: BookingView) => q.set(g);
  const manager = $derived(gig?.my_role === "manager");
  const money = $derived(gig?.money);
  const progress = $derived(
    money?.fee && money.received && money.fee.amount_paise > 0
      ? Math.min(100, Math.max(0, (money.received.amount_paise / money.fee.amount_paise) * 100))
      : 0,
  );
  const live = $derived(gig ? gig.status === "enquiry" || gig.status === "confirmed" : false);

  // The summary at the top: when, where, who for and the money, a line each.
  const when = $derived.by(() => {
    if (holds.length && !fixedShows.length)
      return {
        day: holds.map((e) => formatDateIST(e.start_at).replace(/ \d{4}$/, "")).join(" · "),
        extra: `${holds.length === 1 ? "1 date option" : `${holds.length} date options`} · client to pick`,
      };
    if (!shows.length) return null;
    const first = shows[0]!;
    if (shows.length === 1)
      return { day: formatDateIST(first.start_at), extra: timeRange(first.start_at, first.end_at) };
    const firstDay = formatDateIST(first.start_at);
    const lastDay = formatDateIST(shows.at(-1)!.start_at);
    return {
      day: firstDay === lastDay ? firstDay : `${firstDay} – ${lastDay}`,
      extra: `${shows.length} ${rehearsalOnly ? "dates" : "events"}`,
    };
  });
  const where = $derived.by(() => {
    const events = shows;
    const venues = [...new Set(events.map((e) => e.venue_name).filter(Boolean))];
    const cities = [...new Set(events.map((e) => e.venue_city).filter(Boolean))];
    if (!venues.length) return cities.join(", ") || null;
    return [venues.join(" · "), cities.length === 1 ? cities[0] : null].filter(Boolean).join(", ");
  });
  const meta = $derived(
    gig
      ? [
          gig.collective?.name,
          gig.event_type ? gig.event_type[0]!.toUpperCase() + gig.event_type.slice(1) : null,
          ...gig.tags.map((t) => t.name),
        ].filter(Boolean)
      : [],
  );
  // The one next step worth a button (confirm an enquiry; mark played once it's over);
  // everything else is under More.
  // Without an end time, a gig counts as over 12 hours after it starts.
  const over = $derived(
    gig
      ? shows.every(
          (e) => (e.end_at ? Date.parse(e.end_at) : Date.parse(e.start_at) + 12 * 3600_000) <= Date.now(),
        )
      : false,
  );
  const nextStep = $derived(
    !manager || !gig || rehearsalOnly
      ? null
      : gig.status === "enquiry"
        ? ("confirm" as const)
        : gig.status === "confirmed" && over
          ? ("complete" as const)
          : null,
  );
  const setStatus = (a: "confirm" | "complete") => {
    // With date options, confirming first asks which date the client picked.
    if (a === "confirm" && holds.length) {
      pickOpen = true;
      return;
    }
    return act(
      a,
      () => bookingsApi.setStatus(gigId, a),
      a === "confirm" ? "Gig confirmed" : "Marked as played",
    );
  };
  const moreActions = $derived.by(() => {
    if (!gig || !manager) return [];
    const out: { label: string; icon?: typeof Check; destructive?: boolean; onclick: () => void }[] = [];
    if (gig.status === "enquiry" && !rehearsalOnly)
      out.push({ label: "Confirm gig", icon: Check, onclick: () => void setStatus("confirm") });
    if (gig.status === "confirmed" && !rehearsalOnly)
      out.push({ label: "Mark as played", icon: Check, onclick: () => void setStatus("complete") });
    if (live) out.push({ label: `Cancel ${noun}`, icon: Ban, onclick: () => (cancelOpen = true) });
    if (gig.status === "cancelled")
      out.push({ label: `Reopen ${noun}`, icon: Undo, onclick: () => void reopen() });
    out.push({ label: "History", icon: History, onclick: () => navigate(`/gigs/${gig!.id}/history`) });
    out.push({ label: `Delete ${noun}`, icon: Trash, destructive: true, onclick: () => void deleteGig() });
    return out;
  });
  // The Add menu: everything that can be added here. Empty sections aren't shown on the
  // page; they appear once something is added.
  const addActions = $derived.by(() => {
    if (!gig) return [];
    const open = gig.status !== "cancelled";
    const out: { label: string; icon?: typeof Check; onclick: () => void }[] = [];
    const together = (section: string) => () => navigate(`/gigs/${gig!.id}/${section}?add=1`);
    if (manager && open && !rehearsalOnly) {
      out.push({ label: "Rehearsal", icon: Drum, onclick: () => openEvent(null, "rehearsal") });
      if (gig.status === "enquiry")
        out.push({
          label: "Date option (hold)",
          icon: CalendarPlus,
          onclick: () => openEvent(null, "show", true),
        });
      out.push({
        label: "Event (e.g. Reception)",
        icon: CalendarPlus,
        onclick: () => openEvent(null, "show"),
      });
    }
    if (manager && open && rehearsalOnly)
      out.push({ label: "Another date", icon: CalendarPlus, onclick: () => openEvent(null, "rehearsal") });
    if (manager) out.push({ label: "Person", icon: UserPlus, onclick: () => openPerson(null) });
    if (manager || gig.guest_list.open)
      out.push({ label: "Guest", icon: Users, onclick: together("guests") });
    if (gig.can_edit_lists) {
      out.push({ label: "List (e.g. setlist)", icon: ListChecks, onclick: together("lists") });
      out.push({ label: "Note", icon: MessageSquare, onclick: together("notes") });
    }
    if (manager && !rehearsalOnly) {
      out.push({
        label: "Client payment",
        icon: IndianRupee,
        onclick: () => ((tab = "money"), (payOpen = true)),
      });
      out.push({ label: "Expense", icon: Receipt, onclick: () => ((tab = "money"), (expenseOpen = true)) });
    }
    return out;
  });
  /** "₹12,000 each" when the shares are equal, else their total. */
  function lineupMoney(e: BookingEventView) {
    const shares = e.lineup.map((l) => l.share).filter((x) => x != null);
    if (!shares.length || shares.length !== e.lineup.length) return null;
    if (shares.every((x) => x.amount_paise === shares[0]!.amount_paise))
      return `${shares[0]!.amount_display} each`;
    return `${formatINR(shares.reduce((n, x) => n + x.amount_paise, 0))} in shares`;
  }

  async function act(name: string, fn: () => Promise<BookingView>, done: string) {
    busy = name;
    try {
      q.set(await fn());
      toast.success(done);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = "";
    }
  }

  async function reopen() {
    const refunded = gig?.money.payments?.some((p) => p.kind === "refund");
    const ok = await confirm({
      title: `Reopen this ${noun}?`,
      message:
        "It goes back to how it was before it was cancelled, and everyone on it sees it again." +
        (refunded ? " The refund stays recorded; if it didn't happen, record the payment again." : ""),
      confirmLabel: "Reopen",
    });
    if (ok)
      await act(
        "reopen",
        () => bookingsApi.setStatus(gigId, "reopen"),
        rehearsalOnly ? "Rehearsal reopened" : "Gig reopened",
      );
  }

  async function deleteGig() {
    const ok = await confirm({
      title: `Delete this ${noun}?`,
      message: "It disappears for everyone on it. Use Cancel instead if it just isn't happening.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await bookingsApi.remove(gigId);
      toast.success(rehearsalOnly ? "Rehearsal deleted" : "Gig deleted");
      navigate("/gigs");
    } catch (e) {
      toast.error(e);
    }
  }

  async function reverse(kind: "payment" | "payout", id: string, label: string) {
    const ok = await confirm({
      title: `Reverse ${label}?`,
      message: "A correcting entry is added so the history stays complete.",
      confirmLabel: "Reverse",
      destructive: true,
    });
    if (!ok) return;
    await act(
      "rev",
      () =>
        kind === "payment" ? bookingsApi.reversePayment(gigId, id) : bookingsApi.reversePayout(gigId, id),
      "Reversed",
    );
  }

  async function removeExpense(id: string, amount: string) {
    const ok = await confirm({
      title: `Remove the ${amount} expense?`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) await act("exp", () => bookingsApi.removeExpense(gigId, id), "Expense removed");
  }

  async function removeEvent(e: BookingEventView) {
    const ok = await confirm({
      title: e.hold
        ? `Release ${formatDateIST(e.start_at)}?`
        : `Remove ${e.title ?? (e.kind === "rehearsal" ? "this rehearsal" : "this event")}?`,
      message: e.hold
        ? "The date is no longer held for this gig."
        : e.kind === "rehearsal"
          ? "Everyone's answers go too."
          : "Its lineup goes too. Payouts already recorded are kept.",
      confirmLabel: e.hold ? "Release" : "Remove",
      destructive: true,
    });
    if (ok)
      await act(
        "event",
        () => bookingsApi.removeEvent(gigId, e.id),
        e.hold ? "Date released" : e.kind === "rehearsal" ? "Rehearsal removed" : "Event removed",
      );
  }

  async function toggleSetting(key: keyof GigSettings) {
    if (!gig) return;
    await act(
      key,
      () => bookingsApi.update(gigId, gig!.version, { settings: { [key]: !gig!.settings[key] } }),
      "Saved",
    );
  }

  const openEvent = (
    e: BookingEventView | null,
    kind: "show" | "rehearsal" = e?.kind ?? "show",
    hold = e?.hold ?? false,
  ) => ((eventFor = e), (eventKind = kind), (eventHold = hold), (eventOpen = true));
  const openLineup = (e: BookingEventView) => ((lineupFor = e), (lineupOpen = true));
  const openPerson = (p: BookingPersonView | null) => ((personFor = p), (personOpen = true));
  const openPayout = (p: PayeeView) => ((payoutFor = p), (payoutOpen = true));

  const payoutLabel = (s: PaymentStatus) =>
    s === "paid" ? "Paid out" : s === "unpaid" ? "Owed" : paymentLabel(s);
  const SETTINGS: { key: keyof GigSettings; label: string; hint: string }[] = [
    {
      key: "players_see_lineup",
      label: "Players see who's playing",
      hint: "Otherwise they see only themselves and the managers.",
    },
    { key: "players_see_fee", label: "Players see the fee and client payments", hint: "" },
    { key: "players_see_shares", label: "Players see everyone's shares and payouts", hint: "" },
    {
      key: "players_edit_lists",
      label: "Players can add notes and change lists",
      hint: "Otherwise only managers can; players still see them.",
    },
  ];
</script>

{#if missing}
  <NotFound title="Gig not found" text="It may have been deleted, or you're not on it." />
{:else if !gig || !money}
  <PageHeader title="Gig" back="/gigs" backLabel="Gigs" />
  {#if q.error && isOfflineError(q.error)}<NotSaved />{:else}<Skeleton rows={6} />{/if}
{:else}
  <PageHeader title={gig.title} back="/gigs" backLabel="Gigs">
    {#snippet actions()}
      {#if addActions.length}
        <button class="more add" type="button" aria-label="Add" onclick={() => (addOpen = true)}
          ><Plus size={22} /></button
        >
      {/if}
      {#if manager}
        <Button onclick={() => (editOpen = true)} aria-label="Edit {noun}">
          {#snippet icon()}<Pencil />{/snippet}
          Edit
        </Button>
        <button class="more" type="button" aria-label="More actions" onclick={() => (moreOpen = true)}
          ><Ellipsis size={22} /></button
        >
      {/if}
    {/snippet}
  </PageHeader>

  <div class="page">
    <Card>
      <div class="hero">
        <div class="status">
          {#if rehearsalOnly}
            <Pill tone="violet">Rehearsal</Pill>
            {#if gig.status === "cancelled"}<Pill tone={statusTone(gig.status)}
                >{statusLabel(gig.status)}</Pill
              >{/if}
          {:else}
            <Pill tone={statusTone(gig.status)}>{statusLabel(gig.status)}</Pill>
          {/if}
          {#if meta.length}<span class="meta">{meta.join(" · ")}</span>{/if}
        </div>
        <ul class="facts">
          {#if when}
            <li>
              <CalendarClock size={18} />
              <span class="when"><span>{when.day}</span><span class="muted">{when.extra}</span></span>
            </li>
          {/if}
          {#if where}<li><MapPin size={18} /><span>{where}</span></li>{/if}
          {#if nextRehearsal && gig.status !== "cancelled"}
            <li>
              <Drum size={18} />
              <button class="fact-link" type="button" onclick={() => (tab = "details")}
                >Rehearsal {formatDateIST(nextRehearsal.start_at).replace(/ \d{4}$/, "")}, {timeRange(
                  nextRehearsal.start_at,
                  nextRehearsal.end_at,
                )}{nextRehearsal.my_going === true
                  ? " · you're going"
                  : nextRehearsal.my_going === false
                    ? " · you can't"
                    : " · are you coming?"}</button
              >
            </li>
          {/if}
          {#if gig.client}
            <li>
              <User size={18} />
              <span class="grow"
                >{gig.client.name}{#if gig.client.organisation}<span class="muted"
                    >&nbsp;· {gig.client.organisation}</span
                  >{/if}</span
              >
              {#if gig.client.phone}
                <a
                  class="call"
                  href="tel:{gig.client.phone.replace(/\s+/g, '')}"
                  aria-label="Call {gig.client.name}"><Phone size={18} /></a
                >
              {/if}
            </li>
          {/if}
          {#if rehearsalOnly}
            <!-- No money on a rehearsal that isn't for a gig. -->
          {:else if money.fee && money.received && gig.status !== "cancelled" && (money.fee.amount_paise > 0 || money.received.amount_paise !== 0)}
            <li>
              <Wallet size={18} />
              <button class="fact-link" type="button" onclick={() => (tab = "money")}
                >{money.received.amount_display} of {money.fee.amount_display} received</button
              >
            </li>
          {:else if !manager && money.mine.share.amount_paise > 0}
            <li>
              <Wallet size={18} />
              <button class="fact-link" type="button" onclick={() => (tab = "money")}
                >Your share {money.mine.share.amount_display}{money.mine.owed.amount_paise > 0
                  ? ` · ${money.mine.owed.amount_display} owed`
                  : " · paid"}</button
              >
            </li>
          {/if}
        </ul>
        {#if gig.status === "cancelled" && gig.cancel_reason}<p class="muted">
            Cancelled: {gig.cancel_reason}
          </p>{/if}
        {#if manager && gig.status === "cancelled"}
          <div>
            <Button variant="tinted" loading={busy === "reopen"} onclick={reopen}>
              {#snippet icon()}<Undo />{/snippet}
              Reopen gig
            </Button>
          </div>
        {/if}
        {#if nextStep}
          <div>
            <Button variant="tinted" loading={busy === nextStep} onclick={() => setStatus(nextStep)}>
              {#snippet icon()}<Check />{/snippet}
              {nextStep === "confirm" ? "Confirm gig" : "Mark as played"}
            </Button>
          </div>
        {/if}
      </div>
    </Card>

    <GigTogether {gig} />

    <Segmented
      label="Sections"
      bind:value={tab}
      options={[
        { value: "details" as const, label: fixedShows.length > 1 && !rehearsalOnly ? "Events" : "Details" },
        { value: "money" as const, label: "Money" },
        { value: "people" as const, label: "People" },
      ].filter((o) => TABS.includes(o.value))}
    />

    {#key tab}
      <div
        class="panel"
        use:swipeTabs={{ go: swipeTo, can: (d) => nextTab(TABS, tab, d) !== null }}
        in:fly={{ x: slide(dir), duration: 260, opacity: 0.4, easing: cubicOut }}
      >
        {#if tab === "details"}
          {#if holds.length && !rehearsalOnly}
            <ListGroup
              title="Date options"
              footer={gig.status === "enquiry"
                ? "Held until the client picks. Confirming the gig asks which date; the rest are released."
                : undefined}
            >
              {#snippet action()}
                {#if manager && gig.status === "enquiry"}<button
                    class="link"
                    onclick={() => openEvent(null, "show", true)}>Add</button
                  >{/if}
              {/snippet}
              {#each holds as e (e.id)}
                <ListRow
                  title={formatDateIST(e.start_at)}
                  subtitle={[timeRange(e.start_at, e.end_at), e.venue_name].filter(Boolean).join(" · ")}
                  onclick={manager && gig.status === "enquiry" ? () => openEvent(e) : undefined}
                >
                  {#snippet leading()}<GigDate
                      iso={e.start_at}
                      muted={gig.status === "cancelled"}
                    />{/snippet}
                  {#snippet trailing()}<Pill tone={HOLD_PILL.tone}>{HOLD_PILL.label}</Pill>{/snippet}
                </ListRow>
              {/each}
            </ListGroup>
          {/if}
          {#each rehearsalOnly ? [] : fixedShows as e, i (e.id)}
            {@const single = fixedShows.length === 1}
            <!-- One event: its time and place are in the summary above, so just the lineup here. -->
            <ListGroup title={single ? "Lineup" : (e.title ?? `Event ${i + 1}`)}>
              {#snippet action()}
                {#if manager && gig.status !== "cancelled"}<button class="link" onclick={() => openEvent(e)}
                    >{single ? "Edit time and place" : "Edit"}</button
                  >{/if}
              {/snippet}
              {#if single}
                {#if e.notes}<p class="notes-inline event">{e.notes}</p>{/if}
              {:else}
                <div class="event">
                  <ul class="facts">
                    <li>
                      <CalendarClock size={18} />
                      <span class="when"
                        ><span>{formatDateIST(e.start_at)}</span><span class="muted"
                          >{timeRange(e.start_at, e.end_at)}</span
                        ></span
                      >
                    </li>
                    {#if e.venue_name}
                      <li>
                        <MapPin size={18} /><span
                          >{e.venue_name}{e.venue_city ? `, ${e.venue_city}` : ""}</span
                        >
                      </li>
                    {/if}
                  </ul>
                  {#if e.notes}<p class="notes-inline">{e.notes}</p>{/if}
                </div>
              {/if}
              {#if e.lineup.length}
                {@const open = lineupOpenFor(e)}
                {@const each = lineupMoney(e)}
                <button
                  class="fold"
                  type="button"
                  aria-expanded={open}
                  onclick={() => (unfolded[e.id] = !open)}
                >
                  <span class="band" aria-hidden="true"><Users size={18} /></span>
                  <span class="grow"
                    >{e.lineup.length} playing{#if each}<span class="muted">&nbsp;· {each}</span>{/if}</span
                  >
                  <span class="chev" class:turned={open}><ChevronDown size={18} /></span>
                </button>
                {#if open}
                  {#each e.lineup as l (l.id)}
                    <ListRow title={l.is_me ? `${l.name} (you)` : l.name} subtitle={l.part ?? undefined}>
                      {#snippet leading()}<Avatar name={l.name} size={32} />{/snippet}
                      {#snippet trailing()}{#if l.share}<span class="amt num">{l.share.amount_display}</span
                          >{/if}{/snippet}
                    </ListRow>
                  {/each}
                  {#if manager && gig.status !== "cancelled"}
                    <div class="row-actions">
                      <Button size="sm" variant="tinted" onclick={() => openLineup(e)}>Change lineup</Button>
                    </div>
                  {/if}
                {/if}
              {:else}
                <ListRow
                  title="No lineup yet"
                  subtitle={gig.status === "cancelled"
                    ? "No lineup was set."
                    : manager
                      ? "Choose who plays and their shares."
                      : "The managers set who plays."}
                  onclick={manager && gig.status !== "cancelled" ? () => openLineup(e) : undefined}
                />
              {/if}
            </ListGroup>
          {/each}
          <GigRehearsals
            {gig}
            onsaved={set}
            onadd={() => openEvent(null, "rehearsal")}
            onedit={(e) => openEvent(e)}
          />
          {#if gig.notes}
            <ListGroup title="Notes"><p class="notes">{gig.notes}</p></ListGroup>
          {/if}
        {:else if tab === "money"}
          {@const waiting = waitingMoney(gig.id)}
          {#if waiting.length}
            <ListGroup title="Waiting to sync" footer="Saved on this device. Totals update once they sync.">
              {#each waiting as w (w.id)}
                <ListRow title={w.label.replace(/ · .*$/, "")} subtitle="Recorded offline" />
              {/each}
            </ListGroup>
          {/if}
          {#if money.fee && money.received && money.balance && money.payment_status}
            {@const cancelled = gig.status === "cancelled"}
            <ListGroup title="Client payments">
              <div class="summary">
                <div class="money-head">
                  <span class="muted">{cancelled ? "Gig cancelled" : "From the client"}</span>
                  {#if cancelled}<Pill>Cancelled</Pill>{:else}<Pill tone={paymentTone(money.payment_status)}
                      >{paymentLabel(money.payment_status)}</Pill
                    >{/if}
                </div>
                <div class="stats">
                  <Stat label="Fee" value={money.fee.amount_display} />
                  {#if cancelled && money.kept}
                    <Stat label="Kept" value={money.kept.amount_display} tone="green" />
                  {:else}
                    <Stat label="Received" value={money.received.amount_display} tone="green" />
                    <Stat
                      label={money.balance.amount_paise < 0 ? "Overpaid" : "Balance"}
                      value={money.balance.amount_display.replace("-", "")}
                      tone={money.balance.amount_paise > 0
                        ? "amber"
                        : money.balance.amount_paise < 0
                          ? "violet"
                          : undefined}
                    />
                  {/if}
                </div>
                {#if !cancelled}
                  <div
                    class="bar"
                    role="progressbar"
                    aria-label="Received"
                    aria-valuenow={Math.round(progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style:width="{progress}%"></span>
                  </div>
                {/if}
                {#if manager}
                  <Button variant={cancelled ? "secondary" : "primary"} full onclick={() => (payOpen = true)}>
                    {#snippet icon()}<Plus />{/snippet}
                    Record client payment
                  </Button>
                {/if}
              </div>
              {#each money.payments ?? [] as p (p.id)}
                <ListRow
                  title="{p.kind === 'refund' ? 'Refund' : methodLabel(p.method)} · {p.amount.amount_display}"
                  subtitle={[p.paid_on_display, p.kind === "refund" ? methodLabel(p.method) : null, p.note]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {#snippet trailing()}
                    {#if p.kind === "refund"}<Pill tone="amber">Refund</Pill>
                    {:else if p.reversed_by_id}<Pill>Reversed</Pill>
                    {:else if p.reverses_id}<Pill tone="violet">Correction</Pill>
                    {:else if manager}
                      <button
                        class="icon-btn"
                        aria-label="Reverse payment of {p.amount.amount_display}"
                        onclick={() => reverse("payment", p.id, `the ${p.amount.amount_display} payment`)}
                        ><Undo size={18} /></button
                      >
                    {/if}
                  {/snippet}
                </ListRow>
              {/each}
            </ListGroup>
          {/if}

          {#if !manager && (money.mine.share.amount_paise > 0 || money.mine.payouts.length)}
            <ListGroup title="Your share">
              <div class="summary">
                <div class="money-head">
                  <span class="muted">For playing this gig</span>
                  <Pill tone={paymentTone(money.mine.status)}>{payoutLabel(money.mine.status)}</Pill>
                </div>
                <div class="stats">
                  <Stat label="Share" value={money.mine.share.amount_display} />
                  <Stat label="Paid to you" value={money.mine.paid.amount_display} tone="green" />
                  <Stat
                    label="Still owed"
                    value={money.mine.owed.amount_display}
                    tone={money.mine.owed.amount_paise > 0 ? "amber" : undefined}
                  />
                </div>
              </div>
              {#each money.mine.payouts as x (x.id)}
                <ListRow
                  title="Paid · {x.amount.amount_display}"
                  subtitle="{x.paid_on_display} · {methodLabel(x.method)}"
                />
              {/each}
            </ListGroup>
          {/if}

          {#if money.payees}
            {@const payouts = money.payees.flatMap((p) => p.payouts.map((x) => ({ ...x, name: p.name })))}
            <ListGroup title="Shares and payouts" footer={manager ? "Tap someone to pay them." : undefined}>
              {#each money.payees as p (p.person_id)}
                <ListRow
                  title={p.is_me ? `${p.name} (you)` : p.name}
                  subtitle={p.paid.amount_paise
                    ? `Share ${p.share.amount_display} · paid ${p.paid.amount_display}`
                    : `Share ${p.share.amount_display}`}
                  onclick={manager ? () => openPayout(p) : undefined}
                >
                  {#snippet leading()}<Avatar name={p.name} size={32} />{/snippet}
                  {#snippet trailing()}
                    {#if p.owed.amount_paise > 0}<span class="owed num">{p.owed.amount_display} owed</span
                      >{:else}<Pill tone={paymentTone(p.status)}>{payoutLabel(p.status)}</Pill>{/if}
                  {/snippet}
                </ListRow>
              {:else}
                <ListRow
                  title="No shares yet"
                  subtitle="Set each event's lineup (Details) to share the fee."
                />
              {/each}
              {#if payouts.length}
                <p class="sub">Payments made</p>
                {#each payouts as p (p.id)}
                  <ListRow
                    title="{p.name} · {p.amount.amount_display}"
                    subtitle={[p.paid_on_display, methodLabel(p.method), p.note].filter(Boolean).join(" · ")}
                  >
                    {#snippet trailing()}
                      {#if p.reversed_by_id}<Pill>Reversed</Pill>
                      {:else if p.reverses_id}<Pill tone="violet">Correction</Pill>
                      {:else if manager}
                        <button
                          class="icon-btn"
                          aria-label="Reverse payout of {p.amount.amount_display} to {p.name}"
                          onclick={() =>
                            reverse("payout", p.id, `the ${p.amount.amount_display} payout to ${p.name}`)}
                          ><Undo size={18} /></button
                        >
                      {/if}
                    {/snippet}
                  </ListRow>
                {/each}
              {/if}
            </ListGroup>
          {/if}

          {#if money.expenses && money.net && money.shares_total && money.expenses_total}
            <ListGroup title="Expenses and net">
              {#snippet action()}<button class="link" onclick={() => (expenseOpen = true)}>Add expense</button
                >{/snippet}
              {#each money.expenses as x (x.id)}
                <ListRow
                  title="{x.category} · {x.amount.amount_display}"
                  subtitle={[x.spent_on_display, x.note].filter(Boolean).join(" · ")}
                >
                  {#snippet trailing()}
                    <button
                      class="icon-btn"
                      aria-label="Remove expense of {x.amount.amount_display}"
                      onclick={() => removeExpense(x.id, x.amount.amount_display)}><Trash size={18} /></button
                    >
                  {/snippet}
                </ListRow>
              {/each}
              <div class="summary totals">
                <div class="stats">
                  <Stat label="Shares" value={money.shares_total.amount_display} />
                  <Stat label="Expenses" value={money.expenses_total.amount_display} />
                  <Stat
                    label="Net"
                    value={money.net.amount_display}
                    tone={money.net.amount_paise < 0 ? "red" : "green"}
                    hint={gig.status === "cancelled" ? "Kept − shares − expenses" : "Fee − shares − expenses"}
                  />
                </div>
              </div>
            </ListGroup>
          {/if}
        {:else}
          <ListGroup title="People on this gig">
            {#snippet action()}
              {#if manager}<button class="link" onclick={() => openPerson(null)}>Add</button>{/if}
            {/snippet}
            {#each gig.people as p (p.id)}
              <ListRow
                title={p.is_me ? `${p.name} (you)` : p.name}
                subtitle={p.has_account ? undefined : "No account yet"}
                onclick={manager || p.is_me ? () => openPerson(p) : undefined}
              >
                {#snippet leading()}<Avatar name={p.name} size={32} />{/snippet}
                {#snippet trailing()}<Pill tone={p.role === "manager" ? "accent" : undefined}
                    >{p.role === "manager" ? "Manager" : "Player"}</Pill
                  >{/snippet}
              </ListRow>
            {/each}
          </ListGroup>

          {#if manager}
            <ListGroup
              title="What players see and do"
              footer="Managers always see everything. Players always see their own share."
            >
              {#each SETTINGS as s (s.key)}
                <label class="toggle">
                  <span class="toggle-text"
                    ><span>{s.label}</span>{#if s.hint}<span class="muted small">{s.hint}</span>{/if}</span
                  >
                  <input
                    type="checkbox"
                    role="switch"
                    checked={gig.settings[s.key]}
                    disabled={busy === s.key}
                    onchange={() => toggleSetting(s.key)}
                  />
                </label>
              {/each}
            </ListGroup>
          {/if}
        {/if}
      </div>
    {/key}
  </div>

  {#if rehearsalOnly}
    <RehearsalSheet bind:open={editOpen} {gig} onsaved={set} />
  {:else}
    <GigEditor bind:open={editOpen} {gig} onsaved={set} />
  {/if}
  <CancelSheet bind:open={cancelOpen} {gig} onsaved={set} />
  <PaymentSheet
    bind:open={payOpen}
    title="Record client payment"
    suggested={money.balance?.amount_paise}
    submitLabel="Save payment"
    onsubmit={async (v) => {
      q.set(await bookingsApi.recordPayment(gigId, v));
    }}
  />
  <PaymentSheet
    bind:open={payoutOpen}
    title="Pay {payoutFor?.name ?? ''}"
    suggested={payoutFor?.owed.amount_paise}
    submitLabel="Save payout"
    onsubmit={async (v) => {
      q.set(await bookingsApi.recordPayout(gigId, { ...v, person_id: payoutFor!.person_id }));
    }}
  />
  <ExpenseSheet bind:open={expenseOpen} {gig} onsaved={set} />
  <EventSheet
    bind:open={eventOpen}
    {gig}
    event={eventFor}
    kind={eventKind}
    hold={eventHold}
    onsaved={set}
    onremove={removeEvent}
  />
  <ActionSheet bind:open={moreOpen} title={gig.title} actions={moreActions} />
  <PickDateSheet bind:open={pickOpen} {gig} onsaved={set} />
  <ActionSheet bind:open={addOpen} title="Add to this {noun}" actions={addActions} />
  {#if lineupFor}<LineupSheet bind:open={lineupOpen} {gig} event={lineupFor} onsaved={set} />{/if}
  <PersonSheet bind:open={personOpen} {gig} person={personFor} onsaved={set} />
{/if}

<style>
  .page {
    overflow-x: clip;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    max-width: 760px;
  }
  .panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    min-height: 50vh;
    align-content: start;
  }
  .panel > :global(.btn) {
    justify-self: start;
  }
  .page > :global(.btn) {
    justify-self: start;
  }
  .summary {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  .summary.totals {
    border-top: 1px solid var(--separator);
  }
  .sub {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-1);
    border-top: 1px solid var(--separator);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .hero {
    display: grid;
    gap: var(--space-4);
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .meta {
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .facts li:has(.call),
  .facts li:has(.fact-link) {
    align-items: center;
  }
  .facts li:has(.call) :global(svg),
  .facts li:has(.fact-link) :global(svg) {
    margin-top: 0;
  }
  .call {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -10px -8px -10px 0;
    border-radius: var(--radius-full);
    color: var(--accent-text);
  }
  .facts .call :global(svg) {
    color: inherit;
  }
  .fact-link {
    padding: 0;
    min-height: 32px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--border);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .more {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
  }
  .more.add {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
  }
  .fold {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: var(--space-2) var(--space-4);
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fold:hover {
    background: var(--surface-hover);
  }
  .band {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .chev {
    display: inline-flex;
    color: var(--text-3);
    transition: transform 0.2s var(--ease);
  }
  .chev.turned {
    transform: rotate(180deg);
  }
  .facts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .facts li {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    color: var(--text);
  }
  .facts :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--text-3);
  }
  .event {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--separator);
  }
  .when {
    display: grid;
    gap: 2px;
  }
  .muted {
    color: var(--text-2);
  }
  .small {
    font-size: var(--text-sm);
  }
  .row-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .row-actions {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .money-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: var(--space-3);
  }
  .bar {
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--green);
    transition: width 0.3s ease;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin: -8px -10px -8px 0;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent-text);
    font-weight: 600;
    font-size: var(--text-sm);
    cursor: pointer;
    min-height: 44px;
    padding: 0 var(--space-2);
  }
  .amt {
    font-weight: 650;
    color: var(--text);
  }
  .owed {
    font-size: var(--text-xs);
    color: var(--text-2);
  }
  .notes,
  .notes-inline {
    margin: 0;
    white-space: pre-wrap;
    color: var(--text);
  }
  .notes {
    padding: var(--space-4);
  }
  .notes-inline {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 52px;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }
  .toggle + .toggle {
    border-top: 1px solid var(--separator);
  }
  .toggle-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .toggle input {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 50px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--grey-soft);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.2s;
  }
  .toggle input::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transition: transform 0.2s;
  }
  .toggle input:checked {
    background: var(--green);
    border-color: var(--green);
  }
  .toggle input:checked::after {
    transform: translateX(20px);
  }
</style>
