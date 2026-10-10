<script lang="ts">
  import type { CollectionView } from "@assistant/shared";
  import List from "@lucide/svelte/icons/list";
  import { createQuery } from "../query.svelte.ts";
  import { COLLECTIONS_KEY, spacesApi } from "./spaces-api.ts";
  import CollectionPanel from "./CollectionPanel.svelte";

  // "Your lists" in the side menu: every collection, one tap from its records. The way in
  // that never needs the assistant (screens work without AI).
  let { onopen }: { onopen?: () => void } = $props();

  const collections = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);
  let selected = $state<CollectionView | null>(null);
  let open = $state(false);
</script>

{#if collections.data?.length}
  <ul class="list">
    {#each collections.data as c (c.id)}
      <li>
        <button
          type="button"
          class="item"
          onclick={() => {
            selected = c;
            open = true;
            onopen?.();
          }}
        >
          <span class="ic"><List size={16} /></span>
          <span class="t">{c.name}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if selected}
  {#key selected.id}
    <CollectionPanel bind:open collection={selected} />
  {/key}
{/if}

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-hover);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 9px;
    background: var(--kind-people-soft);
    color: var(--kind-people);
  }
  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
