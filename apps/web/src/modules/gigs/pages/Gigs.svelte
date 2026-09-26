<script lang="ts">
  import type { GigView, WorkspaceDetail } from "@assistant/shared";
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
  import { navigate } from "../../../core/router.svelte.ts";
  import { gigsApi } from "../api.ts";
  import GigDate from "../GigDate.svelte";
  import GigForm from "../GigForm.svelte";
  import { statusLabel, statusTone } from "../status.ts";
  import { monthLabel, time12 } from "../time.ts";

  let { workspace }: { workspace: WorkspaceDetail } = $props();
  const api = $derived(gigsApi(workspace.id));

  type Tab = "upcoming" | "past" | "all";
  let tab = $state<Tab>("upcoming");
  let query = $state("");
  let gigs = $state<GigView[] | null>(null);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  let formOpen = $state(false);

  function params(extra: Record<string, string> = {}) {
    const now = new Date().toISOString();
    const base: Record<string, string> =
      tab === "upcoming"
        ? { from: now, order: "asc" }
        : tab === "past"
          ? { to: now, order: "desc" }
          : { order: "desc" };
    return { ...base, ...(query.trim() ? { q: query.trim() } : {}), limit: "30", ...extra };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = params();
    gigs = null;
    clearTimeout(timer);
    timer = setTimeout(() => {
      api.findGigs(p).then(
        (page) => {
          gigs = page.items;
          cursor = page.next_cursor;
        },
        (e) => {
          toast.error(e);
          gigs = [];
        },
      );
    }, 150);
  });

  async function more() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const page = await api.findGigs(params({ cursor }));
      gigs = [...(gigs ?? []), ...page.items];
      cursor = page.next_cursor;
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }

  const groups = $derived.by(() => {
    const out: { month: string; items: GigView[] }[] = [];
    for (const g of gigs ?? []) {
      const month = monthLabel(g.start_at);
      if (out.at(-1)?.month !== month) out.push({ month, items: [] });
      out.at(-1)!.items.push(g);
    }
    return out;
  });

  function subtitle(g: GigView) {
    return [time12(g.start_at), g.venue?.name, g.client?.name].filter(Boolean).join(" · ");
  }
</script>

<PageHeader title="Gigs">
  {#snippet actions()}
    <Button variant="primary" onclick={() => (formOpen = true)}>
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
    <input type="search" placeholder="Search by title" bind:value={query} aria-label="Search gigs" />
  </label>
</div>

{#if gigs === null}
  <Skeleton rows={5} />
{:else if gigs.length === 0}
  <EmptyState
    title={query ? "No gigs match" : tab === "upcoming" ? "No upcoming gigs" : "No gigs yet"}
    text={query ? "Try another word from the title." : "Add a gig with its date, fee, client and venue."}
  >
    {#snippet icon()}<CalendarPlus size={26} />{/snippet}
    {#snippet action()}
      {#if !query}<Button variant="primary" onclick={() => (formOpen = true)}>Add a gig</Button>{/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="groups">
    {#each groups as group (group.month)}
      <ListGroup title={group.month}>
        {#each group.items as g (g.id)}
          <ListRow href="/w/{workspace.id}/gigs/{g.id}" title={g.title} subtitle={subtitle(g)}>
            {#snippet leading()}<GigDate iso={g.start_at} muted={g.status === "cancelled"} />{/snippet}
            {#snippet trailing()}
              <span class="right">
                <span class="fee num" class:struck={g.status === "cancelled"}>{g.fee.amount_display}</span>
                <Pill tone={statusTone(g.status)}>{statusLabel(g.status)}</Pill>
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

<GigForm
  bind:open={formOpen}
  workspaceId={workspace.id}
  onsaved={(g) => navigate(`/w/${workspace.id}/gigs/${g.id}`)}
/>

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
    height: 40px;
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
  .struck {
    text-decoration: line-through;
    color: var(--text-3);
  }
</style>
