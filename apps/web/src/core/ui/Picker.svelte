<script lang="ts" generics="T extends { id: string; name: string }">
  import type { Snippet } from "svelte";
  import Search from "@lucide/svelte/icons/search";
  import Plus from "@lucide/svelte/icons/plus";
  import Check from "@lucide/svelte/icons/check";
  import Sheet from "./Sheet.svelte";
  import ListGroup from "./ListGroup.svelte";
  import ListRow from "./ListRow.svelte";
  import Skeleton from "./Skeleton.svelte";

  // A searchable list in a sheet. `load(query)` fetches matches; `onpick` gets the
  // chosen item. `oncreate(query)` offers "Add …" when nothing fits.
  let {
    open = $bindable(false),
    title,
    load,
    onpick,
    oncreate,
    selectedId,
    subtitle,
    createLabel = "Add",
    row,
  }: {
    open?: boolean;
    title: string;
    load: (query: string) => Promise<T[]>;
    onpick: (item: T) => void;
    oncreate?: (query: string) => void;
    selectedId?: string | null;
    subtitle?: (item: T) => string | undefined;
    createLabel?: string;
    row?: Snippet<[T]>;
  } = $props();

  let query = $state("");
  let items = $state<T[] | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let input: HTMLInputElement | undefined = $state();

  // Focus the search box when the sheet opens (the dialog focuses its close button).
  $effect(() => {
    if (open && input) setTimeout(() => input?.focus(), 50);
  });

  $effect(() => {
    if (!open) return;
    const text = query;
    clearTimeout(timer);
    timer = setTimeout(() => {
      load(text.trim()).then(
        (r) => (items = r),
        () => (items = []),
      );
    }, 180);
  });

  function pick(item: T) {
    onpick(item);
    open = false;
    query = "";
  }
</script>

<Sheet bind:open {title} onclose={() => (query = "")}>
  <label class="search">
    <Search size={18} />
    <input type="search" placeholder="Search" bind:this={input} bind:value={query} aria-label="Search" />
  </label>
  {#if items === null}
    <Skeleton rows={3} />
  {:else}
    <ListGroup>
      {#if oncreate && query.trim() && !items.some((i) => i.name.toLowerCase() === query
              .trim()
              .toLowerCase())}
        <ListRow
          title={`${createLabel} “${query.trim()}”`}
          onclick={() => {
            oncreate(query.trim());
            open = false;
            query = "";
          }}
          chevron={false}
        >
          {#snippet leading()}<span class="add"><Plus size={18} /></span>{/snippet}
        </ListRow>
      {/if}
      {#each items as item (item.id)}
        <ListRow title={item.name} subtitle={subtitle?.(item)} onclick={() => pick(item)} chevron={false}>
          {#snippet leading()}
            {#if row}{@render row(item)}{/if}
          {/snippet}
          {#snippet trailing()}
            {#if item.id === selectedId}<span class="check"><Check size={20} /></span>{/if}
          {/snippet}
        </ListRow>
      {:else}
        {#if !(oncreate && query.trim())}
          <ListRow title={query ? "No matches" : "Nothing here yet"} />
        {/if}
      {/each}
    </ListGroup>
  {/if}
</Sheet>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    background: var(--grey-soft);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--text);
    outline: none;
    min-width: 0;
  }
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .check {
    color: var(--accent);
    display: flex;
  }
</style>
