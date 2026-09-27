<script lang="ts">
  import type { MyHomeView, MyWorkspaceMoney } from "@assistant/shared";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import UserPlus from "@lucide/svelte/icons/user-plus";
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
    toast,
  } from "../../../core/ui/index.ts";
  import { session } from "../../../core/session.svelte.ts";
  import { gigsApi, meApi } from "../api.ts";
  import GigDate from "../GigDate.svelte";
  import { statusLabel, statusTone } from "../status.ts";
  import { time12 } from "../time.ts";

  // Home is about me, across every collective and my personal space (decision 2026-09-27).
  let data = $state<MyHomeView | null>(null);
  let error = $state("");
  let adding = $state("");

  async function load() {
    try {
      data = await meApi.home();
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  void load();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = $derived(session.me?.user.name.split(" ")[0] ?? "");
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });
  const personalId = $derived(session.me?.workspaces.find((w) => w.kind === "personal")?.id);

  const countLabel = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const wsName = (w: MyWorkspaceMoney["workspace"]) => (w.kind === "personal" ? "Your own gigs" : w.name);
  const owedSubtitle = (w: MyWorkspaceMoney) =>
    w.workspace.kind === "personal"
      ? `Clients · ${countLabel(w.count, "gig", "gigs")}`
      : countLabel(w.count, "gig", "gigs");

  async function addMe(wsId: string) {
    if (!session.me) return;
    adding = wsId;
    try {
      await gigsApi(wsId).createMusician({ name: session.me.user.name, user_id: session.me.user.id });
      toast.success("You're on the roster");
      await load();
    } catch (e) {
      toast.error(e);
    } finally {
      adding = "";
    }
  }
</script>

<PageHeader title="{greeting}, {firstName}" subtitle={today} />

{#if error}
  <ListGroup><ListRow title="Couldn't load your home" subtitle={error} /></ListGroup>
{:else if !data}
  <Skeleton rows={5} />
{:else}
  <div class="layout">
    <div class="col">
      <Card>
        <div class="month">
          <span class="eyebrow">{data.this_month.label}</span>
          <div class="stats">
            <Stat label="Earned" value={data.this_month.earned.amount_display} />
            <Stat label="Received" value={data.this_month.received.amount_display} tone="green" />
            <Stat label="Gigs played" value={String(data.this_month.gigs)} />
          </div>
        </div>
      </Card>

      <ListGroup title="Owed to you">
        {#snippet action()}
          <span class="total num" class:amber={data!.owed_to_me.total.amount_paise > 0}
            >{data!.owed_to_me.total.amount_display}</span
          >
        {/snippet}
        {#each data.owed_to_me.by_workspace as w (w.workspace.id)}
          <ListRow href="/w/{w.workspace.id}/gigs" title={wsName(w.workspace)} subtitle={owedSubtitle(w)}>
            {#snippet leading()}<Avatar name={wsName(w.workspace)} size={36} square />{/snippet}
            {#snippet trailing()}<span class="amt num">{w.amount.amount_display}</span>{/snippet}
          </ListRow>
        {:else}
          <ListRow title="All settled" subtitle="Nobody owes you for gigs you've played." />
        {/each}
      </ListGroup>

      {#if data.i_owe.by_workspace.length}
        <ListGroup title="You owe musicians" footer="Shares for played gigs in collectives you run.">
          {#snippet action()}
            <span class="total num">{data!.i_owe.total.amount_display}</span>
          {/snippet}
          {#each data.i_owe.by_workspace as w (w.workspace.id)}
            <ListRow
              href="/w/{w.workspace.id}/gigs"
              title={w.workspace.name}
              subtitle={countLabel(w.count, "person", "people")}
            >
              {#snippet leading()}<Avatar name={w.workspace.name} size={36} square />{/snippet}
              {#snippet trailing()}<span class="amt num">{w.amount.amount_display}</span>{/snippet}
            </ListRow>
          {/each}
        </ListGroup>
      {/if}

      {#each data.not_on_roster as w (w.id)}
        <Card>
          <div class="notice">
            <span class="notice-icon"><UserPlus size={20} /></span>
            <div class="notice-text">
              <strong>You're not on {w.name}'s roster</strong>
              <span
                >{w.can_fix
                  ? "Add yourself so your shares show up here."
                  : "Ask the owner to add you to the roster so your shares show up here."}</span
              >
            </div>
            {#if w.can_fix}
              <Button size="sm" variant="tinted" loading={adding === w.id} onclick={() => addMe(w.id)}
                >Add me</Button
              >
            {/if}
          </div>
        </Card>
      {/each}
    </div>

    <div class="col">
      <ListGroup title="Coming up">
        {#each data.upcoming as u (u.gig.id)}
          <ListRow
            href="/w/{u.workspace.id}/gigs/{u.gig.id}"
            title={u.gig.title}
            subtitle={[
              time12(u.gig.start_at),
              u.workspace.kind === "personal" ? null : u.workspace.name,
              u.my_role,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {#snippet leading()}<GigDate iso={u.gig.start_at} />{/snippet}
            {#snippet trailing()}
              <span class="right">
                {#if u.my_amount}<span class="amt num">{u.my_amount.amount_display}</span>{/if}
                {#if u.involvement === "lineup_not_set"}
                  <Pill>Lineup not set</Pill>
                {:else}
                  <Pill tone={statusTone(u.gig.status)}>{statusLabel(u.gig.status)}</Pill>
                {/if}
              </span>
            {/snippet}
          </ListRow>
        {:else}
          <EmptyState
            title="Nothing coming up"
            text="Gigs you play in any collective, and your own, show up here."
          >
            {#snippet icon()}<CalendarPlus size={26} />{/snippet}
            {#snippet action()}
              {#if personalId}<Button variant="tinted" href="/w/{personalId}/gigs">Add a gig</Button>{/if}
            {/snippet}
          </EmptyState>
        {/each}
      </ListGroup>
    </div>
  </div>
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
  }
  @media (min-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      align-items: start;
    }
  }
  .month {
    display: grid;
    gap: var(--space-3);
  }
  .eyebrow {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: var(--space-3);
  }
  .total {
    font-weight: 700;
    color: var(--text);
  }
  .total.amber {
    color: var(--amber);
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
  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .notice-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .notice-text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .notice-text strong {
    color: var(--text);
    font-size: var(--text-md);
  }
</style>
