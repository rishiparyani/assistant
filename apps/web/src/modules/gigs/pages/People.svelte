<script lang="ts">
  import type { ClientView, MusicianView, VenueView, WorkspaceDetail } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Users from "@lucide/svelte/icons/users";
  import {
    Avatar,
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
  import { gigsApi } from "../api.ts";
  import type { PersonKind } from "../options.ts";
  import PersonSheet from "../PersonSheet.svelte";

  let { workspace }: { workspace: WorkspaceDetail } = $props();
  const api = $derived(gigsApi(workspace.id));
  const isOwner = $derived(workspace.role === "owner");

  type Item = ClientView | VenueView | MusicianView;
  let tab = $state<PersonKind>("clients");
  let query = $state("");
  let items = $state<Item[] | null>(null);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  let sheetOpen = $state(false);
  let editing = $state<Item | null>(null);
  let reload = $state(0);

  const find = (p: Record<string, string | number | undefined>) =>
    tab === "clients" ? api.findClients(p) : tab === "venues" ? api.findVenues(p) : api.findMusicians(p);

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void reload;
    const p = { q: query.trim() || undefined, limit: 50 };
    const kind = tab;
    const load = (q: typeof p) =>
      kind === "clients" ? api.findClients(q) : kind === "venues" ? api.findVenues(q) : api.findMusicians(q);
    items = null;
    clearTimeout(timer);
    timer = setTimeout(() => {
      load(p).then(
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
      const page = await find({ q: query.trim() || undefined, limit: 50, cursor });
      items = [...(items ?? []), ...page.items];
      cursor = page.next_cursor;
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }

  // Everyone can manage clients and venues; only owners manage the roster.
  const canEdit = $derived(tab !== "roster" || isOwner);
  const noun = $derived(tab === "clients" ? "client" : tab === "venues" ? "venue" : "musician");

  function open(item: Item | null) {
    editing = item;
    sheetOpen = true;
  }

  function subtitle(i: Item): string | undefined {
    if (tab === "clients") {
      const c = i as ClientView;
      return [c.organisation, c.phone].filter(Boolean).join(" · ") || undefined;
    }
    if (tab === "venues") {
      const v = i as VenueView;
      return [v.city, v.address].filter(Boolean).join(" · ") || undefined;
    }
    const m = i as MusicianView;
    return [m.instrument, m.phone].filter(Boolean).join(" · ") || undefined;
  }
  const linked = (i: Item) => tab === "roster" && !!(i as MusicianView).user_id;

  const EMPTY: Record<PersonKind, { title: string; text: string }> = {
    clients: {
      title: "No clients yet",
      text: "People and companies who book you. Add them here or while adding a gig.",
    },
    venues: { title: "No venues yet", text: "Where you play. Add them here or while adding a gig." },
    roster: {
      title: "No one in the roster yet",
      text: "Musicians you play with, so you can set lineups and track their shares.",
    },
  };
</script>

<PageHeader title="People">
  {#snippet actions()}
    {#if canEdit}
      <Button variant="primary" onclick={() => open(null)}>
        {#snippet icon()}<Plus />{/snippet}
        Add {noun}
      </Button>
    {/if}
  {/snippet}
</PageHeader>

<div class="toolbar">
  <Segmented
    label="Which people"
    bind:value={tab}
    options={[
      { value: "clients", label: "Clients" },
      { value: "venues", label: "Venues" },
      { value: "roster", label: "Roster" },
    ]}
  />
  <label class="search">
    <Search size={18} />
    <input type="search" placeholder="Search {tab}" bind:value={query} aria-label="Search {tab}" />
  </label>
</div>

{#if items === null}
  <Skeleton rows={5} />
{:else if items.length === 0}
  <EmptyState
    title={query ? "No matches" : EMPTY[tab].title}
    text={query ? "Try another spelling." : EMPTY[tab].text}
  >
    {#snippet icon()}<Users size={26} />{/snippet}
    {#snippet action()}
      {#if !query && canEdit}<Button variant="primary" onclick={() => open(null)}>Add {noun}</Button>{/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="list">
    <ListGroup>
      {#each items as i (i.id)}
        <ListRow title={i.name} subtitle={subtitle(i)} onclick={() => open(i)} chevron>
          {#snippet leading()}<Avatar name={i.name} size={36} square={tab === "venues"} />{/snippet}
          {#snippet trailing()}{#if linked(i)}<Pill tone="accent">Member</Pill>{/if}{/snippet}
        </ListRow>
      {/each}
    </ListGroup>
    {#if cursor}
      <Button full onclick={more} loading={loadingMore}>Show more</Button>
    {/if}
  </div>
{/if}

<PersonSheet
  bind:open={sheetOpen}
  kind={tab}
  item={editing}
  {workspace}
  readonly={!canEdit}
  onchanged={() => reload++}
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
  .list {
    display: grid;
    gap: var(--space-4);
  }
</style>
