<script lang="ts">
  import type {
    BookingEventView,
    BookingPersonView,
    BookingView,
    GigSettings,
    PayeeView,
    PaymentStatus,
  } from "@assistant/shared";
  import { formatDateIST } from "@assistant/shared";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import User from "@lucide/svelte/icons/user";
  import Plus from "@lucide/svelte/icons/plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Check from "@lucide/svelte/icons/check";
  import Ban from "@lucide/svelte/icons/ban";
  import Undo from "@lucide/svelte/icons/undo-2";
  import Trash from "@lucide/svelte/icons/trash-2";
  import {
    Avatar,
    Button,
    Card,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Segmented,
    Skeleton,
    Stat,
    confirm,
    toast,
  } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import NotFound from "../../../core/pages/NotFound.svelte";
  import { ApiError } from "../../../core/api.ts";
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

  // One gig: always exact (read from the gig itself), showing only what I may see.
  let { gigId }: { gigId: string } = $props();

  // Shows the last known gig at once, then refreshes from the gig itself.
  const q = createQuery<BookingView>(
    () => `gig:${gigId}`,
    () => bookingsApi.get(gigId),
  );
  const gig = $derived(q.data ?? null);
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
  let lineupOpen = $state(false);
  let lineupFor = $state<BookingEventView | null>(null);
  let personOpen = $state(false);
  let personFor = $state<BookingPersonView | null>(null);
  let payoutOpen = $state(false);
  let payoutFor = $state<PayeeView | null>(null);
  let cancelOpen = $state(false);

  // Three tabs keep the page short: what and when, the money, and who's on it.
  type Tab = "details" | "money" | "people";
  let tab = $state<Tab>("details");

  const set = (g: BookingView) => q.set(g);
  const manager = $derived(gig?.my_role === "manager");
  const money = $derived(gig?.money);
  const progress = $derived(
    money?.fee && money.received && money.fee.amount_paise > 0
      ? Math.min(100, Math.max(0, (money.received.amount_paise / money.fee.amount_paise) * 100))
      : 0,
  );
  const live = $derived(gig ? gig.status === "enquiry" || gig.status === "confirmed" : false);

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

  async function deleteGig() {
    const ok = await confirm({
      title: "Delete this gig?",
      message: "It disappears for everyone on it. Use Cancel instead if it just isn't happening.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await bookingsApi.remove(gigId);
      toast.success("Gig deleted");
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
      title: `Remove ${e.title ?? "this event"}?`,
      message: "Its lineup goes too. Payouts already recorded are kept.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) await act("event", () => bookingsApi.removeEvent(gigId, e.id), "Event removed");
  }

  async function toggleSetting(key: keyof GigSettings) {
    if (!gig) return;
    await act(
      key,
      () => bookingsApi.update(gigId, gig!.version, { settings: { [key]: !gig!.settings[key] } }),
      "Saved",
    );
  }

  const openEvent = (e: BookingEventView | null) => ((eventFor = e), (eventOpen = true));
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
  ];
</script>

{#if missing}
  <NotFound title="Gig not found" text="It may have been deleted, or you're not on it." />
{:else if !gig || !money}
  <PageHeader title="Gig" back="/gigs" backLabel="Gigs" />
  <Skeleton rows={6} />
{:else}
  <PageHeader title={gig.title} back="/gigs" backLabel="Gigs">
    {#snippet actions()}
      {#if manager}
        <Button onclick={() => (editOpen = true)} aria-label="Edit gig">
          {#snippet icon()}<Pencil />{/snippet}
          Edit
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="page">
    <Card>
      <div class="hero">
        <div class="pills">
          <Pill tone={statusTone(gig.status)}>{statusLabel(gig.status)}</Pill>
          {#if gig.event_type}<Pill>{gig.event_type[0]!.toUpperCase() + gig.event_type.slice(1)}</Pill>{/if}
          {#if gig.collective}<Pill tone="violet">{gig.collective.name}</Pill>{/if}
          {#each gig.tags as t (t.id)}<Pill tone="blue">{t.name}</Pill>{/each}
          <Pill>{manager ? "You manage this" : "You're playing"}</Pill>
        </div>
        {#if gig.client}
          <p class="client">
            <User size={18} /><span
              >{gig.client.name}{#if gig.client.phone}<span class="muted">
                  · {gig.client.phone}</span
                >{/if}</span
            >
          </p>
        {/if}
        {#if gig.status === "cancelled" && gig.cancel_reason}<p class="muted">
            Cancelled: {gig.cancel_reason}
          </p>{/if}
        {#if manager && live}
          <div class="actions">
            {#if gig.status === "enquiry"}
              <Button
                variant="tinted"
                loading={busy === "confirm"}
                onclick={() => act("confirm", () => bookingsApi.setStatus(gigId, "confirm"), "Gig confirmed")}
              >
                {#snippet icon()}<Check />{/snippet}
                Confirm
              </Button>
            {:else}
              <Button
                variant="tinted"
                loading={busy === "complete"}
                onclick={() =>
                  act("complete", () => bookingsApi.setStatus(gigId, "complete"), "Marked as played")}
              >
                {#snippet icon()}<Check />{/snippet}
                Mark played
              </Button>
            {/if}
            <Button variant="ghost" onclick={() => (cancelOpen = true)}>
              {#snippet icon()}<Ban />{/snippet}
              Cancel gig
            </Button>
          </div>
        {/if}
      </div>
    </Card>

    <Segmented
      label="Sections"
      bind:value={tab}
      options={[
        { value: "details", label: gig.events.length > 1 ? `Events (${gig.events.length})` : "Details" },
        { value: "money", label: "Money" },
        { value: "people", label: `People (${gig.people.length})` },
      ]}
    />

    {#if tab === "details"}
      {#each gig.events as e, i (e.id)}
        <ListGroup title={e.title ?? (gig.events.length > 1 ? `Event ${i + 1}` : "When and where")}>
          {#snippet action()}
            {#if manager}<button class="link" onclick={() => openEvent(e)}>Edit</button>{/if}
          {/snippet}
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
                  <MapPin size={18} /><span>{e.venue_name}{e.venue_city ? `, ${e.venue_city}` : ""}</span>
                </li>
              {/if}
            </ul>
            {#if e.notes}<p class="notes-inline">{e.notes}</p>{/if}
          </div>
          {#each e.lineup as l (l.id)}
            <ListRow title={l.is_me ? `${l.name} (you)` : l.name} subtitle={l.part ?? undefined}>
              {#snippet leading()}<Avatar name={l.name} size={32} />{/snippet}
              {#snippet trailing()}{#if l.share}<span class="amt num">{l.share.amount_display}</span
                  >{/if}{/snippet}
            </ListRow>
          {:else}
            <ListRow
              title="No lineup yet"
              subtitle={manager ? "Choose who plays and their shares." : "The managers set who plays."}
            />
          {/each}
          {#if manager}
            <div class="row-actions">
              <Button size="sm" variant="tinted" onclick={() => openLineup(e)}
                >{e.lineup.length ? "Change lineup" : "Set lineup"}</Button
              >
              {#if gig.events.length > 1}
                <Button size="sm" variant="ghost" onclick={() => removeEvent(e)}>Remove event</Button>
              {/if}
            </div>
          {/if}
        </ListGroup>
      {/each}
      {#if manager}
        <Button variant="ghost" onclick={() => openEvent(null)}>
          {#snippet icon()}<Plus />{/snippet}
          Add an event (e.g. Reception)
        </Button>
      {/if}
      {#if gig.notes}
        <ListGroup title="Notes"><p class="notes">{gig.notes}</p></ListGroup>
      {/if}
    {:else if tab === "money"}
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
              subtitle="Share {p.share.amount_display} · paid {p.paid.amount_display}"
              onclick={manager ? () => openPayout(p) : undefined}
            >
              {#snippet leading()}<Avatar name={p.name} size={32} />{/snippet}
              {#snippet trailing()}
                <span class="right">
                  <Pill tone={paymentTone(p.status)}>{payoutLabel(p.status)}</Pill>
                  {#if p.owed.amount_paise > 0}<span class="owed num">{p.owed.amount_display} owed</span>{/if}
                </span>
              {/snippet}
            </ListRow>
          {:else}
            <ListRow title="No shares yet" subtitle="Set each event's lineup (Details) to share the fee." />
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
          title="What players see"
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
        <div class="danger">
          <Button variant="ghost" onclick={deleteGig}>
            {#snippet icon()}<Trash />{/snippet}
            Delete gig
          </Button>
        </div>
      {/if}
    {/if}
  </div>

  <GigEditor bind:open={editOpen} {gig} onsaved={set} />
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
  <EventSheet bind:open={eventOpen} {gig} event={eventFor} onsaved={set} />
  {#if lineupFor}<LineupSheet bind:open={lineupOpen} {gig} event={lineupFor} onsaved={set} />{/if}
  <PersonSheet bind:open={personOpen} {gig} person={personFor} onsaved={set} />
{/if}

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    max-width: 760px;
  }
  .page > :global(.btn) {
    justify-self: start;
  }
  .client {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin: 0;
  }
  .client :global(svg) {
    color: var(--text-3);
    flex-shrink: 0;
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
  .pills {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
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
  .actions,
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
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
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
  .danger {
    display: flex;
    justify-content: center;
  }
  .danger :global(.btn) {
    color: var(--red);
  }
</style>
