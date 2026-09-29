<script lang="ts">
  import type { GigAmount, HomeView, NotificationsView } from "@assistant/shared";
  import Bell from "@lucide/svelte/icons/bell";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import Plus from "@lucide/svelte/icons/plus";
  import {
    Button,
    Card,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    NotSaved,
    Skeleton,
    Stat,
  } from "../../../core/ui/index.ts";
  import { session } from "../../../core/session.svelte.ts";
  import { createQuery } from "../../../core/query.svelte.ts";
  import { isOfflineError } from "../../../core/offline.svelte.ts";
  import { errorText, notificationsApi } from "../../../core/api.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import GigDate from "../GigDate.svelte";
  import GigEditor from "./GigEditor.svelte";
  import { statusLabel, statusTone } from "../status.ts";
  import { time12 } from "../time.ts";

  // Home: only my things (docs/design/gig-centric.md §2). Built from my own summaries,
  // so it can lag a few seconds behind a change.
  // Shows the last known Home at once, then refreshes in the background.
  const home = createQuery<HomeView>(
    () => "home",
    () => bookingsApi.home(),
  );
  const data = $derived(home.data);
  // What's new since I last looked (added to a gig, changes, payments).
  const news = createQuery<NotificationsView>(
    () => "notifications",
    () => notificationsApi.list(),
  );
  const unread = $derived((news.data?.items ?? []).filter((n) => !n.read_at).slice(0, 5));
  async function markRead() {
    try {
      await notificationsApi.markAllRead();
      news.refresh();
    } catch {
      // Harmless: they stay unread.
    }
  }
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  };
  const error = $derived(!home.data && home.error ? errorText(home.error) : "");
  let creating = $state(false);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = $derived(session.me?.user.name.split(" ")[0] ?? "");
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });
  const sub = (g: GigAmount) => [g.first_start_display, g.client_name].filter(Boolean).join(" · ");
</script>

<PageHeader title="{greeting}, {firstName}" subtitle={today}>
  {#snippet actions()}
    <Button variant="primary" onclick={() => (creating = true)}>
      {#snippet icon()}<Plus />{/snippet}
      New gig
    </Button>
  {/snippet}
</PageHeader>

{#if error && isOfflineError(home.error)}
  <NotSaved />
{:else if error}
  <ListGroup><ListRow title="Couldn't load your home" subtitle={error} /></ListGroup>
{:else if !data}
  <Skeleton rows={5} />
{:else}
  <div class="layout">
    <div class="col">
      {#if unread.length}
        <div class="news">
          <ListGroup title="New for you">
            {#each unread as n (n.id)}
              <ListRow
                title={n.title}
                subtitle={[n.body, ago(n.at)].filter(Boolean).join(" · ")}
                href={n.url ?? undefined}
              >
                {#snippet leading()}<span class="bell"><Bell size={16} /></span>{/snippet}
              </ListRow>
            {/each}
          </ListGroup>
          <Button size="sm" variant="ghost" onclick={markRead}>Mark all read</Button>
        </div>
      {/if}
      <Card>
        <div class="month">
          <span class="eyebrow">{data.this_month.label}</span>
          <div class="stats">
            <Stat label="My earnings" value={data.this_month.earned.amount_display} />
            <Stat label="Paid to me" value={data.this_month.received.amount_display} tone="green" />
            <Stat label="Gigs" value={String(data.this_month.gigs)} />
          </div>
        </div>
      </Card>

      <ListGroup title="Owed to me" footer="Gigs already played where my share isn't fully paid.">
        {#snippet action()}
          <span class="total num" class:amber={data!.owed_to_me.total.amount_paise > 0}
            >{data!.owed_to_me.total.amount_display}</span
          >
        {/snippet}
        {#each data.owed_to_me.gigs as g (g.gig_id)}
          <ListRow href="/gigs/{g.gig_id}" title={g.gig_title} subtitle={sub(g)}>
            {#snippet trailing()}<span class="amt num">{g.amount.amount_display}</span>{/snippet}
          </ListRow>
        {:else}
          <ListRow title="All settled" subtitle="Nobody owes you for gigs you've played." />
        {/each}
      </ListGroup>

      {#if data.to_collect.gigs.length}
        <ListGroup title="To collect from clients" footer="Played gigs you manage, not fully paid.">
          {#snippet action()}<span class="total num">{data!.to_collect.total.amount_display}</span>{/snippet}
          {#each data.to_collect.gigs as g (g.gig_id)}
            <ListRow href="/gigs/{g.gig_id}" title={g.gig_title} subtitle={sub(g)}>
              {#snippet trailing()}<span class="amt num">{g.amount.amount_display}</span>{/snippet}
            </ListRow>
          {/each}
        </ListGroup>
      {/if}

      {#if data.to_pay.gigs.length}
        <ListGroup
          title="To pay the people playing"
          footer="Shares not yet paid out on played gigs you manage."
        >
          {#snippet action()}<span class="total num">{data!.to_pay.total.amount_display}</span>{/snippet}
          {#each data.to_pay.gigs as g (g.gig_id)}
            <ListRow href="/gigs/{g.gig_id}" title={g.gig_title} subtitle={sub(g)}>
              {#snippet trailing()}<span class="amt num">{g.amount.amount_display}</span>{/snippet}
            </ListRow>
          {/each}
        </ListGroup>
      {/if}
    </div>

    <div class="col">
      <ListGroup title="Coming up">
        {#snippet action()}<a class="link" href="/gigs">All gigs</a>{/snippet}
        {#each data.upcoming as e (e.event_id)}
          <ListRow
            href="/gigs/{e.gig_id}"
            title={e.event_title ? `${e.gig_title} · ${e.event_title}` : e.gig_title}
            subtitle={[time12(e.start_at), e.venue_name, e.part, e.collective_name]
              .filter(Boolean)
              .join(" · ")}
          >
            {#snippet leading()}<GigDate iso={e.start_at} />{/snippet}
            {#snippet trailing()}
              <span class="right">
                {#if e.share.amount_paise > 0}<span class="amt num">{e.share.amount_display}</span>{/if}
                <Pill tone={statusTone(e.status)}>{statusLabel(e.status)}</Pill>
              </span>
            {/snippet}
          </ListRow>
        {:else}
          <EmptyState title="Nothing coming up" text="Gigs you're on show up here, whoever added them.">
            {#snippet icon()}<CalendarPlus size={26} />{/snippet}
            {#snippet action()}<Button variant="tinted" onclick={() => (creating = true)}>Add a gig</Button
              >{/snippet}
          </EmptyState>
        {/each}
      </ListGroup>
    </div>
  </div>
{/if}

<GigEditor bind:open={creating} />

<style>
  .news {
    display: grid;
    gap: var(--space-1);
    justify-items: start;
  }
  .news > :global(*:first-child) {
    justify-self: stretch;
  }
  .bell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent);
  }
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
  .link {
    color: var(--accent-text);
    font-weight: 600;
    font-size: var(--text-sm);
  }
</style>
