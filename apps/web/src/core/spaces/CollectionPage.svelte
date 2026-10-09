<script lang="ts">
  import type { CollectionView, Filter, FindResult, RecordView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import X from "@lucide/svelte/icons/x";
  import {
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Segmented,
    SelectField,
    Skeleton,
    toast,
  } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import {
    filterLabel,
    isPending,
    listKey,
    savedCollections,
    showValue,
    spacesApi,
    summaryOf,
    type FindQuery,
  } from "./spaces-api.ts";
  import RecordSheet from "./RecordSheet.svelte";
  import FilterSheet from "./FilterSheet.svelte";

  // One collection's records as a list or a table, with search, filters and sorting.
  let { collectionId }: { collectionId: string } = $props();

  const col = createQuery<CollectionView>(
    () => `spaces:collection:${collectionId}`,
    () => spacesApi.collection(collectionId),
  );
  const collection = $derived(col.data ?? savedCollections()?.find((c) => c.id === collectionId));

  // The way I last looked at it, kept on this device.
  const viewKey = () => `assistant:view:${collectionId}`;
  let mode = $state<"list" | "table">(
    (() => {
      try {
        return localStorage.getItem(viewKey()) === "table" ? "table" : "list";
      } catch {
        return "list";
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem(viewKey(), mode);
    } catch {
      // Not kept: fine.
    }
  });

  let typed = $state("");
  let search = $state("");
  $effect(() => {
    const q = typed.trim();
    const t = setTimeout(() => (search = q), 250);
    return () => clearTimeout(t);
  });
  let filters = $state<Filter[]>([]);
  let sort = $state("");
  let filtering = $state(false);
  let adding = $state(false);

  const query = $derived<FindQuery>({
    ...(filters.length ? { filters } : {}),
    ...(search ? { search } : {}),
    ...(sort ? { sort: { field: sort.slice(1), dir: sort[0] === "-" ? "desc" : "asc" } } : {}),
  });
  const records = createQuery<FindResult>(
    () => listKey(collectionId, query),
    () => spacesApi.find(collectionId, query),
  );
  $effect(() => {
    if (records.error && !records.data && connection.online) toast.error(records.error);
  });

  // More pages, added below the first.
  let more = $state<RecordView[]>([]);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  $effect(() => {
    cursor = records.data?.next_cursor ?? null;
    more = [];
  });
  async function loadMore() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const page = await spacesApi.find(collectionId, { ...query, cursor });
      more = [...more, ...page.items];
      cursor = page.next_cursor;
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }
  /** A new record that hasn't synced yet has no page to open. */
  const unsynced = (r: RecordView) => isPending(r) && !r.version;
  function open(r: RecordView) {
    if (collection && !unsynced(r)) navigate(`/c/${collection.id}/${r.id}`);
  }
  const items = $derived(records.data ? [...records.data.items, ...more] : null);
  const tableFields = $derived(collection?.fields.filter((f) => f.type !== "long_text").slice(0, 8) ?? []);

  const sortOptions = $derived([
    { value: "", label: "Newest first" },
    ...(collection?.fields ?? [])
      .filter((f) => f.type !== "link" && f.type !== "long_text" && f.type !== "multi_choice")
      .flatMap((f) => [
        { value: `+${f.id}`, label: `${f.name} ↑` },
        { value: `-${f.id}`, label: `${f.name} ↓` },
      ]),
  ]);
</script>

{#if !collection}
  <PageHeader title="Collection" back="/c" backLabel="Collections" />
  {#if col.error}
    <EmptyState title="Can't open this" text="It may have been removed, or you're offline." />
  {:else}
    <Skeleton rows={5} label="Loading" />
  {/if}
{:else}
  <PageHeader
    title={collection.name}
    subtitle={collection.description ?? undefined}
    back="/c"
    backLabel="Collections"
  >
    {#snippet actions()}
      <Button variant="ghost" href="/c/{collection.id}/setup" aria-label="Fields and settings">
        {#snippet icon()}<Settings2 />{/snippet}
      </Button>
      <Button variant="primary" onclick={() => (adding = true)}>
        {#snippet icon()}<Plus />{/snippet}
        Add
      </Button>
    {/snippet}
  </PageHeader>

  <div class="bar">
    <label class="search">
      <Search size={18} />
      <input
        type="search"
        placeholder="Search titles"
        bind:value={typed}
        aria-label="Search {collection.name}"
      />
    </label>
    <Button variant="secondary" onclick={() => (filtering = true)}>
      {#snippet icon()}<SlidersHorizontal />{/snippet}
      Filter
    </Button>
  </div>
  <div class="bar">
    <div class="sort">
      <SelectField label="Sort" id="sort-{collection.id}" bind:value={sort} options={sortOptions} />
    </div>
    <Segmented
      label="Show as"
      bind:value={mode}
      options={[
        { value: "list", label: "List" },
        { value: "table", label: "Table" },
      ]}
    />
  </div>
  {#if filters.length}
    <div class="filters">
      {#each filters as f, i (i)}
        <span class="filter">
          {filterLabel(collection, f)}
          <button
            type="button"
            aria-label="Remove filter"
            onclick={() => (filters = filters.filter((_, j) => j !== i))}><X size={14} /></button
          >
        </span>
      {/each}
    </div>
  {/if}

  {#if items === null}
    <Skeleton rows={5} label="Loading records" />
  {:else if items.length === 0}
    <EmptyState
      title={filters.length || search ? "Nothing matches" : `No ${collection.name.toLowerCase()} yet`}
      text={filters.length || search ? "Try fewer filters or other words." : "Add the first one."}
    >
      {#snippet action()}
        {#if !filters.length && !search}<Button variant="primary" onclick={() => (adding = true)}>Add</Button
          >{/if}
      {/snippet}
    </EmptyState>
  {:else if mode === "list"}
    <ListGroup>
      {#each items as r (r.id)}
        <ListRow
          title={r.title}
          subtitle={summaryOf(collection, r) || undefined}
          href={unsynced(r) ? undefined : `/c/${collection.id}/${r.id}`}
          chevron
        >
          {#snippet trailing()}{#if isPending(r)}<Pill tone="amber">Waiting to sync</Pill>{/if}{/snippet}
        </ListRow>
      {/each}
    </ListGroup>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr
            >{#each tableFields as f (f.id)}<th scope="col">{f.name}</th>{/each}</tr
          >
        </thead>
        <tbody>
          {#each items as r (r.id)}
            <tr
              class:pending={isPending(r)}
              onclick={() => open(r)}
              tabindex="0"
              onkeydown={(e) => e.key === "Enter" && open(r)}
            >
              {#each tableFields as f (f.id)}
                <td class:num={f.type === "money" || f.type === "number"}>
                  {f.type === "link"
                    ? (r.links[f.id] ?? []).map((l) => l.title).join(", ")
                    : showValue(f, r.values[f.id])}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if cursor}
    <div class="more"><Button onclick={loadMore} loading={loadingMore}>Show more</Button></div>
  {/if}

  <RecordSheet bind:open={adding} {collection} onsaved={() => void records.refresh()} />
  <FilterSheet bind:open={filtering} {collection} onadd={(f) => (filters = [...filters, f])} />
{/if}

<style>
  .bar {
    display: flex;
    align-items: end;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }
  .search {
    flex: 1;
    min-width: 200px;
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
  .sort {
    flex: 1;
    min-width: 180px;
    max-width: 320px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .filter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 36px;
    padding-left: var(--space-3);
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .filter button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 36px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-base);
  }
  th,
  td {
    padding: var(--space-3);
    text-align: left;
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    border-bottom: 1px solid var(--separator);
  }
  th {
    font-size: var(--text-sm);
    color: var(--text-2);
    font-weight: 600;
    background: var(--surface-2);
    position: sticky;
    top: 0;
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--surface-hover);
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tr.pending {
    color: var(--text-2);
  }
  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--space-4);
  }
</style>
