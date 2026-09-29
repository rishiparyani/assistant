<script lang="ts">
  import type { MyEventView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import List from "@lucide/svelte/icons/list";
  import {
    Button,
    EmptyState,
    ListGroup,
    PageHeader,
    Segmented,
    NotSaved,
    Skeleton,
    toast,
  } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { createQuery } from "../../../core/query.svelte.ts";
  import { isOfflineError } from "../../../core/offline.svelte.ts";
  import GigEditor from "./GigEditor.svelte";
  import GigCalendar from "./GigCalendar.svelte";
  import GigEventRow from "./GigEventRow.svelte";
  import { monthLabel } from "../time.ts";

  // List (default) or calendar; remembered on this device only.
  type View = "list" | "calendar";
  const VIEW_KEY = "gigs-view";
  function savedView(): View {
    try {
      return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
    } catch {
      return "list";
    }
  }
  let view = $state<View>(savedView());
  function setView(v: View) {
    view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
  }
  let newDate = $state<string | null>(null); // a new gig's date, from the calendar
  function create(date: string | null = null) {
    newDate = date;
    creating = true;
  }

  // Every event of every gig I'm on, from my own summaries (may lag a few seconds).
  type Tab = "upcoming" | "past" | "all";
  let tab = $state<Tab>("upcoming");
  let query = $state("");
  let search = $state(""); // the query, settled for 200 ms
  let extra = $state<MyEventView[]>([]); // pages loaded with "Show more"
  let nextCursor = $state<string | null | undefined>(undefined);
  let loadingMore = $state(false);
  let creating = $state(false);

  $effect(() => {
    const q = query.trim();
    const t = setTimeout(() => (search = q), 200);
    return () => clearTimeout(t);
  });

  function params(extraParams: Record<string, string> = {}) {
    const now = new Date().toISOString();
    const base =
      tab === "upcoming"
        ? { from: now, order: "asc" as const }
        : tab === "past"
          ? { to: now, order: "desc" as const }
          : { order: "desc" as const };
    return { ...base, q: search || undefined, limit: 30, ...extraParams };
  }

  // The first page of each tab and search is cached (shown at once, refreshed behind).
  const first = createQuery(
    () => `gigs:${tab}:${search}`,
    () => bookingsApi.myGigs(params()),
  );
  $effect(() => {
    void first.data;
    extra = [];
    nextCursor = undefined;
  });
  const items = $derived(first.data ? [...first.data.items, ...extra] : null);
  const cursor = $derived(nextCursor === undefined ? (first.data?.next_cursor ?? null) : nextCursor);

  async function more() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const page = await bookingsApi.myGigs(params({ cursor }));
      extra = [...extra, ...page.items];
      nextCursor = page.next_cursor;
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
</script>

<PageHeader title="Gigs">
  {#snippet actions()}
    <div class="views" role="group" aria-label="View">
      <button
        type="button"
        aria-label="List"
        title="List"
        aria-pressed={view === "list"}
        onclick={() => setView("list")}><List size={20} /></button
      >
      <button
        type="button"
        aria-label="Calendar"
        title="Calendar"
        aria-pressed={view === "calendar"}
        onclick={() => setView("calendar")}><CalendarDays size={20} /></button
      >
    </div>
    <Button variant="primary" onclick={() => create()}>
      {#snippet icon()}<Plus />{/snippet}
      New gig
    </Button>
  {/snippet}
</PageHeader>

{#if view === "calendar"}
  <GigCalendar onadd={(d) => create(d)} />
{:else}
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
    {#if first.error && isOfflineError(first.error)}<NotSaved />{:else}<Skeleton rows={5} />{/if}
  {:else if items.length === 0}
    <EmptyState
      title={query ? "No gigs match" : tab === "upcoming" ? "No upcoming gigs" : "No gigs yet"}
      text={query
        ? "Try another word from the title, client or venue."
        : "Gigs you create, and gigs others add you to, show up here."}
    >
      {#snippet icon()}<CalendarPlus size={26} />{/snippet}
      {#snippet action()}
        {#if !query}<Button variant="primary" onclick={() => create()}>Add a gig</Button>{/if}
      {/snippet}
    </EmptyState>
  {:else}
    <div class="groups">
      {#each groups as group (group.month)}
        <ListGroup title={group.month}>
          {#each group.items as e (e.event_id)}
            <GigEventRow {e} />
          {/each}
        </ListGroup>
      {/each}
      {#if cursor}
        <Button full onclick={more} loading={loadingMore}>Show more</Button>
      {/if}
    </div>
  {/if}
{/if}

<GigEditor bind:open={creating} date={newDate} />

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
  .views {
    display: flex;
    padding: 3px;
    gap: 2px;
    background: var(--grey-soft);
    border-radius: var(--radius);
  }
  .views button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 38px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  .views button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
</style>
