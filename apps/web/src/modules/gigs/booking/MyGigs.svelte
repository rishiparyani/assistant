<script lang="ts">
  import type { MyEventView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import {
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Segmented,
    Skeleton,
    toast,
  } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import GigDate from "../GigDate.svelte";
  import GigEditor from "./GigEditor.svelte";
  import { statusLabel, statusTone } from "../status.ts";
  import { monthLabel, time12 } from "../time.ts";

  // Every event of every gig I'm on, from my own summaries (may lag a few seconds).
  type Tab = "upcoming" | "past" | "all";
  let tab = $state<Tab>("upcoming");
  let query = $state("");
  let items = $state<MyEventView[] | null>(null);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  let creating = $state(false);

  function params(extra: Record<string, string> = {}) {
    const now = new Date().toISOString();
    const base =
      tab === "upcoming"
        ? { from: now, order: "asc" as const }
        : tab === "past"
          ? { to: now, order: "desc" as const }
          : { order: "desc" as const };
    return { ...base, q: query.trim() || undefined, limit: 30, ...extra };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = params();
    items = null;
    clearTimeout(timer);
    timer = setTimeout(() => {
      bookingsApi.myGigs(p).then(
        (page) => {
          items = page.items;
          cursor = page.next_cursor;
        },
        (e) => {
          toast.error(e);
          items = [];
        },
      );
    }, 150);
  });

  async function more() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const page = await bookingsApi.myGigs(params({ cursor }));
      items = [...(items ?? []), ...page.items];
      cursor = page.next_cursor;
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }

  const groups = $derived.by(() => {
    const out: { month: string; items: MyEventView[] }[] = [];
    for (const e of items ?? []) {
      const month = monthLabel(e.start_at);
      if (out.at(-1)?.month !== month) out.push({ month, items: [] });
      out.at(-1)!.items.push(e);
    }
    return out;
  });

  const subtitle = (e: MyEventView) =>
    [time12(e.start_at), e.venue_name, e.client_name, e.collective_name].filter(Boolean).join(" · ");
</script>

<PageHeader title="Gigs">
  {#snippet actions()}
    <Button variant="primary" onclick={() => (creating = true)}>
      {#snippet icon()}<Plus />{/snippet}
      New gig
    </Button>
  {/snippet}
</PageHeader>

<div class="toolbar">
  <Segmented
    label="Which gigs"
    bind:value={tab}
    options={[
      { value: "upcoming", label: "Upcoming" },
      { value: "past", label: "Past" },
      { value: "all", label: "All" },
    ]}
  />
  <label class="search">
    <Search size={18} />
    <input
      type="search"
      placeholder="Search title, client, venue"
      bind:value={query}
      aria-label="Search gigs"
    />
  </label>
</div>

{#if items === null}
  <Skeleton rows={5} />
{:else if items.length === 0}
  <EmptyState
    title={query ? "No gigs match" : tab === "upcoming" ? "No upcoming gigs" : "No gigs yet"}
    text={query
      ? "Try another word from the title, client or venue."
      : "Gigs you create, and gigs others add you to, show up here."}
  >
    {#snippet icon()}<CalendarPlus size={26} />{/snippet}
    {#snippet action()}
      {#if !query}<Button variant="primary" onclick={() => (creating = true)}>Add a gig</Button>{/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="groups">
    {#each groups as group (group.month)}
      <ListGroup title={group.month}>
        {#each group.items as e (e.event_id)}
          <ListRow
            href="/gigs/{e.gig_id}"
            title={e.event_title ? `${e.gig_title} · ${e.event_title}` : e.gig_title}
            subtitle={subtitle(e)}
          >
            {#snippet leading()}<GigDate iso={e.start_at} muted={e.status === "cancelled"} />{/snippet}
            {#snippet trailing()}
              <span class="right">
                {#if e.share.amount_paise > 0}
                  <span class="fee num" class:struck={e.status === "cancelled"}>{e.share.amount_display}</span
                  >
                {:else if e.role === "manager"}
                  <span class="role">Managing</span>
                {/if}
                <Pill tone={statusTone(e.status)}>{statusLabel(e.status)}</Pill>
              </span>
            {/snippet}
          </ListRow>
        {/each}
      </ListGroup>
    {/each}
    {#if cursor}
      <Button full onclick={more} loading={loadingMore}>Show more</Button>
    {/if}
  </div>
{/if}

<GigEditor bind:open={creating} />

<style>
  .toolbar {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  @media (min-width: 1024px) {
    .toolbar {
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      align-items: center;
    }
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    outline: none;
    font-size: 16px;
  }
  .groups {
    display: grid;
    gap: var(--space-6);
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .fee {
    font-weight: 600;
    color: var(--text);
  }
  .role {
    font-size: var(--text-xs);
    color: var(--text-3);
    font-weight: 600;
  }
  .struck {
    text-decoration: line-through;
    color: var(--text-3);
  }
</style>
