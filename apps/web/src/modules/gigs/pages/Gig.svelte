<script lang="ts">
  import type { GigMoneyView, GigView, LineupEntryView, WorkspaceDetail } from "@assistant/shared";
  import { formatDateIST } from "@assistant/shared";
  import CalendarClock from "@lucide/svelte/icons/calendar-clock";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import User from "@lucide/svelte/icons/user";
  import Plus from "@lucide/svelte/icons/plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Check from "@lucide/svelte/icons/check";
  import Ban from "@lucide/svelte/icons/ban";
  import Trash from "@lucide/svelte/icons/trash-2";
  import Undo from "@lucide/svelte/icons/undo-2";
  import Users from "@lucide/svelte/icons/users";
  import {
    Avatar,
    Button,
    Card,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Skeleton,
    Stat,
    confirm,
    toast,
  } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import NotFound from "../../../core/pages/NotFound.svelte";
  import { ApiError } from "../../../core/api.ts";
  import { gigsApi } from "../api.ts";
  import ExpenseSheet from "../ExpenseSheet.svelte";
  import GigForm from "../GigForm.svelte";
  import LineupSheet from "../LineupSheet.svelte";
  import PaymentSheet from "../PaymentSheet.svelte";
  import { methodLabel } from "../options.ts";
  import { paymentLabel, paymentTone, statusLabel, statusTone } from "../status.ts";
  import { timeRange } from "../time.ts";

  let { workspace, gigId }: { workspace: WorkspaceDetail; gigId: string } = $props();
  const api = $derived(gigsApi(workspace.id));
  const back = $derived(`/w/${workspace.id}/gigs`);

  let gig = $state<GigView | null>(null);
  let money = $state<GigMoneyView | null>(null);
  let missing = $state(false);
  let busy = $state("");

  let editOpen = $state(false);
  let payOpen = $state(false);
  let expenseOpen = $state(false);
  let lineupOpen = $state(false);
  let payoutFor = $state<LineupEntryView | null>(null);
  let payoutOpen = $state(false);

  async function load() {
    try {
      [gig, money] = await Promise.all([api.getGig(gigId), api.money(gigId)]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing = true;
      else toast.error(e);
    }
  }
  const refreshMoney = async () => (money = await api.money(gigId));

  $effect(() => {
    gig = null;
    money = null;
    missing = false;
    void load();
  });

  const full = $derived(money?.visibility === "full");
  const progress = $derived(
    money && money.fee.amount_paise > 0
      ? Math.min(100, Math.max(0, (money.received.amount_paise / money.fee.amount_paise) * 100))
      : 0,
  );
  const mine = $derived(money?.lineup.find((l) => l.musician.is_me) ?? null);
  const livePayments = $derived(money?.payments ?? []);

  async function act(name: string, fn: () => Promise<unknown>, done: string) {
    busy = name;
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e);
    } finally {
      busy = "";
    }
  }

  async function cancelGig() {
    if (!gig) return;
    const ok = await confirm({
      title: "Cancel this gig?",
      message: "It stays in your history as cancelled. Payments already recorded are kept.",
      confirmLabel: "Cancel gig",
      destructive: true,
    });
    if (ok) await act("cancel", () => api.cancelGig(gig!.id), "Gig cancelled");
  }

  async function deleteGig() {
    if (!gig) return;
    const ok = await confirm({
      title: "Delete this gig?",
      message: "It disappears from lists and reports. Use Cancel instead if it just isn't happening.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteGig(gig.id);
      toast.success("Gig deleted");
      navigate(back);
    } catch (e) {
      toast.error(e);
    }
  }

  async function reversePayment(id: string, amount: string) {
    const ok = await confirm({
      title: `Reverse the ${amount} payment?`,
      message: "A correcting entry is added so the history stays complete.",
      confirmLabel: "Reverse",
      destructive: true,
    });
    if (ok) await act("rev", () => api.reversePayment(id), "Payment reversed");
  }

  async function reversePayout(id: string, amount: string, name: string) {
    const ok = await confirm({
      title: `Reverse the ${amount} payout to ${name}?`,
      message: "A correcting entry is added so the history stays complete.",
      confirmLabel: "Reverse",
      destructive: true,
    });
    if (ok) await act("rev", () => api.reversePayout(id), "Payout reversed");
  }

  async function deleteExpense(id: string, amount: string) {
    const ok = await confirm({
      title: `Delete the ${amount} expense?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) await act("exp", () => api.deleteExpense(id), "Expense deleted");
  }

  function openPayout(l: LineupEntryView) {
    payoutFor = l;
    payoutOpen = true;
  }
</script>

{#if missing}
  <NotFound title="Gig not found" text="It may have been deleted." />
{:else if !gig || !money}
  <PageHeader title="Gig" {back} backLabel="Gigs" />
  <Skeleton rows={6} />
{:else}
  <PageHeader title={gig.title} {back} backLabel="Gigs">
    {#snippet actions()}
      <Button onclick={() => (editOpen = true)} aria-label="Edit gig">
        {#snippet icon()}<Pencil />{/snippet}
        Edit
      </Button>
    {/snippet}
  </PageHeader>

  <div class="layout">
    <div class="col">
      <Card>
        <div class="hero">
          <div class="pills">
            <Pill tone={statusTone(gig.status)}>{statusLabel(gig.status)}</Pill>
            {#if gig.event_type}<Pill>{gig.event_type[0]!.toUpperCase() + gig.event_type.slice(1)}</Pill>{/if}
          </div>
          <ul class="facts">
            <li>
              <CalendarClock size={18} />
              <span class="when"
                ><span>{formatDateIST(gig.start_at)}</span><span class="muted"
                  >{timeRange(gig.start_at, gig.end_at)}</span
                ></span
              >
            </li>
            {#if gig.venue}
              <li>
                <MapPin size={18} /><span>{gig.venue.name}{gig.venue.city ? `, ${gig.venue.city}` : ""}</span>
              </li>
            {/if}
            {#if gig.client}
              <li><User size={18} /><span>{gig.client.name}</span></li>
            {/if}
          </ul>
          {#if gig.status === "enquiry" || gig.status === "confirmed"}
            <div class="actions">
              {#if gig.status === "enquiry"}
                <Button
                  variant="tinted"
                  loading={busy === "confirm"}
                  onclick={() => act("confirm", () => api.setStatus(gig!.id, "confirm"), "Gig confirmed")}
                >
                  {#snippet icon()}<Check />{/snippet}
                  Confirm
                </Button>
              {:else}
                <Button
                  variant="tinted"
                  loading={busy === "complete"}
                  onclick={() =>
                    act("complete", () => api.setStatus(gig!.id, "complete"), "Marked as played")}
                >
                  {#snippet icon()}<Check />{/snippet}
                  Mark played
                </Button>
              {/if}
              <Button variant="ghost" loading={busy === "cancel"} onclick={cancelGig}>
                {#snippet icon()}<Ban />{/snippet}
                Cancel gig
              </Button>
            </div>
          {/if}
        </div>
      </Card>

      <Card>
        <div class="money">
          <div class="money-head">
            <h2>Payment</h2>
            <Pill tone={paymentTone(money.payment_status)}>{paymentLabel(money.payment_status)}</Pill>
          </div>
          <div class="stats">
            <Stat label="Fee" value={money.fee.amount_display} />
            <Stat label="Received" value={money.received.amount_display} tone="green" />
            <Stat
              label={money.balance.amount_paise < 0 ? "Overpaid" : "Balance"}
              value={money.balance.amount_paise < 0
                ? money.balance.amount_display.replace("-", "")
                : money.balance.amount_display}
              tone={money.balance.amount_paise > 0
                ? "amber"
                : money.balance.amount_paise < 0
                  ? "violet"
                  : undefined}
            />
          </div>
          <div
            class="bar"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style:width="{progress}%"></span>
          </div>
          {#if gig.status !== "cancelled" || money.received.amount_paise > 0}
            <Button variant="primary" full onclick={() => (payOpen = true)}>
              {#snippet icon()}<Plus />{/snippet}
              Record payment
            </Button>
          {/if}
        </div>
      </Card>

      {#if livePayments.length}
        <ListGroup title="Payments">
          {#each livePayments as p (p.id)}
            {@const reversed = !!p.reversed_by_payment_id}
            {@const correction = !!p.reverses_payment_id}
            <ListRow
              title="{p.amount.amount_display} · {methodLabel(p.method)}"
              subtitle={[p.paid_on_display, p.note].filter(Boolean).join(" · ")}
            >
              {#snippet trailing()}
                {#if reversed}<Pill>Reversed</Pill>
                {:else if correction}<Pill tone="violet">Correction</Pill>
                {:else}
                  <button
                    class="icon-btn"
                    aria-label="Reverse payment of {p.amount.amount_display}"
                    onclick={() => reversePayment(p.id, p.amount.amount_display)}><Undo size={18} /></button
                  >
                {/if}
              {/snippet}
            </ListRow>
          {/each}
        </ListGroup>
      {/if}

      {#if gig.notes}
        <ListGroup title="Notes">
          <p class="notes">{gig.notes}</p>
        </ListGroup>
      {/if}
    </div>

    <div class="col">
      {#if full}
        <ListGroup title="Lineup">
          {#snippet action()}
            <button class="link" onclick={() => (lineupOpen = true)}
              >{money!.lineup.length ? "Edit" : "Set lineup"}</button
            >
          {/snippet}
          {#if money.lineup.length === 0}
            <EmptyState title="No lineup yet" text="Choose who plays and each person's share of the fee.">
              {#snippet icon()}<Users size={26} />{/snippet}
              {#snippet action()}<Button variant="tinted" onclick={() => (lineupOpen = true)}
                  >Set lineup</Button
                >{/snippet}
            </EmptyState>
          {:else}
            {#each money.lineup as l (l.id)}
              <ListRow
                title={l.musician.name}
                subtitle="{l.role ?? l.musician.instrument ?? 'Share'} · {l.share.amount_display}"
                onclick={() => openPayout(l)}
              >
                {#snippet leading()}<Avatar name={l.musician.name} size={36} />{/snippet}
                {#snippet trailing()}
                  <span class="right">
                    <Pill tone={paymentTone(l.payout_status)}
                      >{l.payout_status === "paid"
                        ? "Paid out"
                        : l.payout_status === "unpaid"
                          ? "Owed"
                          : paymentLabel(l.payout_status)}</Pill
                    >
                    {#if l.owed.amount_paise > 0}<span class="owed num">{l.owed.amount_display} owed</span
                      >{/if}
                  </span>
                {/snippet}
              </ListRow>
            {/each}
          {/if}
        </ListGroup>

        {@const payouts = money.lineup.flatMap((l) => l.payouts)}
        {#if payouts.length}
          <ListGroup title="Payouts">
            {#each payouts as p (p.id)}
              <ListRow
                title="{p.musician.name} · {p.amount.amount_display}"
                subtitle={[p.paid_on_display, methodLabel(p.method), p.note].filter(Boolean).join(" · ")}
              >
                {#snippet trailing()}
                  {#if p.reversed_by_payout_id}<Pill>Reversed</Pill>
                  {:else if p.reverses_payout_id}<Pill tone="violet">Correction</Pill>
                  {:else}
                    <button
                      class="icon-btn"
                      aria-label="Reverse payout of {p.amount.amount_display} to {p.musician.name}"
                      onclick={() => reversePayout(p.id, p.amount.amount_display, p.musician.name)}
                      ><Undo size={18} /></button
                    >
                  {/if}
                {/snippet}
              </ListRow>
            {/each}
          </ListGroup>
        {/if}

        <ListGroup title="Expenses">
          {#snippet action()}
            <button class="link" onclick={() => (expenseOpen = true)}>Add</button>
          {/snippet}
          {#if !money.expenses?.length}
            <ListRow
              title="No expenses"
              subtitle="Travel, food, sound hire… anything the collective paid for this gig."
            />
          {:else}
            {#each money.expenses as x (x.id)}
              <ListRow
                title="{x.category[0]!.toUpperCase() + x.category.slice(1)} · {x.amount.amount_display}"
                subtitle={[x.spent_on_display, x.note].filter(Boolean).join(" · ")}
              >
                {#snippet trailing()}
                  <button
                    class="icon-btn"
                    aria-label="Delete {x.category} expense of {x.amount.amount_display}"
                    onclick={() => deleteExpense(x.id, x.amount.amount_display)}><Trash size={18} /></button
                  >
                {/snippet}
              </ListRow>
            {/each}
          {/if}
        </ListGroup>

        <Card>
          <div class="stats">
            <Stat label="Shares" value={money.shares_total?.amount_display ?? "₹0"} />
            <Stat label="Expenses" value={money.expenses_total?.amount_display ?? "₹0"} />
            <Stat
              label="Collective keeps"
              value={money.net?.amount_display ?? "₹0"}
              tone={(money.net?.amount_paise ?? 0) < 0 ? "red" : "green"}
              hint="Fee − shares − expenses"
            />
          </div>
        </Card>
      {:else if mine}
        <Card>
          <div class="money">
            <div class="money-head">
              <h2>Your share</h2>
              <Pill tone={paymentTone(mine.payout_status)}
                >{mine.payout_status === "paid" ? "Paid out" : "Owed"}</Pill
              >
            </div>
            <div class="stats">
              <Stat label="Share" value={mine.share.amount_display} />
              <Stat label="Paid to you" value={mine.paid.amount_display} tone="green" />
              <Stat
                label="Still owed"
                value={mine.owed.amount_display}
                tone={mine.owed.amount_paise > 0 ? "amber" : undefined}
              />
            </div>
          </div>
        </Card>
      {:else}
        <ListGroup title="Lineup">
          <ListRow
            title="You're not in the lineup"
            subtitle="The collective's owner sets who plays and the shares."
          />
        </ListGroup>
      {/if}

      {#if money.payments.length === 0}
        <div class="danger">
          <Button variant="ghost" onclick={deleteGig}>
            {#snippet icon()}<Trash />{/snippet}
            Delete gig
          </Button>
        </div>
      {/if}
    </div>
  </div>

  <GigForm bind:open={editOpen} workspaceId={workspace.id} {gig} onsaved={() => load()} />
  <PaymentSheet
    bind:open={payOpen}
    title="Record payment"
    amountLabel="Amount received"
    suggested={money.balance.amount_paise}
    submitLabel="Record payment"
    onsubmit={async (v) => {
      await api.recordPayment(gigId, v);
      toast.success("Payment recorded");
      await refreshMoney();
    }}
  />
  <PaymentSheet
    bind:open={payoutOpen}
    title={payoutFor ? `Pay ${payoutFor.musician.name}` : "Payout"}
    amountLabel="Amount paid"
    suggested={payoutFor?.owed.amount_paise}
    submitLabel="Record payout"
    onsubmit={async (v) => {
      await api.recordPayout(gigId, { ...v, musician_id: payoutFor!.musician.id });
      toast.success("Payout recorded");
      await refreshMoney();
    }}
  />
  <ExpenseSheet
    bind:open={expenseOpen}
    onsubmit={async (v) => {
      await api.recordExpense({ ...v, gig_id: gigId });
      toast.success("Expense added");
      await refreshMoney();
    }}
  />
  {#if full}
    <LineupSheet bind:open={lineupOpen} workspaceId={workspace.id} {money} onsaved={(m) => (money = m)} />
  {/if}
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }
  .col {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    align-content: start;
    min-width: 0;
  }
  @media (min-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      align-items: start;
    }
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
  .when {
    display: grid;
    gap: 2px;
  }
  .muted {
    color: var(--text-2);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .money {
    display: grid;
    gap: var(--space-4);
  }
  .money-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
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
    min-height: 32px;
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
  .notes {
    margin: 0;
    padding: var(--space-4);
    white-space: pre-wrap;
    color: var(--text);
  }
  .danger {
    display: flex;
    justify-content: center;
  }
  .danger :global(.btn) {
    color: var(--red);
  }
</style>
